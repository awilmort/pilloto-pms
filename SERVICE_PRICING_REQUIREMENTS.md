# Service Pricing and Reservation Requirements

## 1. Objective and Scope

Design a professional, PMS-grade model for pricing **non-room services** (DayPass, Pasatarde, Event and future add-ons) and integrating them with existing **room reservations**, while preserving the current room rate plan architecture.

This specification covers:

- Domain models for rooms, services, pricing, and reservations.
- Backend APIs and pricing flows for rooms and services.
- Frontend behavior in **Settings → Services** and **New Reservation** flows.
- How the system **unambiguously distinguishes** room reservations from service reservations (both in data and UI).

Room pricing (rate plans) is considered correct and remains the reference for lodging; this spec extends the system to handle service pricing and reservation typing in a standardized way.

---

## 2. Domain Model

### 2.1 Room Inventory and Pricing (Existing)

These models already exist and are **not to be changed functionally** by this refactor:

- `RoomType`
- `RatePlan`
- `PricingRule`
- `Tax`

Requirements:

- `RatePlan` remains strictly tied to `RoomType` and is used **only for lodging**.
- `PricingRule` and `Tax` continue to apply to room pricing as they do today.
- Any new service-pricing behavior must **not** alter these semantics.

### 2.2 Service Catalog (`Service`)

Introduce a `Service` model to represent all **non-room products/add-ons** (DayPass, Pasatarde, Events, future extras).

**Fields (required minimum):**

- `code: string`
  - Globally unique per tenant.
  - Stable identifier used in configuration, integrations, and reporting.
  - Examples: `"DAYPASS"`, `"PASATARDE"`, `"EVENT_STANDARD"`.

- `name: string`
  - Human-readable display name shown in the UI.

- `kind: 'roomAddon' | 'daypass' | 'pasatarde' | 'event' | 'generic'`
  - Small, **hardcoded enum** that drives system behavior and UI.
  - `daypass`: day-use access product.
  - `pasatarde`: afternoon/evening pass.
  - `event`: event-related product (event admission or package component).
  - `roomAddon`: add-ons logically attached to a room stay (e.g. breakfast, parking).
  - `generic`: other non-room products that do not require special flows.

- `chargeBasis: 'perPerson' | 'perRoom' | 'perStay' | 'perEvent'`
  - Defines how quantities are interpreted for pricing and posting:
    - `perPerson`: quantity = total guests (adults + children).
    - `perRoom`: quantity = number of rooms on the reservation (for room add-ons).
    - `perStay`: flat once per stay/booking.
    - `perEvent`: flat once per event.

- `isActive: boolean`
  - Controls whether this service can be selected in UIs.

- Optional flags (to be implemented as needed):
  - `isOnlineBookable: boolean`
  - `isVisibleInPOS: boolean`

**Constraints:**

- `code` must be unique per tenant.
- `kind` and `chargeBasis` are **controlled by code** (fixed enum), not tenant-configurable strings.
- `isActive = false` implies the service must not appear in the New Reservation flows.

### 2.3 Service Pricing (`ServicePrice`)

Refine the existing `Pricing` model into a dedicated service pricing model `ServicePrice`.

**Relationship and renaming:**

- The existing `Pricing` collection is conceptually renamed to `ServicePrice`.
- `service` (string enum) is replaced by `serviceId: ObjectId` referencing `Service`.

**Fields (minimum):**

- `serviceId: ObjectId (ref: Service)` **[required]**

- `category: 'standard' | 'special' | 'guest' | 'company'` **[required]**
  - `standard`: default public pricing.
  - `special`: promotional/seasonal pricing.
  - `guest`: guest-specific pricing (tied to one email).
  - `company`: company-specific pricing (tied to one company).

- `validity: 'everyday' | 'weekdays' | 'weekend' | 'custom'` **[required]**
- `startDate?: Date`
- `endDate?: Date`

- `guestEmail?: string`
  - Required when `category = 'guest'`.

- `companyId?: ObjectId (ref: Company)`
  - Required when `category = 'company'`.

- `adultPrice: number` **[required]**
- `childrenPrice: number` **[required]**

- `isActive: boolean` (default `true`)
- Timestamps: `createdAt`, `updatedAt`

**Validation rules:**

- When `category = 'special'`:
  - `validity` must be `custom`.
  - `startDate` and `endDate` are required.

- When `category = 'guest'`:
  - `guestEmail` is required and non-empty.
  - `validity` is set to `custom`.
  - `startDate` and `endDate` are required.

