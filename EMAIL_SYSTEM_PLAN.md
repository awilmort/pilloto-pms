# Email Service System — Design Document

## Problem with the Current Approach

Pilloto currently sends all emails through a platform-level Microsoft Graph API connection, meaning every email received by a guest arrives from Pilloto's own identity — not from the hotel that made their reservation. There are no branded templates, no delivery tracking, no per-tenant configuration, and no audit record of sent communications. This is a common MVP pattern that is not acceptable for a commercial PMS.

---

## What Enterprise PMS Systems Do

Systems like **Mews**, **Cloudbeds**, and **Oracle Opera** follow a consistent model:

- **Each property sends from its own domain.** Guests receive emails from `reservations@grandhotel.com`, not from the software vendor.
- **Templates are branded per property** — logo, colors, address, and tone reflect the hotel, not the platform.
- **Every guest communication is logged.** Staff can see what was sent, when, and whether it was delivered.
- **Sends are triggered automatically** at the right moments (confirmation, pre-arrival, checkout, payment) but can also be triggered manually by staff.
- **Bounced and failed addresses are suppressed** automatically to protect sender reputation.
- **Guests can opt out** of non-essential communications, and those preferences are respected.

---

## Solution Concept

Pilloto should adopt a **platform-managed, tenant-branded** email architecture:

1. **The platform holds one master account** with a chosen Email Service Provider (ESP). This gives the platform control over IP reputation, billing, and deliverability.

2. **Each tenant is isolated within that account** via the ESP's sub-account or sending-domain system. Tenant A's bounces and complaints do not affect Tenant B.

3. **Tenants configure their sending identity** — their hotel's name and `From` address. They can use a platform-provided subdomain (e.g., `mail.grandhotel.pilloto.com`) or verify their own domain by adding DNS records.

4. **Templates are rendered per tenant** with branding injected at send time: hotel name, logo, primary color, footer address. No template editor is needed in v1.

5. **Every outbound email is logged** in the database with delivery status, which staff can view and from which they can resend.

6. **Scheduled communications** (pre-arrival reminders, post-checkout surveys) run on the existing night audit cron infrastructure.

---

## Email Service Provider Comparison

| Provider                               | Pricing Model | Starting Cost        | Multi-Tenant Isolation                 | Deliverability        | Template Engine              | EU Data Residency     | Best For                           |
| -------------------------------------- | ------------- | -------------------- | -------------------------------------- | --------------------- | ---------------------------- | --------------------- | ---------------------------------- |
| **SendGrid** (Twilio)                  | Per email     | ~$20/mo · 50K emails | Subuser system (per-tenant subaccount) | Excellent             | Handlebars dynamic templates | US-based              | SaaS platforms, multi-tenant       |
| **AWS SES**                            | Per email     | $0.10 / 1K emails    | Manual (separate sending identities)   | Good (requires setup) | Basic                        | Optional (EU regions) | High-volume, cost-focused          |
| **Postmark**                           | Per email     | ~$15/mo · 10K emails | Per-server streams                     | Best in industry      | Layouts + templates          | US-based              | Transactional-only, reliability    |
| **Mailgun** (Sinch)                    | Per email     | ~$35/mo · 50K emails | Per sending domain                     | Good                  | Handlebars                   | EU region available   | Developer-friendly, EU compliance  |
| **Azure Email Communication Services** | Per email     | ~$0.25 / 1K emails   | Manual per domain                      | Good                  | None (bring your own)        | Any Azure region      | Azure-native deployments           |
| **Brevo** (ex-Sendinblue)              | Monthly tiers | ~$25/mo · 20K emails | Limited isolation                      | Good                  | Drag-and-drop editor         | EU-based company      | Marketing + transactional combined |

### Recommendation: SendGrid

SendGrid is the industry standard for multi-tenant SaaS transactional email. Its **Subuser** system maps directly to Pilloto's tenant model: each tenant gets a subuser with its own sending domain, bounce tracking, and reputation — all managed under the platform's master account. This is exactly the model Mews and Cloudbeds use.

The **Microsoft Graph API integration should be deprecated** for transactional email. Graph Mail is designed for accessing mailboxes, not sending transactional messages at scale. It has rate limits, no bounce handling, no delivery events, and no multi-tenant isolation.

AWS SES is a reasonable secondary option for enterprises on an AWS stack or very high-volume scenarios. It should not be the default because it requires significant manual work to achieve the same deliverability and isolation guarantees SendGrid provides out of the box.

---

## External Setup Requirements

The following must be provisioned outside of the Pilloto application:

**Platform (one time, done by Pilloto):**

- Create a SendGrid account (paid plan)
- Create and authenticate a master sending domain with SPF, DKIM, and DMARC DNS records
- Enable the Subuser API in the SendGrid account
- Store the SendGrid Master API key as a server environment variable (`SENDGRID_API_KEY`)

