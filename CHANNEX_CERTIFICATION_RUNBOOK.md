# Channex certification — step-by-step runbook

Written 2026-11-05 for the Channex PMS certification
(https://docs.channex.io/api-v.1-documentation/pms-certification-tests), Stage 2 "Run the test scenarios".
Everything below is done in the **deployed** Pilloto (Render + Vercel + Atlas) against **Channex staging**.

Labels are given as they appear in the Spanish UI, English in parentheses where I could confirm it in the
translation files. Test dates and values were read from the Channex page on 2026-11-05 — **re-open the page
and compare before you start**; if a date or value differs, the page wins.

Related: `CHANNEX_PMS_READINESS.md` (how the integration works), `CHANNEX_IMPLEMENTATION_PLAN.md` (Phase 10/11).

---

## 0. Ground rules (read once)

1. **Certification happens on Channex staging** (`staging.channex.io`, your staging API key). Production Channex
   (`app.channex.io`) comes only after Stage 4 passes. So on Render: `CHANNEX_ENV=staging`.
2. **Every test is a normal action in the Pilloto UI.** No scripts, no Postman, no Channex UI for making the
   changes (Channex's UI is only for reading and for cleanup).
3. **One test = one Save, then wait.** Pilloto groups changes made within a few seconds into one Channex call.
   After each test, wait until its row appears in the Sync log (section 8) **before** starting the next one.
   If you start the next test sooner, the two tests can merge into one call and the test fails.
4. **Don't deploy to Render while testing.** A restart is safe (nothing is lost) but muddies the logs.
5. **Don't run the backend on your laptop with the same Channex key** while the deployed one is running
   (see 2.3).

Addresses used below (use the ones you log in with today; I assume the usual pattern):

| What | Address |
|---|---|
| Platform console (superadmin) | `https://admin.<your domain>` → **Channel Manager** |
| Test tenant | `https://<slug>.<your domain>` (slug from step 3.1, e.g. `test-property`) |
| API (Render) | `https://pilloto-pms.onrender.com` |

---

## 1. Render and Vercel configuration

### 1.1 Your webhook URL

Your public API host is the Render address you already use:

```
CHANNEX_WEBHOOK_URL=https://pilloto-pms.onrender.com/api/webhooks/channex
```

The `{"success":false,"message":"Tenant 'pilloto-pms' not found or inactive."}` you saw when opening
`https://pilloto-pms.onrender.com/api` in the browser is expected and harmless: the API reads the first part of
the host name as a tenant slug. The Channex webhook route is registered **before** that tenant lookup
(`backend/src/index.ts`, "MUST be registered BEFORE resolveTenant"), so it does not go through it. A browser
visit to the webhook URL is not a valid test (it only accepts signed POSTs); the real test is the **Test webhook**
button in step 1.3.

If you later put the API behind your own domain (for example `api.pilloto.com`), change this variable and press
the webhook update button again.

### 1.2 Render environment (backend service)

Keep everything that exists today. Add:

| Variable | Value |
|---|---|
| `CHANNEX_ENV` | `staging` |
| `CHANNEX_API_KEY` | your **staging** API key (Channex staging → Organization → API Keys) |
| `CHANNEX_WEBHOOK_URL` | the URL from 1.1 |
| `CHANNEX_WEBHOOK_SECRET` | added in step 1.3 (leave out for now) |

Do **not** set `CHANNEX_WORKERS_DISABLED`. `CHANNEX_BASE_URL` is optional (staging is the default).
Your key has no IP whitelist, so nothing to add for Render's IPs.

Save → Render redeploys. In the Render **Logs** you should see:

- `🔌 Channex configured (staging, https://staging.channex.io)`
- `⚠️  Channex: CHANNEX_WEBHOOK_SECRET is not set …` (expected until 1.3)
- `🔌 Channex workers running (ARI 5 s tick, booking feed every 2 min, nightly full sync at 03:00 property time)`

If the first line is missing, the API key variable is not being read.

### 1.3 Webhook and signing key (platform console)

Open `admin.<your domain>` → **Channel Manager**, "Platform" box:

1. Press **Health check** → must show success.
2. Press **Create signing key** → a dialog shows the secret **once**. Copy it.
3. Render → add `CHANNEX_WEBHOOK_SECRET=<that secret>` → Save (redeploys).
4. Back in the console press the create/update global webhook button, then the test button.
   Success = the console shows what Channex got from your server and "Last webhook received" gets a time.

Until step 3 is done the endpoint answers 503, which makes Channex retry instead of losing events. Keep the key,
signing key id and webhook id in your password manager, not in the repo.

### 1.4 Vercel (frontend)

Nothing Channex-specific. `REACT_APP_API_URL=https://pilloto-pms.onrender.com/api` is correct. The Channex channel
screen is embedded as a frame whose address the backend supplies; the frontend sets no frame restrictions.

### 1.5 Atlas / data

- The test tenant needs a plan with the Channel Manager (Pro or Enterprise).
- Your notes say `npm run migrate:property-profile -- --apply` was never applied. Check whether production tenants
  still need it (old e-CF/contact fields). A brand-new tenant does not.

---

## 2. Clean up before you start

Why: the Channex page says "prepare a **new** property for testing", and the property name must be
`Test Property - (Provider Name)`. Your old staging property has that same name and dev history, and the global
webhook and the booking feed cover the **whole Channex account**, not one property.

Your laptop uses a local Mongo database, production uses Atlas. They don't share data, so production does not
know the old Channex properties; it will create new ones.

### 2.1 In Channex staging (delete, in this order)

1. Old property **Test Property - Pilloto** (id begins `55a3f3c8`): open **Channels** and delete the Booking.com
   channel first (this also frees test hotel `12152494`, which Channex would otherwise refuse with
   "Channel already exists" when you connect it to the new property).
2. Delete the property itself (rooms, rate plans and ARI go with it).
3. Same for the second dev property **test-property-2** (id begins `feb2e42c`).
4. Delete their (now empty) **groups**.
5. Check **no unacknowledged booking revisions** are left (your CRS test `OFL-9501` was acknowledged).
6. Check the webhooks list is empty (it was on 2026-11-02).

### 2.2 Keep

The organisation, the staging API key, the billing account.

### 2.3 On your laptop

In `backend/.env` set `CHANNEX_WORKERS_DISABLED=true` (or blank `CHANNEX_API_KEY`). Otherwise your laptop polls the
same account-wide booking feed and tries to push to a property that no longer exists, producing alerts and noise.

---

## 3. Create the test property in Pilloto

Names matter: the reviewers compare against the Channex page.

### 3.1 Tenant

Platform console (`admin.<your domain>`) → **Tenants** → **New Tenant**:

- Name: **`Test Property - Pilloto`** (this becomes the Channex property title)
- Plan: Pro or Enterprise
- Slug e.g. `test-property`
- Owner e-mail: a mailbox you read (channel alerts are e-mailed to it)

### 3.2 Property profile — do this before any reservation

Log in to the tenant → **Configuración** → **Perfil de la propiedad** (`/admin/settings/profile`):

- Currency **USD** (it locks once reservations exist)
- Time zone **America/Santo_Domingo**
- Complete the contact data: e-mail, phone, address, city, state, **country as 2 letters (`DO`)**, zip

Do not configure taxes for this tenant. With taxes on, the price sent to Channex can differ from the number you
type, and the test values must match exactly.

### 3.3 Room types

**Configuración → Tipos de habitación** (or **Precios → Tipos de habitación**):

| Name (exactly) | Capacity |
|---|---|
| `Twin Room - 2 Occupancy` | 2 |
| `Double Room - 2 Occupancy` | 2 |

Pilloto sends the room-type name as the Channex title. The Channex page names them this way in its setup section
and "Twin Room" / "Double Room" in the test tables, so the longer name satisfies both.

### 3.4 Rooms — the counts matter

**Habitaciones** (`/admin/rooms`): create and set **active**:

- **8 Twin rooms** (e.g. Twin 101 … Twin 108) → type Twin
- **5 Double rooms** (e.g. Double 201 … Double 205) → type Double

Why 8 and 5: Pilloto computes availability from real rooms. Test 9 needs Twin 7 on one night (8 − 1 booking).
Test 10 needs Double **4** over a range, which is impossible with the Channex page's suggested "Double = 1".
Five Double rooms gives: 5 − 1 block = 4 (Test 10), and 5 − 5 bookings = 0 (Test 9, with 4 pre-booked
beforehand — section 4.4).

### 3.5 Rate plans

**Precios → Planes de tarifa**, four plans:

| Room type | Name (exactly) | Nightly price |
|---|---|---|
| Twin | `Best Available Rate` | 100 |
| Twin | `Bed & Breakfast Rate` | 120 |
| Double | `Best Available Rate` | 100 |
| Double | `Bed & Breakfast Rate` | 120 |

The test tables call the second plan "Bed & Breakfast"; the setup section names it "Bed & Breakfast Rate".
Use the longer one. Leave "Vender en canales" (sell on channels) on for all of them.

---

## 4. Build the realistic data (before you activate)

### 4.1 What "realistic 500-day calendar" means

When you press **Activate**, Pilloto sends one big full sync: the next **500 days** of availability for every room
type, and of price + restrictions for every rate plan. Channex looks at that payload and rejects data that is
obviously a placeholder, the page's own example being "all rooms 1 availability and 100 USD" on every day.
They want to see what a hotel's data looks like.

You do **not** need a reservation on every one of the 500 days. A real hotel has:

- **Prices that change.** Weekends cost more than weekdays, high season costs more than low season, there are a
  few promotions. So: the price per night varies across the 500 days.
- **Rules that change.** A few nights with a 2- or 4-night minimum, a few "no arrivals" or "no departures" days,
  maybe a maximum stay, a few nights closed to sale.
- **Availability that changes.** Bookings are denser in the next few months and thin out toward the end of the
  window; a few rooms are out of service. So: the availability numbers differ from day to day, not "8 on every
  day". Far-future days at full availability are normal.

The recipe below is a minimum that is clearly "a hotel". More is fine.

**Edits made now are not pushed one by one.** Pilloto only records changes for tenants whose channel manager is
enabled. Everything you do in sections 4.2–4.4 simply sits in Pilloto and goes out in the activation full sync
(Test 1) in two calls.

### 4.2 Prices (Precios → Calendario → Edición masiva / Bulk edit)

Open **Precios** (`/admin/pricing`) → tab **Calendario** → **Edición masiva**. Each "row" is: rates × dates ×
weekdays × a value. All rows are saved together with **Guardar todo**. A later row wins over an earlier one where
they overlap. The window is today (2026-11-05) to 2028-03-18; "Hasta (incluido)" is inclusive.

Enter these rows in this order (**avoid** the exact test values 333, 444, 456.23, 241, 312.66, 111, 432, 342):

| # | Rates | From → To | Weekdays | Nightly price |
|---|---|---|---|---|
| 1 | both **Best Available Rate** plans | 2026-11-06 → 2028-03-18 | Fri, Sat | 130 |
| 2 | both **Bed & Breakfast Rate** plans | 2026-11-06 → 2028-03-18 | Fri, Sat | 150 |
| 3 | both BAR plans | 2026-12-19 → 2027-01-04 | every day | 160 |
| 4 | both B&B plans | 2026-12-19 → 2027-01-04 | every day | 185 |
| 5 | both BAR plans | 2027-03-24 → 2027-04-04 | every day | 150 |
| 6 | both B&B plans | 2027-03-24 → 2027-04-04 | every day | 175 |
| 7 | both BAR plans | 2027-05-03 → 2027-06-17 | Mon–Thu | 85 |
| 8 | both B&B plans | 2027-05-03 → 2027-06-17 | Mon–Thu | 105 |
| 9 | both BAR plans | 2027-07-01 → 2027-08-31 | every day | 140 |
| 10 | both B&B plans | 2027-07-01 → 2027-08-31 | every day | 165 |

Result: weekday 100/120, weekend 130/150, high season 160/185, a spring-break bump, a low-season promo, a summer
season. Nov 2027 (the test month) is plain weekday/weekend pricing, so every test value is a visible change.

### 4.3 Booking rules (same dialog, more rows — or a second save)

| # | Rates | From → To | Weekdays | Field |
|---|---|---|---|---|
| 11 | all four plans («Todas») | 2026-11-06 → 2028-03-18 | Fri, Sat | Minimum stay 2 |
| 12 | all four plans | 2026-12-24 → 2027-01-02 | every day | Minimum stay 4 |
| 13 | Twin plans | 2027-02-14 → 2027-02-15 | every day | «Cerrar a la venta» (stop sell) |
| 14 | both B&B plans | 2027-06-05 → 2027-06-05 | — | «Sin llegadas» (no arrivals) |
| 15 | all four plans | 2027-07-10 → 2027-07-10 | — | «Sin salidas» (no departures) |
| 16 | all four plans | 2027-08-01 → 2027-08-31 | every day | Maximum stay 14 |

All of these are 2027 or later, so none touches the test days in Nov 2027 except row 11 (weekend minimum
stay), which the tests overwrite where they need to.

### 4.4 Reservations and blocks (the availability variation)

Create with **Nueva reserva** (Booking calendar `/admin/booking-calendar` → **Nueva reserva**, or the
Reservations screen). Status confirmed, any guest name/e-mail. Out of service: **Habitaciones** → a room's
**Fuera de servicio** button, or in the Booking calendar click an empty slot →
**Poner habitación fuera de servicio**. In a block the end date is the day the room is **back** — that day is not
blocked.

**General realism (about 25 bookings, 3 blocks).** Aim for roughly:

| When | Reservations |
|---|---|
| next 90 days | ~12, 1–7 nights each, mixed Twin/Double, some overlapping so some nights show Twin 5 or 6 of 8 |
| days 90–365 | ~8 (include 4 Twin rooms booked 2026-12-26 → 2027-01-02) |
| days 365–499 (before the test month) | ~3 |
| blocks | Twin 108: 2027-02-01 → 2027-02-08; Double 205: 2027-06-14 → 2027-06-21 |

**Keep November 2027 empty, except for the following setup**, because Tests 9 and 10 expect exact numbers there.

**Pre-test setup (do it now; it goes out in the activation sync and makes Tests 9/10 one action each):**

| What | Dates | Why |
|---|---|---|
| **4** separate Twin reservations (or 2 reservations + 2 blocks), 4 different rooms | check-in 2027-11-10, check-out 2027-11-17 | Twin availability is 4 on the nights 10–16 Nov. Test 10 later blocks the 5th → **3**. |
| **4** separate Double reservations | check-in 2027-11-25, check-out 2027-11-26 | Double availability is 1 on the night of 25 Nov. Test 9 later books the 5th → **0**. |

### 4.5 Before you activate — check

- **Precios → Calendario**: scroll a few months; prices differ by weekday/season, some cells show restrictions.
- The Booking calendar shows bookings spread over the year and the Twin/Double lanes differ day to day.
- Nothing in Nov 2027 except the two setup groups above.

---

## 5. Activate the channel manager → Test 1 (full sync)

### 5.1 Activate

**Configuración → Channel Manager** (`/admin/settings/channel-manager`). The setup wizard steps are
Introducción → Tu propiedad → Habitaciones → Precios → Reglas → Reservas → **Activar**. Walk through them
(red items = something missing; each links to where to fix it), then press **Activar**.

What happens: Pilloto creates the group and property in Channex staging (currency USD, `property_type: hotel`, the
time zone, `state_length 500`), creates the 2 room types and 4 rate plans, then queues the **go-live full sync**.

**Do not touch anything in Pilloto for the next minute.** An edit during that time would add a call to the log.

### 5.2 Verify Test 1

The full sync is exactly **two calls**: one `/availability` for the two room types over 500 days, one
`/restrictions` for the four rate plans over 500 days.

- Tenant side: **Configuración → Channel Manager → Actividad de sincronización** shows the rows.
- Platform side: `admin.<domain>` → **Channel Manager** → the tenant → **Sync log**. Expect 2 rows:
  `availability` and `restrictions`, with the same date span (today → today+499 days), each with task ids
  (copy button). **Write them down** (table in section 12).
- Channex staging (read-only) → the new property → calendar: check that prices and availability show the variation
  you created, 500 days out.

If something looks wrong (for example you forgot data), fix it in Pilloto and press **Reenviar todo a mis canales**
(Resend everything to my channels), then use *that* pair of task ids. The button refuses a second press within 10
minutes. Use it sparingly: full syncs should be rare (Test 13).

### 5.3 First check on prices (important for every later test)

Pick any date, for example a plain weekday in Nov 2027, and compare the price in Pilloto's Calendario with the
rate in Channex's calendar (primary occupancy, 2). They must be identical. If Channex shows a different number,
stop here — every price test depends on it.

---

## 6. Tests 2–8 (rates and restrictions): Calendar → Edición masiva

How to do each test: **Precios → Calendario → Edición masiva → fill the rows → Guardar todo**. One test = one
dialog = one save = **one** `/restrictions` call. Use **Añadir fila** for more rows. For a single date put the
same date in "Desde" and "Hasta (incluido)". Fields you must leave alone: **«Sin cambio»** (no change).
Between tests wait for the Sync log row (rule 3).

Rate names below are `Room · Plan`, abbreviations: **BAR** = Best Available Rate, **B&B** = Bed & Breakfast Rate.

### Test 2 — one date, one rate

| Row | Rate | Date | Price |
|---|---|---|---|
| 1 | Twin · BAR | 2027-11-22 | 333 |

Expect 1 call, 1 value. Then verify in Channex's calendar that 22 Nov 2027 Twin BAR shows 333.

### Test 3 — single dates, several rates, one call

| Row | Rate | Date | Price |
|---|---|---|---|
| 1 | Twin · BAR | 2027-11-21 | 333 |
| 2 | Double · BAR | 2027-11-25 | 444 |
| 3 | Double · B&B | 2027-11-29 | 456.23 |

Expect 1 call, 3 values.

### Test 4 — date ranges, several rates, one call

| Row | Rate | From → To | Price |
|---|---|---|---|
| 1 | Twin · BAR | 2027-11-01 → 2027-11-10 | 241 |
| 2 | Double · BAR | 2027-11-10 → 2027-11-16 | 312.66 |
| 3 | Double · B&B | 2027-11-01 → 2027-11-20 | 111 |

Expect 1 call, 3 values (ranges).

### Test 5 — minimum stay, one call

| Row | Rate | Date | «Mínimo de noches (a la llegada)» |
|---|---|---|---|
| 1 | Twin · BAR | 2027-11-23 | 3 |
| 2 | Double · BAR | 2027-11-25 | 2 |
| 3 | Double · B&B | 2027-11-15 | 5 |

Expect 1 call.

### Test 6 — stop sell, one call

| Row | Rate | Date | «Cerrado a la venta» |
|---|---|---|---|
| 1 | Twin · BAR | 2027-11-14 | «Cerrar a la venta» |
| 2 | Double · BAR | 2027-11-16 | «Cerrar a la venta» |
| 3 | Double · B&B | 2027-11-20 | «Cerrar a la venta» |

Expect 1 call.

### Test 7 — multiple restrictions, one call

| Row | Rate | From → To | No arrivals | No departures | Max stay | Min stay |
|---|---|---|---|---|---|---|
| 1 | Twin · BAR | 2027-11-01 → 2027-11-10 | «Sin llegadas» (on) | «Permitir salidas» (off) | 4 | 1 |
| 2 | Twin · B&B | 2027-11-12 → 2027-11-16 | «Permitir llegadas» (off) | «Sin salidas» (on) | — | 6 |
| 3 | Double · BAR | 2027-11-10 → 2027-11-16 | «Sin llegadas» (on) | «Sin cambio» | — | 2 |
| 4 | Double · B&B | 2027-11-01 → 2027-11-20 | «Sin cambio» | «Sin cambio» | — | 10 |

For a "—" leave the field empty (Max stay: empty = no change; "0 = no maximum"). Expect 1 call, 4 values.

### Test 8 — half-year, rate + restrictions together, one call

| Row | Rate | From → To | Price | No arrivals | No departures | Min stay |
|---|---|---|---|---|---|---|
| 1 | Twin · BAR | 2027-12-01 → 2028-05-01 | 432 | «Permitir llegadas» | «Permitir salidas» | 2 |
| 2 | Double · BAR | 2027-12-01 → 2028-05-01 | 342 | «Sin cambio» | «Sin cambio» | 3 |

Expect 1 call, 2 values.

**Window limit.** Pilloto (and Channex, with a 500-day property) only handles today → today+499 days. On
2026-11-05 that ends 2028-03-18, which cuts this test short of 1 May 2028. **If you run Test 8 on or after
2026-12-19, the window reaches 2028-05-01 and the test is exact.** Otherwise run it as is and write in the form's
notes that the range was limited by the 500-day window.

---

## 7. Tests 9–10 (availability)

Availability changes come from **bookings and blocks**, not from the Calendar. Each action below sends one
`/availability` call within about 2 seconds. The page allows 1 or 2 calls for each test.

### Test 9 — single dates

| Step | Action in Pilloto | Result sent |
|---|---|---|
| 9a | **Nueva reserva**: 1 Twin room, check-in 2027-11-21, check-out 2027-11-22 | Twin on 21 Nov = **7** (8 − 1) |
| 9b | Wait for the Sync log row, then **Nueva reserva**: 1 Double room, check-in 2027-11-25, check-out 2027-11-26 | Double on 25 Nov = **0** (4 booked in 4.4, plus this one) |

Expect 2 availability calls (one per booking). Both task ids belong to Test 9.

### Test 10 — date ranges

| Step | Action in Pilloto | Result sent |
|---|---|---|
| 10a | Take one more Twin room out of service: start 2027-11-10, **end 2027-11-17** (nights 10–16). Pick a Twin room that is not one of the four booked rooms. | Twin 10–16 Nov = **3** (8 − 4 booked − 1 block) |
| 10b | Wait for the Sync log row, then take one Double room out of service: start 2027-11-17, **end 2027-11-25** (nights 17–24). | Double 17–24 Nov = **4** (5 − 1) |

Expect 2 availability calls. If the dialog warns about a conflicting booking on that room, pick another room.

---

## 8. Where to read task ids

`admin.<your domain>` → **Channel Manager** → open the tenant → **Sync log**. Each row = one call to Channex:

| Column | Use |
|---|---|
| kind | `availability` or `restrictions` |
| values / dates | quick check against the expected count in sections 6–7 |
| task ids + copy button | what the certification form asks for |

Rows show the trigger and any warnings. A warning or an error means Channex rejected something; fix before moving on.
If a test produced **more** rows than expected, don't submit it: wait, then redo it in a clean state (undo the change,
wait for the log, and repeat as one save).

Channex staging (read-only) → the property → its API/task log shows the same calls; reviewers use it in Stage 4.

---

## 9. Test 11 — receiving bookings (Booking CRS)

The tenant needs a channel and a mapping first, as you did on 2026-11-04:

1. **Configuración → Channel Manager → Canales → Conectar un canal → Conectar Booking.com** with test hotel
   `12152494` (USD). Map the Booking.com room(s) and rate(s) to the Twin/Double room types and their rate plans, then
   activate.
   - Activating the channel makes Channex send an `activate_channel` webhook, which now reaches your server and
     triggers a second full sync automatically. That is expected (it is the legitimate channel-activation sync), but
     it means Test 11 should come **after** Tests 1–10 so it doesn't interleave with them.
2. In Channex staging (property → **Applications**) install **Booking CRS**.
3. Channex → the property's **Bookings** → **Create**: Twin room type, rate plan «Best Available Rate», two future
   nights, one adult, your name and e-mail. Reference looks like `OFL-<number>`.
4. Within ~2 minutes (feed poller; faster when the webhook arrives) it appears in Pilloto **Reservations** with the
   channel badge and in **Reservas de los canales** (Bookings from your channels) as applied. Availability is re-sent.
5. In Channex edit the booking (dates or guests) → check Pilloto applies the modification.
6. In Channex cancel it → check Pilloto cancels and availability is restored.

What Channex wants to see: a **new** booking (not imported), a modification, a cancellation, each **acknowledged**,
fetched from `booking_revisions` (Pilloto does this; it never calls `/bookings`), preferably through webhooks
(now live). Write down the booking id and the three revision ids.

---

## 10. Tests 12–14 (answered in the form)

| Test | Answer |
|---|---|
| 12 Rate limits | Yes. Per-property outbox with debounced batching, at most 8 calls per minute per endpoint, exponential pause (60 s doubling to 15 min) on 429/5xx. |
| 13 Update logic | Yes. Only deltas triggered by PMS changes. A full sync runs at go-live, on a manual button (10-minute guard), when a channel is activated, and once at 03:00 property time (skipped if one ran in the last 20 h, staggered across properties). Be ready to explain the nightly one: it is a safety net on top of delta updates, not a replacement. |
| 14 Extra | Min stay: **arrival** only. Supported restrictions: stop sell, CTA, CTD, min stay arrival, max stay. Multiple room types and multiple rate plans per room type: yes. Credit card details: not needed; only masked card data (last 4, type, expiry) is stored. PCI: not certified, no tokenization service. |

---

## 11. Submit, then the screenshare

1. **Submit** (Stage 3): https://forms.gle/xA8F3eSYBPBd8apYA — task ids per test (section 12) and notes (Test 8 window,
   Double rooms = 5 and why).
