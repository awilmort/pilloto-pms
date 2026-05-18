Customer / Public Booking

- Public booking engine: tenant‑branded /booking public surface (room-type-first inventory, availability, quotes, embed widgets).
- Guest reservations: create guest reservation, send confirmation email, public view/cancel via confirmation token or code.
- Email verification: send + confirm 4-digit verification before finalizing booking.
- Booking quotes & pricing: public quotes per room-type, per-service; detailed tax/fee breakdown.
- Booking UI pages: reservation summary, reservation confirmation page, booking terms/privacy pages.
- Online-bookable services: daypass/pasatarde/event and other services available on booking engine.
- Reviews display: public reviews for trust bar on booking pages.
  Customer Account
- Customer dashboard: profile, logged-in reservations list and details, payment status display.
  Admin / Back-office
- Admin dashboard: stats (rooms, reservations), quick actions, recent items.
- Reservations management: list/search/filter, view/edit, assign rooms (single/multiple), check-in/check-out flows, change status, cancel, corporate price approval/decline, send reservation emails.
- Folio / Charges & Payments: add/edit/delete charges; record/edit/delete payments; payment stages (deposit / in_house); payment methods (cash/card/transfer/credit/check); use credit flows; payment receipts/printing; invoice generation when folio closed.
- Rooms & Accommodations: rooms CRUD, room ops (status/condition), room types, booking calendar and availability views.
- Pricing & Rate Plans: rate plans per room type, occupancy tiers, base price modes, calculate prices, price quotes.
- Pricing rules & promotions: pricing rules (discount/surcharge/custom), blackout dates, date/period patterns, company/guest targeted rules.
- Taxes: configure taxes (percentage/fixed, inclusive/exclusive, priority, apply-to rules).
- Service management: services CRUD, service prices, service quotes.
- Charge templates & charge rules: reusable charge templates, automated charge rules and executions, audit of rule executions.
- Media & uploads: media CRUD, file uploads, media sync, featured/public images.
- Guests & Companies (corporate): guest CRUD, company CRUD, guest-company links, corporate pricing flows.
- Users, Roles & Permissions: user management, role management, permission-based access control.
- Cashier & Revenue: cashier closures (shift totals, denominations), revenue endpoints, commissions/salesman stats.
- Wristbands: wristband deliveries, usage reports, create/update/delete deliveries.
- OTA / iCal integration: OTA listing mappings, inbound/outbound feeds, token rotation, sync runs, conflict queue + conflict resolution workflows.
- Audit / Automation: scheduled/manual audit runs for rules, audit runs + executions listing.
- Admin settings: App/OTA/booking settings, booking legal/branding/versioning, night-audit settings.
  Financial / Reporting
- Folio summary endpoints: charges/payments/totals/balance/balance-on-arrival/credit-availability.
- Payment processing helpers: process account-receivable payments, mark credit payments, payment totals aggregation for cashier closures.
- Print & export: print receipts, invoices, payment summaries (frontend print utilities).
- Reports: revenue queries, cashier previews, tenant/platform stats.
  Integrations & Webhooks
- Email service: templated reservation, invoice and transactional emails; SES webhook handling and resend endpoints.
- Webhooks: SES/webhook handlers + resend mechanism.
- OTA providers: airbnb/booking_com/vrbo/expedia/other iCal sync support and conflict detection.
  Utilities & Misc
- Multi-tenant support: X-Tenant-Slug injection in API client, tenant-scoped queries and settings.
- Plans & entitlements gating: feature gating by plan (basic/pro/enterprise) — booking engine and other Pro+ features controlled by plans config.
- Print helpers: HTML print templates for folio, payment receipt, payment summary.
- Audit & logs: audit run records, charge-rule execution logs, admin audit endpoints.
- Privacy/Legal: Terms and Privacy versioning and acceptance flows, privacy requests handling.
- Rate limiting handling: API client handles 429 responses gracefully.
