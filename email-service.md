# Email Service — Plan & Requirements

**Provider:** Amazon SES (AWS SDK v3 — `@aws-sdk/client-ses`)
**Sender domain:** `pilloto.com` (already verified in SES)
**From address:** `noreply@pilloto.com` — shared across all tenants
**From display name:** Includes tenant hotel name — `"<Hotel Name> via Pilloto" <noreply@pilloto.com>`
**Tenant customization scope:** From display name override, reply-to address, customizable footer

The existing `email.ts` utility (currently Microsoft Graph API) is **replaced entirely** with an SES-based implementation. Call sites are unaffected — function signatures remain backward-compatible.

---

## 1. Pre-Implementation Checklist (AWS Console)

Before writing any code, the following must be confirmed or completed in the AWS console:

- [ ] SES domain `pilloto.com` is verified (done per user)
- [ ] IAM user credentials are stored in `.env` and not in version control
- [ ] A **Configuration Set** is created in SES console (e.g., `pilloto-transactional`) — required for bounce/complaint tracking
- [ ] An **SNS topic** is created (e.g., `pilloto-ses-events`) and subscribed to the Configuration Set for `Bounce` and `Complaint` event types
- [ ] SPF, DKIM, and DMARC DNS records are published and verified (see §4)
- [ ] A custom **MAIL FROM subdomain** is configured in SES (e.g., `mail.pilloto.com`) for proper DMARC alignment

## 2. Email Types & Trigger Points

| Email                                          | Trigger                              | Primary Data Sources                                             |
| ---------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| Reservation Confirmation — Room                | Reservation created/confirmed        | Reservation, Guest, RatePlan, Tax, Tenant, AppSettings           |
| Reservation Confirmation — DayPass / PasaTarde | Reservation created                  | Reservation, Guest, Tenant, AppSettings                          |
| Reservation Confirmation — Event               | Reservation created                  | Reservation, Guest, Tenant, AppSettings                          |
| Invoice / Receipt                              | Folio status transitions to `closed` | Folio, Reservation, Payment[], Tax[], Guest, Tenant, AppSettings |
| Email Verification                             | User registers                       | User                                                             |
| Password Reset                                 | User requests reset                  | User                                                             |

Verification and password reset emails are migrated to SES with no change to business logic or Spanish copy.

---

## 3. Amazon SES Mandatory Requirements

### 3.1 Configuration Set

Every SES send call must include the Configuration Set name (`SES_CONFIGURATION_SET` env var). This is not optional — it enables:

- Bounce and complaint event publishing to SNS
- Sending statistics and reputation monitoring in the SES dashboard
- Rendering failure tracking

### 3.2 Bounce & Complaint Handling

Per AWS SES policy, unmanaged bounces or complaints above threshold thresholds result in **account suspension**. This is the most critical non-negotiable requirement.

**Required implementation:**

1. An SNS HTTPS subscription pointing to `POST /api/webhooks/ses-events` on this backend
2. The webhook processes three event types:
   - **Hard bounce** (`bounce.bounceType === "Permanent"`) — permanently suppress the address
   - **Soft bounce** (`bounce.bounceType === "Transient"`) — log it; suppress after N consecutive failures
   - **Complaint** (spam report) — permanently suppress the address
3. Suppressed addresses are stored in a `EmailSuppression` MongoDB collection (tenant-scoped via tenantPlugin) with fields: `email`, `reason` (`hard_bounce` | `complaint` | `soft_bounce`), `suppressedAt`
4. All send calls must check the suppression list before dispatching — if the recipient is suppressed, the send is silently skipped and the skip is logged with a reason
5. SES account-level suppression list is enabled in SES settings as a secondary safeguard

**Bounce rate target:** Keep below 2%. Complaint rate target: below 0.1%. Both are visible in the SES console reputation dashboard.

### 3.3 List-Unsubscribe Header

All emails must include a `List-Unsubscribe` header per RFC 2369. For transactional email a `mailto:` unsubscribe to a support address is acceptable. This is required by:

- Gmail bulk sender guidelines (enforced for senders above 5,000/day but best practice unconditionally)
- CAN-SPAM Act
- GDPR Article 21 (right to object to processing)

### 3.4 Sending Rate Management

SES enforces per-second and per-day sending quotas. The service layer must:

