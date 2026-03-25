# Pricing Module Requirements Document

**Project:** PMS for Small–Medium Hotels
**Scope:** Pricing Engine, Configuration, and Calculation

---

# 1. Overview

The pricing system must support flexible hotel pricing while remaining simple for end users.

The system is based on:

- Room-based pricing
- Tiered occupancy pricing (supports all guest scenarios)
- Rule-based price adjustments (seasonal, company, guest)
- Tax calculation as a separate layer

---

# 2. Core Architecture

```text
Room Type → Rate Plan → Base Pricing → Pricing Rules → Subtotal → Taxes → Final Total
```

---

# 3. Core Concepts

## 3.1 Room Type

Represents a physical category of rooms.

Examples:

- Standard
- Deluxe
- Suite

---

## 3.2 Rate Plan

Represents pricing variations for a room type.

Examples:

- Standard Rate
- Non-refundable
- Corporate Rate

Each Rate Plan belongs to one Room Type.

---

## 3.3 Base Pricing

Each Rate Plan has one base pricing configuration.

### Fields:

- base_price (per night)
- pricing_mode = "tiered" (only mode supported)

---

## 3.4 Occupancy Pricing (Tiered Only)

Tiered pricing defines how each guest contributes to the price.

### Rules:

- Each guest position (1st, 2nd, 3rd...) can have a different price
- Separate pricing for adults and children
- “Included” guests are represented as price = 0

---

### Example:

| Guest Type | Guest # | Price |
| ---------- | ------- | ----- |
| adult      | 1       | 0     |
| adult      | 2       | 0     |
| adult      | 3       | 20    |
| child      | 1       | 0     |
| child      | 2       | 10    |

---

# 4. Pricing Rules (Overrides)

Rules modify pricing dynamically.

---

## 4.1 Rule Conditions

A rule may apply based on:

- Date range
- Room type
- Rate plan
- Company (optional)
- Guest (optional)

---

## 4.2 Rule Actions

Each rule supports ONE of:

- Replace price (override base price)
- Percentage adjustment (+/-)
- Fixed adjustment (+/-)

---

## 4.3 Rule Scope

Rules can affect:

- Base price
- Occupancy tier prices
- Entire subtotal

---

## 4.4 Rule Priority

- Each rule has a priority (integer)
- Higher priority rules are applied first

---

## 4.5 Rule Execution Order

```text
1. Apply "replace" rules
2. Apply percentage adjustments
3. Apply fixed adjustments
```

OR

```text
Apply rules sorted by priority DESC
```

(Implementation must choose ONE consistent strategy)

---

# 5. Taxes

Taxes are applied AFTER pricing is calculated.

---

## 5.1 Tax Types

- Percentage (e.g., VAT)
- Fixed (per room or per guest)

---

## 5.2 Tax Scope

- Per room
- Per guest
- Per total

---

## 5.3 Inclusive vs Exclusive

- Exclusive: added on top
- Inclusive: already included in price

---

# 6. Database Schema

## room_types

- id
- name
- capacity

---

## rate_plans

- id
- room_type_id
- name

---

## base_prices

- id
- rate_plan_id
- base_price

---

## occupancy_tiers

- id
- base_price_id
- guest_type ('adult', 'child')
- guest_number (1, 2, 3…)
- price

---

## pricing_rules

- id
- name
- priority

-- conditions

- date_start
- date_end
- room_type_id (nullable)
- rate_plan_id (nullable)
- company_id (nullable)
- guest_id (nullable)

-- action

- adjustment_type ('replace', 'percent', 'fixed')
- adjustment_value

---

## taxes

- id
- name
- type ('percentage', 'fixed')
- value
- applies_to ('room', 'guest', 'total')
- is_inclusive (boolean)
- priority

---

# 7. Price Calculation Flow

## Input:

- room_type_id
- rate_plan_id
- number_of_adults
- number_of_children
- date(s)
- company_id (optional)
- guest_id (optional)

---

## Step-by-Step:

### Step 1: Load Base Price

- Retrieve base_price for rate_plan

---

### Step 2: Calculate Occupancy Cost

For each guest:

- Look up tier price by:
  - guest_type
  - guest_number

Sum all guest prices.

---

### Step 3: Subtotal (Pre-Rules)

```text
subtotal = base_price + occupancy_total
```

---

### Step 4: Apply Pricing Rules

- Filter applicable rules
- Sort by priority or execution type
- Apply adjustments sequentially

---

### Step 5: Subtotal After Rules

```text
adjusted_subtotal = result after all rules
```

---

### Step 6: Apply Taxes

For each tax:

- If percentage:
  → amount = adjusted_subtotal × %

- If fixed per guest:
  → amount = (adults + children) × value

- If fixed per room:
  → amount = value

Handle inclusive/exclusive logic.

---

### Step 7: Final Total

```text
final_total = adjusted_subtotal + total_taxes
```

---

# 8. Use Case Coverage

## Per Room Pricing

- Base price only
- All tiers = 0

---

## Per Guest Pricing

- Base price = 0
- All pricing via tiers

---

## Combined Pricing

- Base price + tiers

---

## Adult vs Child Pricing

- Separate tier records per type

---

## Tiered Pricing

- Different price per guest number

---

## Seasonal Pricing

- Rule with date range

---

## Company Pricing

- Rule with company_id

---

## Guest Pricing

- Rule with guest_id

---

# 9. UX Requirements

## 9.1 General Principles

- Default to simple configurations
- Hide advanced features behind toggles
- Avoid exposing internal complexity

---

## 9.2 Pricing Setup UI

### Base Price

- Input: nightly price

---

### Occupancy (Tiered)

Display editable table:

| Guest Type | Guest # | Price |

- Pre-fill common defaults:
  - Adult 1 & 2 = included (0)
  - Adult 3+ = configurable

---

### Rules UI

- “Add Rule” button
- Simple condition builder:
  - Date range
  - Company
  - Guest

- Adjustment selector:
  - Replace / % / fixed

---

### Taxes UI

Separate section:

- Add tax
- Define type and scope

---

# 10. Implementation Strategy

## Phase 1 (MVP)

- Base price
- Tiered occupancy
- Percentage rules
- Exclusive taxes

---

## Phase 2

- Fixed adjustments
- Company rules
- Child pricing

---

## Phase 3

- Inclusive taxes
- Guest-specific rules
- Advanced rule stacking

---

# 11. Guiding Principle

The system must allow users to express:

> “This room costs X, these guests cost Y, and under certain conditions, adjust the result.”

Without requiring them to understand internal pricing models.

---
