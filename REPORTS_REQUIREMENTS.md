# Pilloto PMS — Reports Gap Analysis & Implementation Plan

> **Created**: June 2, 2026
> **Purpose**: Identify missing enterprise-grade reports, compare against what Pilloto already has, and define an implementation roadmap.

---

## Table of Contents

1. [What Pilloto Currently Has](#1-what-pilloto-currently-has)
2. [Enterprise PMS Report Standards](#2-enterprise-pms-report-standards)
3. [Gap Analysis: Reports to Build](#3-gap-analysis-reports-to-build)
   - [Tier 1 — Critical](#tier-1--critical)
   - [Tier 2 — High Value](#tier-2--high-value)
   - [Tier 3 — Competitive Differentiators](#tier-3--competitive-differentiators)
4. [Special Note: Room Status vs. Accommodations Page](#4-special-note-room-status-vs-accommodations-page)
5. [Implementation Plan](#5-implementation-plan)

---

## 1. What Pilloto Currently Has

| Report                 | Route                             | Type                     | Notes                                                                  |
| ---------------------- | --------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| Admin Dashboard        | `/admin`                          | Operational overview     | Basic stats: rooms, reservations, YTD revenue, monthly trends          |
| Schedule Summary       | `/admin/schedule`                 | Daily operations         | Shows arrival/departure **counts** only — not a printable ops list     |
| Booking Calendar       | `/admin/booking-calendar`         | Visual occupancy grid    | Calendar view of room assignments, not metrics                         |
| Revenue Report         | `/admin/revenue`                  | Financial                | Revenue by type (room/daypass/event) + by payment method, date-range   |
| Commissions Report     | `/admin/commissions`              | Sales                    | Revenue/bookings by salesman, date-range                               |
| Cashier Closures       | `/admin/cashier-closures`         | Financial reconciliation | Shift totals, denominations, declared vs. calculated cash              |
| Analytics              | — (backend only, no UI)           | Financial                | Revenue from standalone payments, new customers — **no frontend page** |
| Monthly Tax Report     | `/admin/reports/monthly-tax`      | ECF/Tax compliance       | ITBIS totals by tipo (E31–E34), CSV export                             |
| ECF Invoice Management | `/admin/invoices/ecf`             | ECF lifecycle            | Full e-CF list, filters, PDF/XML, credit notes                         |
| Sequence Management    | `/admin/reports/sequences`        | ECF operational          | e-NCF sequence expiry tracking                                         |
| Pending Invoice Queue  | `/admin/reports/pending-invoices` | ECF operational          | En Proceso / Rechazado / Contingencia queue                            |
| Wristband Usage        | `/admin/wristbands`               | Operations               | Wristband delivery vs. usage by category                               |
| Accommodations         | `/admin/accommodations`           | Room operations          | Real-time room availability + condition + inline edit                  |

---

## 2. Enterprise PMS Report Standards

Enterprise hotel PMS systems (Oracle Opera, Mews, Maestro, Cloudbeds) are benchmarked against the **USALI (Uniform System of Accounts for the Lodging Industry)** and standard front-office reporting practices. The must-have reports fall into these categories:

- **Night Audit**: Daily financial close and transaction summary
- **Key Metrics**: Occupancy %, ADR, RevPAR — the universal language of hotel performance
- **Accounts Receivable**: Open/aging balances for corporate and credit accounts
- **Front-Office Operations**: Printable arrival/departure lists, room status for housekeeping
- **Financial Ledger**: Cross-folio transaction audit trail
- **Revenue Management**: Forecasting, pace, market segmentation, rate plan performance
- **Guest Analytics**: Repeat guests, profile data, length of stay

---

## 3. Gap Analysis: Reports to Build

### Tier 1 — Critical

These are standard in every serious PMS. Their absence is a significant gap for enterprise customers.

---

#### 1.1 — Night Audit Report

**Purpose**: A formal end-of-day financial closing document covering the entire business day. Summarizes rooms sold, arrivals processed, departures processed, no-shows, total revenue by department, taxes collected, payments received by method, and open outstanding balances.

**Why it matters**: This is the official financial record of the day, used by accountants, auditors, and GMs. It provides the authoritative source-of-truth that all shift-level cashier closures roll up into. In standard hotel operations, the Night Audit is reviewed every morning before the new day begins.

**Value added**:

- Enables proper daily financial reconciliation and close
- Required for accountants and external auditors
- Catches discrepancies (missing charges, unmatched payments) before they compound
- Provides a printable/exportable daily summary for management review

**Data sources**: Reservations, Folios, Charges, Payments, CashierClosures, Rooms.

---

#### 1.2 — Occupancy Metrics Report (ADR / RevPAR / Occupancy %)

**Purpose**: Tracks the three universal hotel KPIs over any date range:

- **Occupancy Rate** = rooms sold / rooms available × 100
- **ADR (Average Daily Rate)** = total room revenue / rooms sold
- **RevPAR (Revenue Per Available Room)** = Occupancy % × ADR

Presented as daily/weekly/monthly trending charts and a summary table.

**Why it matters**: Every hotel owner, investor, and bank asks for these three numbers. They are the standard benchmark for hotel performance across the industry. The current Admin Dashboard shows raw revenue and reservation counts but does not compute or trend these metrics.

**Value added**:

- Gives owners and GMs the exact KPIs they use to evaluate property performance
- Enables comparison over time (this month vs. last month vs. same month last year)
- Informs pricing decisions directly (low RevPAR → need to raise rates or improve occupancy)
- Required input for any investor report, loan application, or franchise review

**Data sources**: Reservations (check-in/check-out, status), RoomTypes (total available rooms), Charges (room revenue), Payments.

---

#### 1.3 — Accounts Receivable (AR) Report

**Purpose**: A list of all open, unpaid balances across folios, grouped by guest or company. Includes aging buckets: 0–30 days, 31–60 days, 61–90 days, 90+ days. Shows the balance amount, last payment date, and contact info.

**Why it matters**: Pilloto already supports credit accounts and corporate billing — guests and companies can have outstanding balances across multiple stays. Without an AR report, collecting on these balances is entirely manual: there is no consolidated view of who owes what and for how long.

**Value added**:

- Enables proactive collections follow-up before balances age
- Required for any hotel that extends credit to corporate clients
- Prevents revenue from silently aging into write-offs
- Standard requirement for hotel accountants using any PMS

**Data sources**: Folios, Payments, CreditAccounts, Guests, Companies, Reservations.

---

#### 1.4 — Arrivals & Departures Report (Operational / Printable)

**Purpose**: A detailed, date-specific printable list of every expected arrival and every expected departure — with room assignment, reservation type, number of guests, balance due on arrival, and any special notes. Separate from the Schedule Summary which shows only aggregate counts.

**Why it matters**: The Schedule Summary at `/admin/schedule` already shows headcounts. What is missing is the **operational document** that front-desk staff actually use to run check-in/check-out: a line-by-line list they can print or display, work through one by one, and annotate. Housekeeping also uses the departures list to sequence room cleaning.

**Value added**:

- Replaces pen-and-paper lists that front-desk staff currently create manually
- Gives housekeeping a prioritized departure sequence to plan their day
- Shows balance-due-on-arrival so the cashier is prepared before the guest arrives
- Reduces check-in delays and errors

**Data sources**: Reservations, Guests, Rooms, Folios (balance), Charges.

---

#### 1.5 — ~~Room Status / Housekeeping Report~~ _(see Section 4)_

See **Section 4** for detailed evaluation. The existing Accommodations page already covers most of this use case. A lightweight enhancement is recommended instead of a full new report.

---

### Tier 2 — High Value

Expected by serious operators. Their presence distinguishes a professional PMS from a basic reservation tool.

---

#### 2.1 — Folio Transaction Ledger

**Purpose**: A complete, filterable audit trail of all charges and payments across **all** folios within a date range. Every line item, who posted it, when, on which reservation, and the running folio balance.

**Why it matters**: Today, each folio is viewable individually. But there is no way to query across folios — for example, "show me all room charges posted yesterday" or "show me all discount adjustments this month." Accountants need this cross-folio view to reconcile revenue and trace discrepancies.

**Value added**:

- Enables revenue reconciliation across the entire property for any period
- Allows detection of unusual charge patterns or unauthorized adjustments
- Required for financial audits (external accountants want to see every posted transaction)
- CSV export feeds directly into accounting software (QuickBooks, etc.)

**Data sources**: Charges, Payments, Folios, Reservations, Guests, Users (posted-by).

---

#### 2.2 — Market Segment / Source-of-Business Report

**Purpose**: Breaks down bookings and revenue by acquisition channel: direct/web, walk-in, OTA (Airbnb, Booking.com, etc.), corporate, referral, etc. Shows bookings count, revenue, ADR, and occupancy contribution per segment.

**Why it matters**: "Where are our guests coming from, and which channels are the most profitable?" is one of the most important questions for hotel revenue strategy. OTAs charge 15–25% commission — understanding their true net contribution vs. direct bookings directly informs budget allocation.

**Value added**:

- Reveals which channels drive the most profitable (not just most voluminous) business
- Informs OTA commission budget decisions
- Identifies underperforming segments to target with promotions
- Required for any revenue management strategy

**Data sources**: Reservations (booking source/channel field — may need to be added if not yet tracked), OtaListingMappings, Payments.

---

#### 2.3 — Cancellations & No-Shows Report

**Purpose**: A period summary of all cancelled and no-show reservations, with the cancellation date, how far in advance it occurred, the revenue impact, and whether a cancellation fee was charged and collected.

**Why it matters**: Cancellation patterns directly drive policy decisions — minimum stay requirements, deposit rules, cancellation fee amounts. Without this data, these policies are set by gut feeling. No-show tracking is also required for OTA reconciliation (OTAs may charge commissions on no-shows differently).

**Value added**:

- Data-driven basis for setting and adjusting cancellation policy
- Reveals revenue at risk from last-minute cancellations
- Required for OTA reconciliation
- Identifies peak cancellation periods for overbooking strategy

**Data sources**: Reservations (status = cancelled/no_show, cancellation timestamp), Payments (cancellation fees collected).

---

#### 2.4 — Charge Rule Execution Audit Report

**Purpose**: A dedicated frontend report showing every automated charge rule that fired: which rule, on which reservation, on what date, for what amount, and whether it succeeded or failed.

**Why it matters**: Pilloto already has `AuditRun` and `ChargeRuleExecution` models, and a backend endpoint for this data — but there is no dedicated report page in the frontend. Managers need to verify that automated charges (breakfast, service fees, parking, late checkout fees) are firing correctly without having to check each reservation individually.

**Value added**:

- Quickly identifies rules that are silently failing (no revenue loss discovered by accident)
- Confirms that all expected automated charges fired on the correct reservations
- Provides accountability trail for automated financial operations
- Low build cost — the data already exists in the backend

**Data sources**: AuditRun, ChargeRuleExecution (both models already exist).

---

#### 2.5 — Daily Manager's Flash Report

**Purpose**: A one-page daily summary for management and owners: today's occupancy %, revenue (actual vs. prior period), payment collection totals, outstanding balance, top revenue-generating reservations, and upcoming arrivals count for tomorrow.

**Why it matters**: GMs and owners do not have time to navigate between the Revenue report, Schedule Summary, and Dashboard to piece together the day's picture. A single daily flash view — ideally auto-generated each morning — gives leadership the information they need in under 60 seconds.

**Value added**:

- Saves GM 10–20 minutes of daily report-pulling across multiple screens
- Enables a consistent daily briefing routine
- Can be emailed automatically to owners who are not on-site
- Positions Pilloto as a management tool, not just an operational tool

**Data sources**: Reservations, Revenue aggregates, Payments, Folios (outstanding balance), Charges.

---

### Tier 3 — Competitive Differentiators

These reports set an enterprise-grade PMS apart from budget tools. Relevant once Tier 1 and Tier 2 are complete.

---

#### 3.1 — Booking Pace / Demand Forecast Report

**Purpose**: Shows how many reservations are currently on-the-books for future dates and compares it to the same time last year (or a defined prior period). Helps revenue managers spot demand trends early and adjust pricing before it is too late.

**Value added**: Answers "are we ahead or behind last year for next month?" before it happens. Enables proactive pricing adjustments. Replaces spreadsheet-based tracking that many hotels use instead.

---

#### 3.2 — Rate Plan Performance Report

**Purpose**: Revenue breakdown by rate plan (rack rate, corporate rate, OTA rate, early-bird, etc.) showing bookings count, total revenue, ADR, and occupancy contribution per plan.

**Value added**: Answers "which rate plans are driving the most profitable business?" Directly informs which plans to promote, expand, or retire.

---

#### 3.3 — Guest Profile / Repeat Guest Report

**Purpose**: Aggregated guest analytics: nationalities breakdown, repeat guest rate, average spend per guest, average number of stays per guest, top spenders, VIP identification.

**Value added**: Identifies loyal guests for personalized outreach. Enables loyalty recognition. Required for marketing segmentation. Shows which nationality segments generate the most revenue.

---

#### 3.4 — Length of Stay (LOS) Report

**Purpose**: Average length of stay by period, room type, and channel. Tracks LOS trends over time.

**Value added**: Informs minimum LOS restrictions (e.g., "require 2-night minimum on Fridays"). Shows which channels bring longer-staying (more profitable) guests. Helps optimize room availability management.

---

#### 3.5 — OTA / Channel Reconciliation Report

**Purpose**: A formal report reconciling OTA bookings vs. direct bookings: revenue, booking counts, cancellations, and effective net revenue after estimated OTA commissions per channel.

**Value added**: Reveals the true cost of each OTA channel. Enables data-driven decisions on whether to increase or reduce OTA dependence. Complements the existing OTA conflict queue by adding financial visibility.

---

## 4. Special Note: Room Status vs. Accommodations Page

### Original Tier 1 claim

The initial gap analysis listed a "Room Status / Housekeeping Report" as Tier 1 Critical — a view of every room's current status (clean, dirty, occupied, vacant, out of order) for housekeeping coordination.

### What the existing Accommodations page already does

The existing `Accommodations.tsx` page at `/admin/accommodations` already covers the core use case:

| Enterprise requirement               | Accommodations page                                                                                   | Status                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| Room condition (clean / dirty)       | Shows `clean` / `pending_cleanup` chip per room, editable inline                                      | ✅ Covered                        |
| Occupancy status (vacant / occupied) | Shows `available` / `booked` / `occupied` / `not_available` chip                                      | ✅ Covered                        |
| Today's arriving/departing per room  | Reservation table above shows Arriving / Departing / In Progress badge per reservation with room name | ✅ Covered (per-reservation view) |
| Edit condition inline                | Edit dialog per room — updates status, condition, comment                                             | ✅ Covered                        |
| Out of order equivalent              | `status: inactive` on the room                                                                        | ✅ Covered (different label)      |

### What the Accommodations page is missing vs. a dedicated Housekeeping Report

| Feature                                                    | Accommodations page  | Dedicated Housekeeping Report                    |
| ---------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| Printable / portable format                                | No                   | Yes — housekeepers need a printed sheet to carry |
| Filter to "needs attention only" (departing today + dirty) | No — shows all rooms | Yes — focused view                               |
| Grouped by floor / building for assignment routing         | No                   | Yes                                              |
| Priority ordering (departures first)                       | No                   | Yes                                              |
| Staff assignment (who cleans which room)                   | No                   | Yes                                              |
| Special notes per room (VIP, late checkout, early arrival) | No                   | Yes                                              |
| Export to PDF/print                                        | No                   | Yes                                              |

### Verdict

The Accommodations page is **not the same** as a Housekeeping Report — it is the operational **data foundation** for one. The core room status data is already there. What is missing is a **dedicated housekeeping view layer** on top of that data: filtered, prioritized, printable, and assignable.

This is an **enhancement to the Accommodations page** (or a new view mode within it) rather than a fully new report from scratch. Complexity and build cost are significantly lower than originally assessed.

**Revised priority**: Tier 2 (not Tier 1) — the Accommodations page already serves the immediate need. A dedicated housekeeping report is an enhancement that adds operational polish.

---

## 5. Implementation Plan

### Guiding Principles

- Each report must be independently useful — no report should require another report to be built first
- Backend endpoints and frontend pages are built together in the same session
- All reports must support CSV/PDF export
- All reports use the existing auth + tenantContext middleware
- No new database models needed for any report — all data is already captured

---

### Phase R1 — Critical Foundation (Tier 1)

> **Scope**: ~2 development sessions
> **Goal**: The three reports without which Pilloto cannot be called a serious PMS

#### Session R1A — Occupancy Metrics (ADR / RevPAR / Occupancy %)

**Backend**:

- `GET /api/admin/reports/occupancy` — returns daily occupancy data for a date range:
  - `date`, `roomsAvailable`, `roomsSold`, `occupancyPct`, `roomRevenue`, `adr`, `revpar`
  - Supports `groupBy=day|week|month`
  - Compares to prior period if `compareTo=prev_period|prev_year`
- Calculation logic: rooms sold = reservations in `checked_in` or `checked_out` status with dates overlapping the query date

**Frontend**:

- New page at `/admin/reports/occupancy`
- Summary cards: Occupancy %, ADR, RevPAR for the selected period
- Line chart: daily trend for all three metrics
- Table: day-by-day breakdown
- Period selector: last 7 days / last 30 days / last 3 months / custom range
- Prior period comparison toggle
- CSV export

#### Session R1B — Night Audit Report

**Backend**:

- `GET /api/admin/reports/night-audit?date=YYYY-MM-DD` — returns full daily summary:
  - Rooms: available, sold, occupied, vacated, arriving, departing, no-shows
  - Revenue: by department (rooms, services, daypass, events), total collected
  - Payments: by method (cash, card, transfer, check, credit), total
  - Outstanding: open folio balances as of end-of-day
  - Cashier: links to CashierClosure records for the day
- `GET /api/admin/reports/night-audit/range` — summary table for a date range

**Frontend**:

- Page at `/admin/reports/night-audit`
- Date picker (defaults to yesterday)
- Sections: Room Counts, Revenue Summary, Payment Summary, Outstanding Balances
- Print-ready layout (clean CSS for `@media print`)
- PDF export button
- Quick navigation: previous day / next day arrows

#### Session R1C — Arrivals & Departures Report

**Backend**:

- `GET /api/admin/reports/arrivals?date=YYYY-MM-DD` — full arrival list with: guest name, room, reservation type, check-in time (if applicable), total guests, balance due, special notes
- `GET /api/admin/reports/departures?date=YYYY-MM-DD` — same structure for departures: balance remaining, payment status, whether folio is closed

**Frontend**:

- Page at `/admin/reports/arrivals-departures`
- Two tabs: Arrivals | Departures (+ combined view)
- Sortable by time, room number, balance amount
- Quick-filter: balance > 0 (highlight guests who still owe)
- Print button (prints current tab in clean format)
- Direct link from each row to the reservation

---

### Phase R2 — High Value (Tier 2)

> **Scope**: ~2 development sessions
> **Goal**: Reports expected by professional operators

#### Session R2A — Accounts Receivable + Folio Transaction Ledger

**AR Report**:

- `GET /api/admin/reports/accounts-receivable` — open balances grouped by guest/company, with aging buckets
- Frontend: table with aging color-coding (green/yellow/orange/red), totals row, CSV export

**Folio Transaction Ledger**:

- `GET /api/admin/reports/transactions` — all charges and payments across all folios for a date range, with filters by type, amount, user who posted
- Frontend: filterable table, grouped by folio or flat list, CSV export

#### Session R2B — Charge Rule Audit + Cancellations & No-Shows + Daily Flash

**Charge Rule Audit**:

- Frontend page for existing backend data (AuditRun + ChargeRuleExecution models)
- Route: `/admin/reports/charge-audit`
- Filters: date range, rule name, reservation, success/failure
- This is largely a frontend-only build — the data already exists

**Cancellations & No-Shows**:

- `GET /api/admin/reports/cancellations` — cancelled + no-show reservations with revenue impact
- Frontend: summary cards (total cancelled, revenue at risk, fees collected), detail table

**Daily Manager's Flash**:

- `GET /api/admin/reports/daily-flash?date=YYYY-MM-DD`
- Frontend: single-page dashboard card layout; auto-defaults to today; printable

---

### Phase R3 — Competitive Differentiators (Tier 3)

> **Scope**: ~2 development sessions
> **Goal**: Revenue management and guest intelligence tools

#### Session R3A — Market Segment + Rate Plan Performance

- **Market Segment**: requires adding `bookingSource` field to Reservation model if not already present
- Backend + frontend for both reports

#### Session R3B — Booking Pace / Forecast + Guest Profile + LOS

- Forecast: on-the-books vs. prior year comparison
- Guest Profile: nationality breakdown, repeat rate, top spenders
- LOS: average by period, room type, channel

---

### Phase R4 — Housekeeping Report Enhancement

> **Scope**: ~0.5 session (enhancement, not a new report)
> **Builds on**: Existing Accommodations page data

- Add a "Housekeeping View" mode toggle to `/admin/accommodations`
- Filtered to: rooms with departures today OR `condition: pending_cleanup`
- Grouped by floor (requires floor field on Room model — add if not present)
- Priority ordering: departing rooms first, then in-house dirty rooms
- Staff assignment dropdown per room (assign to a User)
- Print button: clean printable format for housekeeping supervisor

---

### Summary Roadmap

| Phase | Reports                                                    | Sessions | Priority    |
| ----- | ---------------------------------------------------------- | -------- | ----------- |
| R1A   | Occupancy Metrics (ADR / RevPAR / Occupancy %)             | 1        | Critical    |
| R1B   | Night Audit Report                                         | 1        | Critical    |
| R1C   | Arrivals & Departures Report                               | 0.5      | Critical    |
| R2A   | Accounts Receivable + Folio Transaction Ledger             | 1        | High        |
| R2B   | Charge Rule Audit + Cancellations & No-Shows + Daily Flash | 1        | High        |
| R3A   | Market Segment + Rate Plan Performance                     | 1        | Competitive |
| R3B   | Booking Pace/Forecast + Guest Profile + LOS                | 1        | Competitive |
| R4    | Housekeeping View Enhancement                              | 0.5      | Enhancement |

---

## Quick Reference: Starting a Reports Development Session

> "I'm working on Pilloto PMS reports. Refer to `REPORTS_REQUIREMENTS.md`. Please implement **Phase RX** in full, including all backend and frontend tasks."

### Session Checklist:

- [ ] Read `REPORTS_REQUIREMENTS.md` at the start
- [ ] Run `tsc --noEmit` in both `backend/` and `frontend/` before starting (baseline)
- [ ] Implement all backend endpoints first, then frontend pages
- [ ] All new routes use `auth` + `tenantContext` middleware
- [ ] All reports have CSV export
- [ ] Run `tsc --noEmit` after — zero errors required before marking done
- [ ] Update Phase Completion Tracker below

---

## Phase Completion Tracker

| Phase                                      | Status         | Notes                                       |
| ------------------------------------------ | -------------- | ------------------------------------------- |
| R1A — Occupancy Metrics                    | ⬜ Not started |                                             |
| R1B — Night Audit Report                   | ⬜ Not started |                                             |
| R1C — Arrivals & Departures                | ⬜ Not started |                                             |
| R2A — AR + Folio Ledger                    | ⬜ Not started |                                             |
| R2B — Charge Audit + Cancellations + Flash | ⬜ Not started |                                             |
| R3A — Market Segment + Rate Plan           | ⬜ Not started | Requires bookingSource field on Reservation |
| R3B — Forecast + Guest Profile + LOS       | ⬜ Not started |                                             |
| R4 — Housekeeping Enhancement              | ⬜ Not started | Enhancement to Accommodations page          |

---

_Document maintained in: `REPORTS_REQUIREMENTS.md` at the root of `pilloto-pms`._
