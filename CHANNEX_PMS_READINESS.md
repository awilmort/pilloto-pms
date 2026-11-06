# Pilloto ↔ Channex: how the integration works and where it lives

Checked against the code on 2026-11-04, ahead of the
[Channex PMS certification tests](https://docs.channex.io/api-v.1-documentation/pms-certification-tests).
Design background: `CHANNEX_ARCHITECTURE.md`; build plan and staging pass: `CHANNEX_IMPLEMENTATION_PLAN.md`.

This file has two parts:

1. **Pre Requisites**: the five things Channex says a PMS should already have, whether Pilloto has each one, how it
   works, where it is in the code and where to find it in the UI.
2. **Pre-flight check**: five direct questions, answered yes/no with the file and line behind each answer.

All backend paths are under `backend/src/`, frontend paths under `frontend/src/`.

---

# Part 1 — Pre Requisites

Before starting, Pilloto should already have:

| # | Prerequisite | Pilloto has it? | Notes |
|---|---|---|---|
| 1 | A mechanism in your PMS that detects ARI changes (availability, rate, restriction) as they happen — not a polling loop over your database. | **Yes** | A Mongoose plugin on seven models writes an outbox row in the same request as the change (1.1). |
| 2 | A queue or outbox that batches those changes into Channex API calls, respecting the 20 ARI/minute rate limit. | **Yes** | `ChannelAriChange` outbox; the worker sends at most one availability call and one restrictions call per flush, and at most 8 calls per minute per kind per property (1.2). |
| 3 | A retry/backoff mechanism for 429 and 5xx responses. | **Yes** | Rows are re-queued and the property is paused with exponential backoff, 60 s doubling to 15 min. `Retry-After` is read but the worker does not use it (1.3). |
| 4 | A webhook endpoint to receive bookings from Channex and an acknowledgement flow. | **Yes, with one caveat** | A signed webhook and a 2-minute feed poller both feed one inbox, which acknowledges each revision. The webhook has not yet received a real Channex delivery (1.4). |
| 5 | A mapping layer between your internal room/rate IDs and Channex UUIDs. | **Yes** | `ChannexEntityMap`, maintained by structural sync, with a repair screen (1.5). |

Rate limit numbers: Channex's page says 20 ARI calls per minute; the architecture notes say 10 per minute per kind.
Pilloto stays under both with its own cap of 8 per minute per kind per property (`CALLS_PER_MINUTE` in
`services/channex/ariWorker.ts`).

## 1.1 ARI change detection (prerequisite 1)

**File:** `services/channex/changeCapture.ts`.

- `changeCapturePlugin` is attached to `Reservation`, `Room`, `RoomBlock`, `RoomType`, `RatePlan`, `PricingRule`
  and `RestrictionRule` (`CAPTURE_MODELS`; the `.plugin(...)` line is at the bottom of each model file).
- Document `save` and query hooks (`findOneAndUpdate`, `updateOne`, `updateMany`, deletes, replaces, `insertMany`)
  read the old values before the write and the new values after it. `deriveRows` (pure, no database) turns the
  difference into outbox rows: `{kind: availability | rates | structure, roomTypeId / ratePlanId, dateFrom, dateTo,
  fields, reason}`.
- Ranges are supersets: a range may be over-reported, never under-reported. The values sent to Channex are always
  recomputed from Pilloto's current state at push time, so a repeated or merged row can never push stale data.
- Rows are written only for tenants that enabled the channel manager. A capture failure is logged and never fails the
  user's save; the full sync is the safety net.
- `onOutboxWrite` lets the worker react right after availability rows are written, so a sold room reaches the
  channels within seconds.

Pilloto-side write paths that produce rows: reservations (create, edit, move, cancel, channel bookings), rooms and
room blocks, room types and rate plans, price rules and restriction rules, and the Calendar's bulk save
(`routes/rateCalendar.ts` → `services/rateCalendar.ts` `applyBulkChanges`).

There is a 5-second timer (see 1.2), but it only drains rows that writes already created; detection itself happens at
write time.

## 1.2 Outbox, batching and rate limit (prerequisite 2)

**Files:** `models/ChannelAriChange.ts` (outbox), `services/channex/ariWorker.ts` (worker),
`utils/channexCron.ts` (schedules), `services/channex/fullSync.ts`, `services/channex/rateResolver.ts` and
`services/channex/inventory.service.ts` (the values pushed).

- **Outbox:** `ChannelAriChange` rows go `pending → in_flight → done | failed`; done rows expire after 14 days.
- **Worker:** `ariTick` runs every 5 seconds (`*/5 * * * * *`) and right after availability writes. It takes a
  60-second lease per property so several server instances never push the same property twice.
- **Debounce:** availability waits 1 second without further availability changes and is then pushed alone (one
  front-desk action = one call). Everything else (prices, rules, structure) waits 5 seconds of quiet or at most 30
  seconds, and goes as one batch.
- **Flush (`flushProperty`):** claim rows → structural rows first (a room type must exist before its availability) →
  merge → clamp to today…today+499 days in the property's time zone → compute values → compress into ranges of equal
  values → **at most one `POST /availability` and one `POST /restrictions`** → write a `ChannexSyncLog` row with the
  Channex task ids and any warnings.
- **Rate limit:** `SlidingWindowLimiter` allows 8 calls per minute per property and kind. When it is full, the rows
  are put back without a failure being counted.
- **Full sync (`fullSync.ts`):** one availability call and one restrictions call covering 500 days. It runs on
  go-live, on the manual button (10-minute guard), when a channel is activated (webhook), and once nightly at 03:00
  property time (skipped if one ran in the last 20 hours). There is no other timer-driven push.
- **Pause switches:** the platform kill switch (`PlatformSettings.channex.globalEnabled`), the env flag
  `CHANNEX_WORKERS_DISABLED`, and a per-tenant pause (superadmin) all stop pushes while the outbox keeps collecting.

## 1.3 Retry and backoff (prerequisite 3)

**Files:** `services/channex/channexClient.ts` (error classes), `services/channex/ariWorker.ts` (`backoffMs`,
`pauseAfterFailure`).

| Channex answer | Class | What the worker does |
|---|---|---|
| 429 | `ChannexRateLimitError` | Re-queue the rows, pause the property, back off |
| 5xx, 408, network error | `ChannexRetryableError` | Same |
| 401 / 403 | `ChannexAuthError` | Re-queue, pause 15 minutes, platform alert `api_auth_failed` |
| 4xx with an error body (validation) | `ChannexValidationError` | Rows marked `failed`, tenant alert `sync_error`, no retry |

- Backoff after the n-th consecutive failure: 60 s × 2^(n−1), capped at 15 minutes. The first success resets it.
- Each retry increments the row's `attempts` counter; there is no cap, so rows are retried until they succeed.
- After 5 consecutive failures, or 15 minutes of failing, the tenant gets a `push_failing` alert, which resolves by
  itself after the next successful push.
- Rows stuck `in_flight` for 5 minutes are released (a crashed instance cannot lose changes).
- The client never retries inside one call, so a retry always goes through the worker's rate limiter.
- The 429 `Retry-After` header is parsed (`retryAfterSeconds`) but the worker waits its own backoff, which is at least
  60 seconds and therefore at least as long as Channex's one-minute window.

## 1.4 Bookings in and acknowledgement (prerequisite 4)

**Files:** `routes/channexWebhook.ts`, `services/channex/webhookHandler.ts`, `services/channex/bookingInbox.ts`,
`services/channex/bookingMapper.ts`, `models/ChannexBookingRevision.ts`, `models/ChannexWebhookEvent.ts`.

Two sources fill one inbox (`ChannexBookingRevision`):

1. **Webhook:** `POST /api/webhooks/channex`. It is mounted before `express.json()` and tenant resolution so the
   HMAC is computed over the raw bytes. It checks `x-hmac-signature-256` (HMAC-SHA256 of `timestamp.body`, with two
   keys accepted during a rotation, ±300 s clock skew, constant-time compare), stores the event, answers 200, and
   processes it afterwards. The tenant comes only from the verified `property_id`. With no `CHANNEX_WEBHOOK_SECRET` it
   answers 503, so Channex retries instead of losing the event.
2. **Feed poller:** every 2 minutes (`30 */2 * * * *` in `utils/channexCron.ts`) it reads
   `GET /booking_revisions/feed` (all unacknowledged revisions, oldest first). This is the only source on a machine
   without a public URL, and the safety net in production.

Inbox processing (`processInbox` / `pollFeed`):

1. Store the revision (idempotent on the revision id), keeping the payload with card data removed.
2. Resolve the tenant from the property id (an unknown property fails and raises a platform alert).
3. Apply revisions per booking in `insertedAt` order (`bookingMapper.ts`): create, modify or cancel the Reservation
   (fields `channelSource.*`), map Channex room types and rate plans to Pilloto ones, apply the OTA-pay/City Ledger
   settlement, and raise alerts for unmapped rooms and overbooking.
4. **Acknowledge** (`POST /booking_revisions/:id/ack`) every applied or deliberately skipped revision. A failed
   acknowledgement is retried on the next pass; a revision that failed to apply is not acknowledged and raises a
   `non_acked_booking` alert.

Proven on staging on 2026-11-04 with Booking CRS booking `OFL-9501` through the feed poller: new, modified and
cancelled, each applied, acknowledged, and followed by an availability push (about 1m15s–1m45s end to end, which is
the poll wait). **Caveat:** the signed webhook path is covered by automated tests but has not received a real Channex
delivery, because the dev machine has no public URL and `CHANNEX_WEBHOOK_SECRET` is unset. Plan step 11.2 tests it in
production.

## 1.5 Mapping layer (prerequisite 5)

**Files:** `models/ChannexEntityMap.ts`, `services/channex/structuralSync.ts`, `services/channex/repair.ts`,
`services/channex/provisioning.ts`.

- `ChannexEntityMap` links a Pilloto `RoomType` or `RatePlan` (`localId`) to its Channex UUID (`channexId`) per
  environment, with a `status` (`active`, `orphaned`, `remap_required`) and the `syncedSnapshot` last sent.
- **Pilloto creates and maintains the Channex room types and rate plans itself** (`structuralSync.ts`); re-running is
  a no-op unless something changed. A tenant only maps OTA rooms/rates to them, inside the Channex channel screen.
  A capacity change that Channex cannot edit flags the plan `remap_required` instead.
- Outbound: the worker turns local ids into Channex ids through the map. Inbound: `bookingMapper.ts` (`loadLookup`)
  turns the Channex ids on a booking into local room types and rate plans; a booking for an unmapped room is created
  without a room and raises an alert.
- **Repair:** `loadRepairView` / `relinkEntity` / `recreateEntity` (`repair.ts`) list every entity with problems such
  as `not_synced`, `missing_in_channex`, `remap_required`, and Channex objects nothing links to.
- Property level: `ChannexProperty` (`models/ChannexProperty.ts`) holds the Channex property and group ids, push state
  (pause, backoff, last push and full sync) per tenant. Tenant screens never show Channex ids; a channel is addressed
  by its own cached `ChannexChannel` `_id`.

## 1.6 Where to find it in the UI

Tenant side (`http://<slug>.localhost:3000`, Spanish labels first):

| What | Where |
|---|---|
| Turn the Channel Manager on (setup wizard "Activar Channel Manager"), options, property details | Sidebar → **Configuración** → **Channel Manager** (`/admin/settings/channel-manager`; needs permission `admin.ota.view` and a plan with the Channel Manager) |
| Connect / continue a channel, open the channels screen | Same page → **Canales** (button **Conectar un canal**, **Abrir pantalla de canales**) |
| Bookings received from channels and their state | Same page → **Reservas de los canales** (English "Bookings from your channels") |
| Every push sent to Channex with task ids; resend everything | Same page → **Actividad de sincronización**, button **Reenviar todo a mis canales** (the manual full sync) |
| Alerts (overbooking, unmapped booking, push failing, …) and their red badge | Sidebar → **Distribución** → **Alertas de canales** (`/admin/channel-alerts`) |
| Edit prices, restrictions and see availability (these saves create the outbox rows) | Sidebar → **Precios** (`/admin/pricing`) → tab **Calendario**; bulk edit dialog inside |
| A channel reservation's OTA, history and "Offline"/OTA label | Reservations → open a reservation → channel section and **History** |

Platform side (superadmin, `http://admin.localhost:3000`):

| What | Where |
|---|---|
| Health check, workers, last feed poll, kill switch, offered OTAs, webhook setup | **Channel Manager** (`/platform/channel-manager`, page title "Channel Manager (Channex)") → Platform box |
| Tenants, pending changes, critical alerts, pause/resume pushes, full sync, enable/disable | Same page → tenants table → open a tenant |
| Sync log with task ids (copy button) and mappings | Same page → tenant → **Sync log** and **Mappings** |
| Repair ("Load from Channex", relink, recreate) | Same page → tenant → repair panel (`components/platform/channex/ChannexRepairPanel.tsx`) |

## 1.7 API routes

| Route file | Mount | Purpose |
|---|---|---|
| `routes/channexWebhook.ts` | `POST /api/webhooks/channex` | Signed Channex deliveries |
| `routes/channelManager.ts` | `/api/channel-manager/*` | Tenant status, readiness, enable/disable, full sync, sync activity, booking inbox, channels, iframe session, alerts |
| `routes/rateCalendar.ts` | `/api/rate-calendar/*` | Calendar view and bulk save |
| `routes/restrictionRules.ts` | `/api/restriction-rules/*` | Stay and closure rules |
| `routes/platform.ts` | `/api/platform/channex/*` | Superadmin console: overview, health, tenants, pause/resume, repair, full sync, webhook setup |

## 1.8 Configuration

`backend/.env`: `CHANNEX_ENV` (`staging` or `production`), `CHANNEX_API_KEY`, `CHANNEX_WEBHOOK_SECRET`,
`CHANNEX_WEBHOOK_URL`, optional `CHANNEX_BASE_URL`, `CHANNEX_WORKERS_DISABLED`. Defaults and validation:
`services/channex/config.ts`. The app starts without them; the workers then stay off.

## 1.9 Tests

Backend suites in `backend/src/__tests__/`: `channexChangeCapture`, `channexAriWorker` (batching, limiter, backoff,
429/5xx/auth/validation handling), `channexClient` (error classification), `channexFullSync`, `channexWebhook`
(signature, rotation, skew), `channexBookingInbox` (feed, ack, ordering), `channexBookingMapper`, `channexModels`,
`channexProvisioning`, `channexAlerts`, `channexChannels`, `channexTenantViews`, `channexHardening`,
`platformChannexConsole`, `platformChannexHealth`.
Run with `npm test` in `backend/` (some suites need a local MongoDB).

---

# Part 2 — Pre-flight check

Line numbers are from 2026-11-04 and will drift as the files change; the function names are stable.

## 2.1 When a user saves a price change in your PMS UI, does your code already emit a domain event or database change that your integration layer observes?

**Yes.**
The Calendar's save calls `PUT /api/rate-calendar/bulk`
([routes/rateCalendar.ts:83](backend/src/routes/rateCalendar.ts#L83)) → `applyBulkChanges`
([services/rateCalendar.ts:353](backend/src/services/rateCalendar.ts#L353)), which writes `PricingRule` /
`RestrictionRule` documents. Those models carry `changeCapturePlugin`
([services/channex/changeCapture.ts:342](backend/src/services/channex/changeCapture.ts#L342)), whose Mongoose hooks
(`save` at [:357](backend/src/services/channex/changeCapture.ts#L357) and [:370](backend/src/services/channex/changeCapture.ts#L370),
`insertMany` at [:376](backend/src/services/channex/changeCapture.ts#L376), query hooks at
[:399-420](backend/src/services/channex/changeCapture.ts#L399-L420)) observe the write and insert the outbox rows
([:319](backend/src/services/channex/changeCapture.ts#L319)). The save handler itself knows nothing about Channex.

*UI:* **Precios → Calendario** (`/admin/pricing`, tab "Calendario"), edit a price and save.

## 2.2 Do you have an outbox/queue between your PMS and the Channex client, or does your code call the Channex API directly from the save handler?

**Outbox.**
Writes land in the `ChannelAriChange` collection ([models/ChannelAriChange.ts](backend/src/models/ChannelAriChange.ts));
only the worker in [services/channex/ariWorker.ts](backend/src/services/channex/ariWorker.ts) reads it and calls
Channex. No route that saves data imports the Channex client for ARI.

*One exception, outside any save path:* the superadmin repair action "recreate rate plans" sends one stop-sell
`POST /restrictions` straight to Channex (`closeOldRatePlans`,
[services/channex/repair.ts:256](backend/src/services/channex/repair.ts#L256)) to close the old rate plans. It is
logged in the sync log with the trigger `manual`. Avoid that action during the certification run.

*UI:* pending outbox rows show as "pending changes" in the platform console tenants table
(`/platform/channel-manager`); sent batches show in **Configuración → Channel Manager → Actividad de sincronización**.

## 2.3 If Channex returns 429, does your existing retry logic back off, or does it silently drop the update?

**It backs off; nothing is dropped.**
A 429 becomes `ChannexRateLimitError`
([services/channex/channexClient.ts](backend/src/services/channex/channexClient.ts), `classifyChannexError`). The
worker puts the unfinished rows back to `pending` and pauses the property (`pauseAfterFailure`,
[services/channex/ariWorker.ts:370](backend/src/services/channex/ariWorker.ts#L370); `backoffMs` at
[:83](backend/src/services/channex/ariWorker.ts#L83): 60 s doubling to 15 min). Each retry increments the row's
`attempts` counter, but there is no cap, so rows are retried until they succeed; a validation error is the only case
where a row is marked `failed`, and it raises an alert. The test "429 → rows back to pending, property paused with
backoff, then retried with no data loss" is at
[__tests__/channexAriWorker.test.ts:279](backend/src/__tests__/channexAriWorker.test.ts#L279).

*UI:* after 5 failures the tenant sees a critical alert under **Distribución → Alertas de canales**; the platform
console shows the property's last error and backoff.

## 2.4 Where in your codebase does POST /availability get called from? Can you point to the file and line?

**One place:** [services/channex/ariWorker.ts:470](backend/src/services/channex/ariWorker.ts#L470),
`client.post(kind.path, { values })`. The path comes from the table built at
[:451](backend/src/services/channex/ariWorker.ts#L451) (`{ name: 'availability', path: '/availability', … }`), inside
`flushProperty`. This is production code that runs on the server whenever availability changes (it produced the task
ids in the sync log on staging). It is the only place in the application that sends availability to Channex; the test
files only replace the Channex client with a fake to check what this code would send. `POST /restrictions` is called
from the same loop ([:452](backend/src/services/channex/ariWorker.ts#L452)) and from the repair exception in 2.2.

*UI:* every call it makes appears, with its Channex task ids, in **Configuración → Channel Manager → Actividad de
sincronización** and in the platform console's **Sync log**.

## 2.5 If you deleted all your certification test code right now, would your PMS still push updates to Channex correctly?

**Yes, because there is none.**
There is no certification-specific code in the backend or frontend (a search for "certif" finds only unrelated
e-invoicing environments and a comment). Tests 1–10 are run by performing actions in the normal UI and copying task
ids from the sync log; the only code involved is the production path above. Deleting every file in
`backend/src/__tests__/` would also leave the runtime unchanged, since tests are not imported by the app.

*UI:* the same screens as 2.1–2.4. For the certification run, the table in plan section 10.2
(`CHANNEX_IMPLEMENTATION_PLAN.md`) lists which UI action produces which call.