2. **Screenshare** (Stage 4): Channex watches API calls fire while you make changes in Pilloto. Have ready:
   - the tenant's Calendario (`/admin/pricing`, tab Calendario) and Booking calendar,
   - Channel Manager → Actividad de sincronización and Reservas de los canales,
   - the platform console Sync log (task ids),
   - Channex's property log in another window,
   - the code: `services/channex/changeCapture.ts` (where changes are detected), `ariWorker.ts` (where
     `POST /availability` and `POST /restrictions` are called), `bookingInbox.ts` (acknowledgement).
   - Do not trigger a full sync during the call unless they ask.
3. If they pass you: Stage 5 production credentials. Then plan Phase 11 (`CHANNEX_ENV=production`, production API
   key with IP whitelist of Render's outbound IPs, new signing key and webhook).

---

## 12. Task id record

| # | Test | Calls expected | Task id(s) | Done |
|---|---|---|---|---|
| 1 | Full sync (go-live) | 1 availability + 1 restrictions | | ☐ |
| 2 | One date, one rate | 1 | | ☐ |
| 3 | Single dates, 3 rates | 1 | | ☐ |
| 4 | Ranges, 3 rates | 1 | | ☐ |
| 5 | Min stay | 1 | | ☐ |
| 6 | Stop sell | 1 | | ☐ |
| 7 | Multiple restrictions | 1 | | ☐ |
| 8 | Half-year, rate + restrictions | 1 | | ☐ |
| 9 | Availability, single dates | 1–2 | | ☐ |
| 10 | Availability, ranges | 1–2 | | ☐ |
| 11 | Booking new / modify / cancel (booking id + revision ids) | acks | | ☐ |
| 12–14 | Answers in the form | — | — | ☐ |

---

## Troubleshooting

| Symptom | Likely cause / action |
|---|---|
| Test produced 2 `restrictions` rows | A second change was saved within ~5 s, or two tests overlapped. Wait for the log between tests. |
| Nothing in the Sync log after a Save | Pilloto groups changes for up to 30 s. If still nothing: platform console → the tenant → paused? backoff? kill switch? Check "Workers (this instance)" and "Last ARI tick". |
| Console shows "paused" with a backoff | Channex returned 429/5xx or an auth error; the worker retries by itself (60 s doubling to 15 min). |
| Price in Channex ≠ price typed | Stop; taxes configured, or rate plan occupancy pricing. Tell me what you see before continuing. |
| "Channel already exists" for hotel `12152494` | The old Channex property still has that channel. Delete it (2.1 step 1). |
| Webhook test fails | `CHANNEX_WEBHOOK_SECRET` not set/redeployed, wrong `CHANNEX_WEBHOOK_URL`, or the webhook was not updated after the secret was set. |
| Alerts appear under **Distribución → Alertas de canales** | Open them: "Qué pasó / Qué hacer". Critical ones are also e-mailed to the owner. |