**Per Tenant (done at onboarding or later by the tenant admin):**

| Option                                      | What the Tenant Provides                               | What Pilloto Configures                                                          |
| ------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Platform subdomain** (default, all plans) | Nothing                                                | Creates a SendGrid Subuser; uses `mail.{slug}.pilloto.com` as the sending domain |
| **Custom domain** (pro/enterprise)          | Adds 2–3 DNS records to their domain registrar         | Creates a SendGrid Subuser; authenticates their custom domain via the API        |
| **Bring-your-own SMTP** (enterprise only)   | Their own ESP credentials (host, port, user, password) | Stores credentials encrypted; routes that tenant's sends through their own relay |

**DNS records a tenant must add for custom domain sending:**

- One CNAME record for DKIM signing (value provided by SendGrid after domain setup)
- One TXT record to include in SPF (or add to an existing SPF record)
- Recommended: a DMARC policy TXT record at `_dmarc.{domain}` — the tenant's own responsibility

---

## Communication Types

| Email                      | Trigger                                                | Type          |
| -------------------------- | ------------------------------------------------------ | ------------- |
| Reservation confirmation   | Status changes to "confirmed" (auto or manual)         | Transactional |
| Reservation cancellation   | Status changes to "cancelled"                          | Transactional |
| Payment receipt            | A payment is recorded                                  | Transactional |
| Folio (itemized bill)      | Staff action or auto on checkout                       | Transactional |
| Payment summary            | Staff action                                           | Transactional |
| Pre-arrival reminder       | N hours before check-in date (configurable per tenant) | Operational   |
| Post-checkout survey link  | After checkout is recorded (optional, off by default)  | Marketing     |
| Email address verification | Account registration                                   | Transactional |
| Password reset             | Password reset request                                 | Transactional |

---

## Regulatory Compliance

**CAN-SPAM (United States):** All emails must include the property's physical mailing address, an honest subject line, and a clear sender identity. Transactional emails (confirmations, receipts) are exempt from opt-in requirements but must still comply with sender identity rules. The tenant footer field captures the property address.

**GDPR (European Union):** Reservation confirmations and receipts are contractually necessary and do not require separate consent. Marketing emails (surveys, promotions) require prior opt-in consent. The platform must:

- Honor guest opt-out requests and persist those preferences per tenant
- Provide a mechanism for guests to request deletion of their communication history
- Enforce log data retention limits (90-day TTL recommended)
- Process personal data under a Data Processing Agreement (DPA) with the ESP — SendGrid provides a standard DPA as part of its terms of service

**CASL (Canada):** Express consent is required before any commercial or marketing email. Handling is identical to GDPR opt-in. Transactional emails tied to an existing reservation are exempt.

**Practical rule:** Every communication type in this system is tagged as either `transactional` or `marketing`. Marketing emails check a per-guest opt-in flag before sending. An unsubscribe link in marketing emails updates that flag. No separate consent mechanism is required for transactional types — only a valid sender identity and a physical address in the email footer.

---

## Tenant Plan Feature Differentiation

| Capability                                             | Basic  | Pro     | Enterprise |
| ------------------------------------------------------ | ------ | ------- | ---------- |
| Platform subdomain sending (`mail.{slug}.pilloto.com`) | Yes    | Yes     | Yes        |
| Custom branded From name and address                   | Yes    | Yes     | Yes        |
| Custom sending domain (hotel's own domain)             | No     | Yes     | Yes        |
| Pre-arrival reminder automation                        | No     | Yes     | Yes        |
| Post-checkout survey                                   | No     | Yes     | Yes        |
| Email delivery log (view sent emails)                  | 7 days | 30 days | 90 days    |
| Bring-your-own SMTP relay                              | No     | No      | Yes        |

---

## Implementation Phases

**Phase 1 — Foundation**
Replace the platform-level transport with SendGrid. Implement per-tenant email settings (From name, From address, transport preference). Migrate existing templates (confirmation, password reset, verification) to a branded layout with tenant branding injection. Add an email delivery log. Add manual "Send" actions to the Reservation detail screen. Add an Email configuration tab to the tenant Settings page.

**Phase 2 — Automation and Extended Templates**
Add the folio, payment receipt, payment summary, and cancellation templates. Implement the pre-arrival reminder cron. Add delivery status tracking via SendGrid event webhooks (delivered, opened, bounced, unsubscribed). Expose the delivery log to admins with resend capability for failed sends.

**Phase 3 — Advanced Configuration and Compliance**
Custom domain authentication flow (tenant adds DNS records, platform verifies via SendGrid API). Post-checkout survey with per-guest opt-in tracking. Data retention TTL enforcement on email logs. Bring-your-own SMTP relay for enterprise tenants with credentials stored encrypted. GDPR guest data export and deletion support.
