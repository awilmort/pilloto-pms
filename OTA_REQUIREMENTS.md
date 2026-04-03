# OTA Requirements

Use iCal as an availability-sync layer, not as a full OTA integration. Pilloto should publish secure outbound calendar feeds per mapped listing, pull inbound OTA calendars on a worker schedule, create local OTA-origin reservations only when there is no overlap, and store overlaps as conflicts for manual resolution.

## Architecture Fit

- Pilloto already has tenant-scoped settings, reservation lifecycle, overlap logic, and worker patterns that fit this solution.
- OTA configuration belongs in Settings.
- OTA conflict handling does not belong in Settings. It should live in a dedicated operational queue.
- Imported OTA bookings should become normal Pilloto reservations with OTA metadata, not a separate reservation system.

## Core Design

1. Scope v1 to accommodation inventory only.
2. Generate one outbound iCal feed per OTA mapping.
3. Pull inbound OTA iCal feeds on a schedule.
4. If an OTA event does not overlap, create or update a local reservation marked as OTA-origin.
5. If an OTA event overlaps, do not auto-change the local booking. Create a conflict record and require manual resolution.
6. Keep Pilloto as source of truth by never auto-overwriting a local reservation because of inbound OTA data.
7. Add a manual sync action and sync history for auditability.

## OTA Mapping Clarification

This is the key rule:

One Pilloto mapping must correspond to one OTA calendar.

That means:

- Not one mapping for all rooms in the property.
- Not automatically one mapping per physical room either.
- It must be one mapping per OTA sellable listing or unit calendar.

### Pilloto Rule

Pilloto should map to the OTA calendar object, not to the entire property.

For v1, the safest model is:

- One outbound Pilloto feed per OTA listing mapping.
- One inbound OTA feed URL per OTA listing mapping.
- Tenant creates as many mappings as they have OTA calendars.

## Solution Components

### OTA Settings

- Tenant-level enable or disable
- Default sync frequency
- Property timezone
- Conflict alerts

### Listing Mappings

- Provider name
- Inbound OTA feed URL
- Outbound Pilloto feed URL
- Local mapped unit
- External listing id or label
- Active or inactive status

### Sync Runs

- Start time
- End time
- Tenant
- Provider
- Status
- Imported count
- Conflict count
- Error count
- Last error

### Imported External Events

- Provider
- External UID
- Listing mapping
- Check-in
- Check-out
- Guest name if available
- Raw normalized snapshot
- Last seen at

### Conflict Records

- External event reference
- Overlapping local reservation reference
- Conflict type
- Resolution status
- Resolved by
- Resolved at
- Notes

## Outbound Feed Design

- Publish secure feed URLs using opaque tokens.
- Each feed should represent a single mapped listing or unit calendar.
- Feed content should block dates from active Pilloto reservations that make inventory unavailable.
- Cancelled and completed reservations should not block inventory.
- Token rotation should be supported.

## Inbound Feed Design

- Pull OTA feed URLs on a fixed schedule.
- Parse each event into a normalized internal format.
- Deduplicate by provider, listing mapping, and external UID.
- Match against previously imported OTA events to detect new, changed, or missing events.
- Do not treat disappearing events as instant cancellations.

## Sync Logic

1. Worker selects tenants with OTA sync enabled.
2. Worker loads active listing mappings for the tenant.
3. Worker pulls each inbound iCal feed.
4. Worker normalizes events into internal date ranges using the property timezone.
5. Worker checks whether the event already exists locally as an imported OTA booking.
6. Worker checks overlap against existing Pilloto reservations.
7. If no overlap exists, worker creates or updates a normal local reservation with OTA metadata.
8. If overlap exists, worker creates a conflict record and leaves the local reservation untouched.
9. Worker stores a sync-run summary.

## Conflict Handling

- Pilloto should not auto-resolve conflicts.
- A conflict means an OTA event wants inventory that Pilloto already considers unavailable.
- The user decides the business resolution.
- The action is manual.
- The system tracks the conflict, status, notes, and audit history.

Recommended statuses:

- pending_review
- resolved_keep_pilloto
- resolved_accept_ota
- resolved_outside_system
- ignored_false_positive

## UI Design

### Settings > OTA

- Enable OTA sync
- Set sync interval
- Set timezone
- Add provider mappings
- Paste inbound feed URLs
- Copy outbound Pilloto feed URLs
- View last sync status
- Trigger manual sync

### Dedicated Conflict Queue

- Show provider, listing, guest, dates, overlap target, created time, and status
- Open detail view with side-by-side comparison of OTA event vs local reservation
- Allow manual resolution status update and notes

### Reservation Details

- Show source badge such as OTA: Airbnb
- Show external booking id if available
- Show linked conflict history if applicable

## Technical Requirements

### Functional

- Tenant can configure multiple OTA mappings.
- Tenant can copy secure outbound feed URLs.
- System can pull multiple inbound OTA iCal feeds.
- System can create local OTA-origin reservations when there is no overlap.
- System can detect overlap and create conflicts.
- System stores sync history and last success or failure.
- Tenant can manually trigger sync.
- Tenant can manually resolve conflicts.

### Data

- Reservation must support source metadata such as provider, external event id, mapping id, and imported timestamps.
- Dedicated conflict model is required.
- Dedicated sync-run model is required.
- Dedicated listing-mapping model is strongly recommended.

### Operational

- Worker must be idempotent.
- Worker must be tenant-safe.
- Worker must support retries and timeout handling.
- Feed pulls must be rate-limited and logged.
- Timezone normalization must be explicit.

### Security

- Outbound feeds must use opaque tokens.
- Tokens must be rotatable.
- Tenant isolation must be enforced on every sync and feed access.
- Manual sync endpoints should require OTA management permission.

### UX

- Settings tab is for configuration only.
- Conflict queue is for operations.
- Manual resolution must keep an audit trail.
- Sync failures and pending conflicts should be visible from admin UI.

## Important iCal Limitations

- iCal is good for availability blocking, not full reservation management.
- It is not real-time.
- Guest, payment, pricing, and policy data are incomplete or inconsistent.
- Cancellation detection is weaker than a full API integration.
- Inventory mapping must be strict.
- If one OTA listing actually represents pooled hotel inventory, plain iCal becomes fragile.

## Best-Practice Decisions

- Keep v1 limited to accommodations.
- Treat accepted OTA events as normal reservations with OTA metadata.
- Keep conflicts separate from reservations.
- Never auto-resolve overlaps.
- Never let disappearing OTA events immediately cancel local reservations.
- Add OTA-specific permissions such as:
  - admin.ota.view
  - admin.ota.manage
  - admin.ota.resolve

## Implementation Plan

1. Add OTA domain models: listing mapping, sync run, imported external event, conflict.
2. Extend settings with OTA global options.
3. Add secure outbound iCal feed endpoints.
4. Add inbound iCal fetch and parse worker.
5. Add overlap detection and conflict creation flow.
6. Add OTA tab in Settings.
7. Add dedicated conflict queue UI and resolution workflow.
8. Add permissions, audit trail, monitoring, and manual sync endpoint.
9. Validate end-to-end with multi-tenant, timezone, duplicate, cancellation, and overlap scenarios.

## Recommendation

Settings tab plus dedicated conflict queue plus worker-based iCal sync plus Pilloto-wins conflict policy.