- Implement retry with **exponential backoff** for `SendingRateLimitExceeded` errors (up to 3 retries, transient failure only)
- Never retry on permanent errors (`MessageRejected`, `MailFromDomainNotVerified`, etc.)
- Log all send attempts with outcome, timestamp, SES `MessageId`, and reservation ID (no guest PII in logs — see §6.4)

---

## 4. Deliverability Standards

| Standard            | Requirement          | Action                                                                                                                |
| ------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| SPF                 | Required             | SES adds an SPF record during domain verification — confirm it is published in DNS                                    |
| DKIM                | Required             | SES generates CNAME records — must be published; enable in SES domain settings                                        |
| DMARC               | Required             | Add `_dmarc.pilloto.com` TXT record with at minimum `p=quarantine`; `rua` reporting address recommended               |
| Custom MAIL FROM    | Strongly recommended | Set `mail.pilloto.com` as the MAIL FROM subdomain in SES — required for strict DMARC alignment                        |
| Dedicated IP        | Not required now     | Shared IPs sufficient at current volume; revisit when daily send volume exceeds ~50,000                               |
| Plain-text fallback | Required             | Every send must include a `text/plain` part alongside `text/html`; avoid spam filter penalties for HTML-only messages |
| Character encoding  | Required             | All emails must declare `charset=UTF-8`; templates must handle Spanish characters and special characters correctly    |

---

## 5. Tenant Email Configuration

A new `emailSettings` sub-document is added to the existing `AppSettings` Mongoose model per tenant. This keeps email configuration co-located with other tenant operational settings and avoids introducing a new collection.