- When `category = 'company'`:
  - `companyId` is required.
  - `validity` is set to `custom`.
  - `startDate` and `endDate` are required.

- When `validity = 'custom'` (regardless of category):
  - `startDate` and `endDate` are required.

- `startDate` and `endDate` are normalized to full-day boundaries on save and update.

**Indexing and tenancy:**

- Index on `(serviceId, category, validity, startDate, endDate)`.
- The same multi-tenancy plugin used elsewhere must be applied.

### 2.4 Reservation and Reservation Items

Align the reservation model with professional PMS practice: the **reservation** is a container, and it holds **items/lines** that are either room stays or services.

#### 2.4.1 Reservation (Header)

`Reservation` represents a booking/folio.

Required fields (existing and/or extended):

- `guestId`, `tenantId`, status, created/updated timestamps (existing behavior preserved).
- `items: ReservationItem[]` (see below).
- `primaryKind: 'room' | 'service' | 'mixed'`
  - Summary type for filtering and UI.
  - Derived from `items`:
    - `'room'` if all items are `kind = 'room'`.
    - `'service'` if all items are `kind = 'service'`.
    - `'mixed'` if there is at least one of each.

Any existing `Reservation.type` field must be migrated or aligned to this behavior so that the system has **one authoritative way** to reason about reservation type (with `primaryKind` as the summary).

#### 2.4.2 ReservationItem

Introduce or standardize a `ReservationItem` subdocument type representing each priced component of the reservation.

**Fields (minimum):**

- `kind: 'room' | 'service'` **[required]**
  - This is the **authoritative discriminator** that tells the system whether the line is a room stay or a non-room service line.

- Common fields:
  - `dateStart: Date` (for room stays) or `date: Date` (for single-day services).
  - `quantity: number` (see below under pricing).
  - `currency: string` (if multi-currency is supported; otherwise inherited).
  - Pricing snapshot fields:
    - `unitPrice: number`
    - `subtotal: number`
    - `taxes: { name: string; type: string; amount: number; isInclusive: boolean }[]`
    - `totalTaxes: number`
    - `total: number`

- When `kind = 'room'`:
  - `roomTypeId: ObjectId (ref: RoomType)`
  - `ratePlanId: ObjectId (ref: RatePlan)`
  - `checkIn: Date`
  - `checkOut: Date`
  - `adults: number`
  - `children: number`
  - Any other existing room-specific fields.

- When `kind = 'service'`:
  - `serviceId: ObjectId (ref: Service)`
  - `servicePriceId?: ObjectId (ref: ServicePrice)` (null when manually priced).
  - `date: Date` (execution/usage date for the service).
  - `adults?: number`
  - `children?: number`
  - `companyId?: ObjectId`
  - `guestEmail?: string`
  - `manualPriceOverride?: boolean` (true if line was priced manually due to missing configuration).

**Reservation type determination:**

- The system distinguishes between room and service reservations via `ReservationItem.kind`:
  - Room lines: `kind = 'room'` with `roomTypeId` + `ratePlanId`.
  - Service lines: `kind = 'service'` with `serviceId` + optional `servicePriceId`.
- `primaryKind` on the header is derived from the set of item kinds, ensuring there is **no ambiguity** in how the system classifies a reservation.

This approach matches professional PMS practice where a reservation/folio contains **room stays** and **non-room charges** as typed lines sharing a common container.

---

## 3. Pricing Flows

### 3.1 Room Pricing (Unchanged)

- Continue to use the existing room pricing flow:
  - `calculateTieredPrice` backend utility.
  - `POST /pricing/calculate` endpoint.
  - `RatePlan` + `PricingRule` + `Tax` models.
- For `ReservationItem` with `kind = 'room'`:
  - Quantity is implicitly defined by nights and rooms according to current logic.
  - Unit and total prices are snapshotted into the item from the room pricing calculation.

### 3.2 Service Pricing

Introduce a dedicated service pricing flow using `Service` and `ServicePrice`.

#### 3.2.1 Service Price Calculation API

Add endpoint:

- `POST /pricing/calculate-service`

**Input:**

- `serviceId: string` **[required]**
- `date: string` (ISO) **[required]**
- `adults: number` (default `1`)
- `children: number` (default `0`)
- `companyId?: string`
- `guestEmail?: string`
- Optionally, `rooms?: number` when `chargeBasis = 'perRoom'`.

