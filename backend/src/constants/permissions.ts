import { AppCode } from './apps';

/**
 * PMS_PERMISSIONS — the real, in-use permission list for the `pms` app.
 *
 * Verified by grep (2026-08-31) against every `authorizePermission(...)` call
 * site in `backend/src/routes/*.ts` and `backend/src/middleware/*.ts`, every
 * inline `perms.includes('...')` / `role.permissions.includes('...')` check,
 * and every `Role.find({ permissions: '...' })` access-routing query — i.e.
 * every permission string that actually gates something today, not just
 * whatever the old `GET /api/admin/permissions` hardcoded array happened to
 * list.
 *
 * The old catalog in `routes/admin.ts` had drifted from what's enforced:
 *   - `admin.backup`                    — dead. `/api/admin/backup` is gated
 *     by `authorize('admin')` (role-name check), never by this string.
 *   - `admin.reservations.priceUpdate`  — dead. Never read anywhere; only
 *     `admin.reservations.amountUpdate` is actually checked.
 * Both are omitted here. If either needs to exist, it should be wired to a
 * real check first.
 *
 * `schedule.view` and `accommodations.manage` are kept as legacy names: they
 * aren't checked by backend route/middleware code, but they *are* seeded on
 * default roles (`provisionTenant.ts`) and read by the frontend
 * (`AuthContext.tsx`'s `legacyMap`) to gate nav visibility, so they're real,
 * just not backend-enforced.
 *
 * 2026-09-01 addition (Phase 1.3): the original 0.1 audit only grepped
 * backend `routes/*.ts`/`middleware/*.ts`, which missed a whole class of
 * permission strings that gate *frontend* route access and nav visibility —
 * `App.tsx`'s `<ProtectedRoute requiredPermission="...">` and
 * `AdminLayout.tsx`'s nav-item `perm:` filtering. Re-grepped against both;
 * added below (`admin.schedule`, `admin.guests`, `admin.companies`,
 * `admin.creditAccounts`, `admin.pricing`, `admin.ecf.view`,
 * `admin.settings` gate real route access; `admin.amenities`,
 * `admin.eventTypes`, `admin.media` gate Header/AdminDashboard quick-link
 * visibility only). Without these, Phase 1.3's catalog-driven Roles UI would
 * silently drop the ability to grant/revoke them.
 */
export const PMS_PERMISSIONS = [
  // Core admin
  'admin.access',
  'admin.dashboard',

  // Users and roles
  'admin.users',
  'admin.roles',

  // Reservations
  'admin.reservations',
  'admin.reservations.assignRoom',
  'admin.reservations.managePayments',
  'admin.reservations.amountUpdate',
  'admin.reservations.cancel',
  'admin.reservations.checkin',
  'admin.reservations.discount',
  'admin.reservations.assignCorporatePrice',

  // Revenue/Commissions
  'admin.revenue',
  'admin.commissions',
  'salesman',

  // Rooms/Accommodations
  'admin.rooms',
  'admin.accommodations',
  'accommodations.manage', // legacy alias of admin.accommodations, frontend-mapped

  // Wristbands
  'admin.wristbands.view',
  'admin.wristbands.manage',

  // OTA
  'admin.ota.view',
  'admin.ota.manage',
  'admin.ota.resolve',

  // Cashier
  'cashier',

  // Schedule (legacy name, frontend-mapped to nav visibility only)
  'schedule.view',

  // Frontend route/nav gates (see 2026-09-01 note above)
  'admin.schedule',
  'admin.guests',
  'admin.companies',
  'admin.creditAccounts',
  'admin.pricing',
  'admin.ecf.view',
  'admin.settings',
  'admin.amenities',
  'admin.eventTypes',
  'admin.media',
] as const;

/**
 * ACCOUNTING_PERMISSIONS — the permission catalog for the `accounting` app.
 */
export const ACCOUNTING_PERMISSIONS = [
  'accounting.access',
  'accounting.dashboard',

  'accounting.invoices.view',
  'accounting.invoices.manage',
  'accounting.invoices.void',

  'accounting.quotes.view',
  'accounting.quotes.manage',

  'accounting.creditNotes.view',
  'accounting.creditNotes.manage',
  'accounting.creditNotes.void',

  'accounting.debitNotes.view',
  'accounting.debitNotes.manage',
  'accounting.debitNotes.void',

  'accounting.customers.manage',

  'accounting.cityLedger.view',
  'accounting.cityLedger.authorize',

  'accounting.bills.view',
  'accounting.bills.manage',
  'accounting.bills.void',

  'accounting.suppliers.manage',

  'accounting.inventory.view',
  'accounting.inventory.manage',

  'accounting.accounts.manage',

  'accounting.journal.view',
  'accounting.journal.manage',

  'accounting.reports.view',

  'accounting.settings.manage',
  'accounting.users',
  'accounting.roles',
] as const;

export type PmsPermission = (typeof PMS_PERMISSIONS)[number];
export type AccountingPermission = (typeof ACCOUNTING_PERMISSIONS)[number];
export type Permission = PmsPermission | AccountingPermission;

export const PERMISSIONS_BY_APP: Record<AppCode, readonly string[]> = {
  pms: PMS_PERMISSIONS,
  accounting: ACCOUNTING_PERMISSIONS,
};

/**
 * Per-app "master access" permission — grants everything within that app.
 * Note pms keeps its legacy `admin.*` naming (predates the app concept);
 * accounting follows the `<app>.*` convention introduced in this catalog.
 * Callers doing dynamic app-scoped permission checks must look these up
 * through this map rather than template-stringing `${app}.access`.
 */
export const APP_ACCESS_PERMISSION: Record<AppCode, string> = {
  pms: 'admin.access',
  accounting: 'accounting.access',
};

/** Per-app permission required to manage that app's users. */
export const APP_USERS_PERMISSION: Record<AppCode, string> = {
  pms: 'admin.users',
  accounting: 'accounting.users',
};

/** Per-app permission required to manage that app's roles. */
export const APP_ROLES_PERMISSION: Record<AppCode, string> = {
  pms: 'admin.roles',
  accounting: 'accounting.roles',
};
