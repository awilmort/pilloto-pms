/**
 * App registry — the set of products a tenant can hold and a user can be
 * granted per-app roles in.
 *
 * Routing is by path (`/admin/*`, `/accounting/*`), not by subdomain — the
 * subdomain is already the tenant identity, so there is no spare subdomain
 * to spend on "which app".
 */

export const APP_CODES = ['pms', 'accounting'] as const;

export type AppCode = (typeof APP_CODES)[number];

export const APP_METADATA: Record<AppCode, { name: string; path: string }> = {
  pms:        { name: 'Pilloto PMS',        path: '/admin' },
  accounting: { name: 'Pilloto Accounting', path: '/accounting' },
};

export function isAppCode(value: unknown): value is AppCode {
  return typeof value === 'string' && (APP_CODES as readonly string[]).includes(value);
}