| Field             | Purpose                                                                | Default Behavior                                 |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `fromDisplayName` | Overrides the sender display name                                      | Falls back to `"<Tenant.name> via Pilloto"`      |
| `replyTo`         | Optional reply-to email (e.g., hotel's front desk inbox)               | Not set — replies go to deliverability blackhole |
| `footerHtml`      | Tenant-customizable footer block rendered at the bottom of every email | Empty                                            |
| `footerText`      | Plain-text version of the footer                                       | Empty                                            |

These fields are exposed via `PUT /api/settings` and surfaced in the admin Settings page under a new **"Email"** section, accessible to `admin` role users only.

The `fromDisplayName` field has a 100-character limit. The `footerHtml` field should be sanitized server-side (strip `<script>`, `on*` attributes) before storage. Both fields are optional; templates fall back gracefully when empty.

---

## 6. Template Architecture

### 6.1 Structure

Templates live in a new `backend/src/utils/emailTemplates/` directory:

| File                         | Responsibility                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `layout.ts`                  | Base wrapper — header (logo + hotel name), body slot, footer (Pilloto branding + tenant custom footer) |
| `reservationConfirmation.ts` | Parameterized for `room`, `daypass`, `PasaTarde`, and `event` reservation types                        |
| `invoice.ts`                 | Folio summary — charges, payment method breakdown, tax breakdown, balance                              |

Each template is a typed TypeScript function that accepts structured data and returns `{ html: string; text: string }`. No external template engine is introduced.

### 6.2 HTML Compatibility Requirements

- **Tables-based layout** — no CSS flexbox or grid; required for Outlook compatibility
- **All CSS inlined** — no external stylesheets, no `<style>` blocks with classes
- **No JavaScript** — email clients strip it; its presence decreases deliverability score
- **Max width 600px** — standard for email clients
- **Alt text on all images** — accessibility and plain-image-blocked rendering
- **Logo referenced by absolute URL** (CDN/media URL from `Tenant.settings.logoUrl`) — not embedded as base64

### 6.3 Content Requirements

Every email must include:

- Hotel name prominently in the header
- Reservation or folio reference number
- Guest name
- Relevant details (dates, amounts, itemization)
- Physical mailing address of the platform operator in the footer (CAN-SPAM requirement)
- Unsubscribe / contact link in the footer
- Disclaimer that this is a transactional email

### 6.4 Internationalization

Templates are written in **Spanish by default** (the platform's primary language per the tenant's `settings.language`). English fallback is not required in Phase 1 but the template functions should accept a `locale` parameter to allow expansion later.

---

## 7. Security Requirements

### 7.1 Credential Storage

| Variable                | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | IAM user access key                      |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret                          |
| `AWS_REGION`            | SES region (e.g., `us-east-1`)           |
| `SES_FROM_ADDRESS`      | `noreply@pilloto.com`                    |
| `SES_CONFIGURATION_SET` | Configuration Set name                   |
| `SES_WEBHOOK_SECRET`    | Used for optional webhook pre-validation |

None of these appear in source code or version control. The `.env` file is already in `.gitignore`.

IAM access key rotation policy: every **90 days** maximum.

### 7.2 IAM Least-Privilege Policy

The IAM user's policy must permit **only the following actions** — no wildcards:

- `ses:SendEmail`
- `ses:SendRawEmail`

No IAM, S3, CloudWatch, or any other AWS service permissions. Resource scope should be restricted to the verified identity ARN for the `pilloto.com` sending identity where SES supports it.

### 7.3 SNS Webhook Security

The `POST /api/webhooks/ses-events` endpoint:

- **Must not require JWT authentication** — SNS cannot provide a JWT
- **Must validate the SNS message signature** — verify `SigningCertURL` is an `amazonaws.com` host, download the certificate, and verify the signature against the message body. AWS publishes the exact signing algorithm in their SNS documentation.
- **Must confirm SNS subscription** — when SNS delivers a `SubscriptionConfirmation` message type, the endpoint must confirm it by requesting the `SubscribeURL` before processing any events
- **Must apply IP-based rate limiting** — separate from authenticated API rate limiting
- Must reject any payload that fails signature validation with `400`

### 7.4 PII in Logs

Email addresses, guest names, and reservation details must **not appear in plain text in application logs**.

Log only:

- SES `MessageId` (returned by the SDK on success)
- Internal reservation or folio ID
- Email type (e.g., `reservation_confirmation`, `invoice`)
- Outcome (`sent`, `suppressed`, `failed`)
- Error code if failed (no error message body which may contain PII from SES response)

### 7.5 Footer Sanitization

The `emailSettings.footerHtml` field submitted by tenant admins must be sanitized on the backend before storage. Strip all `<script>` tags, `on*` event attributes, and `javascript:` href values. A library like `sanitize-html` (already absent from `package.json` — add it) or a small custom allowlist is sufficient given the narrow use case.

---

## 8. Implementation Phases

### Phase 1 — Infrastructure & Migration

1. Add `@aws-sdk/client-ses` to backend dependencies
2. Add `sanitize-html` to backend dependencies
3. Define all required environment variables in `.env.example`
4. Replace the Graph API implementation in `email.ts` with an SES-based `sendEmail()` wrapper that accepts `to`, `subject`, `html`, `text`, and optional `replyTo`
5. Add retry logic with exponential backoff for throttle errors
6. Migrate `sendVerificationEmail` and `sendPasswordResetEmail` to route through the new wrapper
7. Migrate `sendReservationConfirmationEmail` to route through the new wrapper (template refactor happens in Phase 2)

### Phase 2 — Templates & New Email Types

1. Create `backend/src/utils/emailTemplates/` with `layout.ts`, `reservationConfirmation.ts`, and `invoice.ts`
2. Refactor `sendReservationConfirmationEmail` to use the new typed template functions (all four reservation types)
3. Implement `sendInvoiceEmail` — takes folio ID, loads all related data, renders and sends the invoice template
4. Hook `sendInvoiceEmail` into the folio closure logic (wherever `folio.status` transitions to `"closed"`)

### Phase 3 — Bounce & Complaint Handling

1. Create `EmailSuppression` Mongoose model (tenant-scoped)
2. Implement suppression list guard in the `sendEmail` wrapper
3. Implement `POST /api/webhooks/ses-events` with SNS signature validation
4. Handle `Bounce` and `Complaint` event types; write to suppression list
5. Verify SNS subscription confirmation flow
6. Add IP-rate limiting to the webhook endpoint

### Phase 4 — Tenant Email Configuration UI

1. Extend `AppSettings` model with `emailSettings` sub-document
2. Add `emailSettings` fields to `PUT /api/settings` endpoint with `footerHtml` sanitization
3. Add "Email" settings section to the admin Settings page (frontend)
4. Surface fields: From display name, Reply-to address, Footer (textarea)
5. Validate `fromDisplayName` max length (100 chars) and `replyTo` email format on both client and server

---

## 9. Out of Scope (Phase 1–4)

- Tenant-owned sending domains (all tenants use `noreply@pilloto.com`)
- Marketing/promotional email campaigns
- Email open/click tracking (can be added later via SES Configuration Set event publishing)
- Attachment support (invoices are rendered as HTML email bodies, not PDF attachments — revisit if requested)
- Email scheduling or queuing infrastructure (a job queue like Bull would be needed if volume grows; not required now)