**Resolution and selection:**

1. Fetch the `Service` and validate it is `isActive = true`.
2. Fetch all active `ServicePrice` records for that `serviceId` whose validity window includes `date`.
3. Select the applicable `ServicePrice` by priority:
   - Guest-specific (`category = 'guest'` with matching `guestEmail`).
   - Company-specific (`category = 'company'` with matching `companyId`).
   - Special (`category = 'special'` and `date` in range).
   - Standard (`category = 'standard'`).
4. If no price is found, return a clear error that this service has no configured price for the given context.

**Quantity and subtotal calculation:**

- Based on `Service.chargeBasis`:
  - `perPerson`:
    - `quantity = adults + children`.
    - `baseSubtotal = adults * adultPrice + children * childrenPrice`.
  - `perRoom`:
    - `quantity = rooms` (provided by caller when relevant).
    - `baseSubtotal = rooms * adultPrice`.
  - `perStay`:
    - `quantity = 1`.
    - `baseSubtotal = adultPrice` (used as the base amount for the stay).
  - `perEvent`:
    - `quantity = 1`.
    - `baseSubtotal = adultPrice` (used as event-level amount).

**Tax application:**

- Reuse the existing `Tax` model and semantics:
  - Percentage taxes apply on `baseSubtotal`.
  - Fixed taxes apply per guest, per room, or total according to `appliesTo`.
- Compute:
  - `taxes[]` breakdown.
  - `totalTaxes` (exclusive taxes only).
  - `finalTotal = baseSubtotal + totalTaxes`.

**Output:**

- Selected `servicePrice` metadata (id, category, validity, etc.).
- `quantity`, `baseSubtotal`, `taxes[]`, `totalTaxes`, `finalTotal`.

#### 3.2.2 Pricing Orchestration

- A higher-level pricing service (application layer) exposes two clear methods:
  - `quoteRoomStay(...)` → delegates to room pricing.
  - `quoteServiceUsage(...)` → delegates to service pricing.
- Reservation creation and modification logic must:
  - Use `quoteRoomStay` for `ReservationItem.kind = 'room'`.
  - Use `quoteServiceUsage` for `ReservationItem.kind = 'service'`.
- The reservation layer **never guesses** which engine to use; it relies on `kind` and model references (`ratePlanId` vs `serviceId`).

---

## 4. Frontend Behavior

### 4.1 Settings → Services Tab

The existing **Services** tab must be refactored to use the `Service` model as its single source of truth.

**Responsibilities:**

- Display a table/list of `Service` records for the tenant:
  - Columns: `name`, `code`, `kind`, `chargeBasis`, `isActive` (and optional flags).
- Allow administrators to:
  - Create a new service (code, name, kind, chargeBasis, initial active state).
  - Edit an existing service (name, flags; code changes only if carefully validated).
  - Activate/deactivate a service by toggling `isActive`.

**DayPass, Pasatarde, Event:**

- These are represented as seeded `Service` records:
  - DayPass → `code="DAYPASS"`, `kind='daypass'`, `chargeBasis='perPerson'`.
  - Pasatarde → `code="PASATARDE"`, `kind='pasatarde'`, `chargeBasis='perPerson'`.
  - Event → `code` & `kind='event'` with a chosen `chargeBasis`.
- The Services tab **must not** hardcode DayPass/Pasatarde/Event rows; they appear because of their `Service` records.
- Any previous hardcoded flags for these services are replaced by `Service.isActive` and, where needed, `kind`.

### 4.2 Price Management Page

Extend the existing Price Management page to support service pricing.

**New Services pricing section/tab:**

- **Service Catalog:**
  - Reuse the `Service` list as described above.

- **Service Prices:**
  - When a service is selected, show all associated `ServicePrice` records.
  - Allow CRUD operations with full validation:
    - `category`, `validity`, `startDate`, `endDate`, `guestEmail`, `companyId`, `adultPrice`, `childrenPrice`, `isActive`.
  - Reflect backend validation rules in the UI where possible (e.g. enforce dates for `custom` validity).

### 4.3 New Reservation Flow (Create/Edit)

The New Reservation flow must handle both room and service reservations, and visually distinguish them while using the same underlying reservation model.

**Data source for options:**

- **Rooms:**
  - As today, based on `RoomType` + active `RatePlan`s.

- **Services:**
  - Load from `GET /services?isActive=true`.
  - Filter or group in the UI by `kind`:
    - `daypass` and `pasatarde` displayed as DayPass and Pasatarde options.
    - `event` displayed as event-related options.
    - Other kinds (`roomAddon`, `generic`) displayed as additional services/add-ons.

**User experience:**

- The UI presents two main sections in the flow:
  - **Room Stay** (for room reservations): room selection, dates, guests; uses rate plan pricing.
  - **Services / Add-ons** (for DayPass, Pasatarde, Event, etc.): service selection for a date (or stay), with quantities.

- Visually distinguish items:
  - Room lines are labeled and iconized as rooms (e.g. bed/room icon), grouped under a “Rooms” heading.
  - Service lines are labeled and iconized as services (e.g. ticket/pool icons), grouped under a “Services” heading.
  - Mixed reservations clearly show both sections.

**Behavior for different reservation shapes:**

- **Pure room reservation:**
  - At least one `ReservationItem.kind = 'room'`, zero `kind = 'service'`.
  - UI focuses on the Room Stay section; Services section may be collapsed/optional.

- **Pure service reservation (e.g. only DayPass or only Event):**
  - Only `ReservationItem.kind = 'service'` items.
  - UI may skip the Room Stay section and lead directly into the Services section.

- **Mixed reservation (room + services):**
  - Items of both kinds; both sections shown.
  - This is standard PMS behavior and must be supported.

**Pricing integration in the flow:**

- When the user configures a **room** line:
  - The UI calls the existing room pricing endpoint and displays the breakdown.
  - On confirmation, a `ReservationItem` with `kind='room'` is created/updated and snapshotted.

- When the user adds a **service** line (DayPass, Pasatarde, Event, etc.):
  - The UI selects the appropriate `serviceId` (from `Service`).
  - It collects date, adults, children, company, guest email as needed.
  - It calls `/pricing/calculate-service` and displays the quote.
  - On confirmation, a `ReservationItem` with `kind='service'` is created/updated and snapshotted.

**How the system knows what type of reservation it is:**

- Programmatically:
  - Each item is typed: `ReservationItem.kind = 'room' | 'service'`.
  - The header `primaryKind` is derived from the set of item kinds.
  - Business logic and reports use `kind` and `primaryKind` to distinguish room stays vs services.

- Visually:
  - The New Reservation UI and Reservation Details UI present sections and icons for Rooms vs Services, reflecting the underlying `kind` and `primaryKind`.
  - Operators can immediately see whether a reservation is room-only, service-only, or mixed, consistent with professional PMS expectations.

---

## 5. Migration and Cleanup

### 5.1 Seeding Services

- Create initial `Service` records based on current hardcoded offerings:
  - DayPass → `code="DAYPASS"`, `kind='daypass'`, `chargeBasis='perPerson'`, `isActive` based on current settings.
  - Pasatarde → `code="PASATARDE"`, `kind='pasatarde'`, `chargeBasis='perPerson'`, `isActive` based on current settings.
  - Event → `code` with `kind='event'` and chosen `chargeBasis`.

### 5.2 Migrating Existing Pricing Data

- For each existing `Pricing` document:
  - Map `service` (string) to a new or existing `Service` record and set `serviceId`.
  - Preserve `category`, `validity`, `startDate`, `endDate`, `guestEmail`, `companyId`, `adultPrice`, `childrenPrice`, `isActive`.
  - Ensure date normalization and validation rules continue to hold.

### 5.3 Aligning Reservation Model

- Review current `Reservation` schema and adapt it to the `ReservationItem`/`primaryKind` pattern:
  - Introduce or standardize a `ReservationItem` array with the `kind` discriminator and fields described above.
  - Migrate any legacy `Reservation.type` usage to rely on `primaryKind` and items.
- Ensure all reservation-related code paths (creation, modification, check-in/out, reporting) use this consistent model.

### 5.4 Removing Hardcoded Service Logic

- Remove or deprecate any hardcoded references to DayPass, Pasatarde, Event outside the `Service` and `kind` abstractions.
- The UI and backend must:
  - Derive availability and visibility of these offerings from `Service` and `ServicePrice`.
  - Use `Service.kind` solely when behavior needs to differ (e.g. special text or flow), not for basic presence.

---

This document is the single source of truth for the refactor of service pricing, add-on management, and reservation typing. Implementation should treat these requirements as end-to-end, not as partial patches, so that Pilloto aligns with standard practices in professional PMS systems while preserving its existing room rate plan architecture.
