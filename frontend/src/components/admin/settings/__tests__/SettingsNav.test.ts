/**
 * Settings navigation search (components/admin/settings/SettingsNav.tsx): matches page names,
 * keywords and group names in the user's language, ignoring case and accents, and hides pages
 * the user has no permission for.
 */
// Only the pure filter is tested: mock what the component imports (react-router-dom v7 and the
// API client behind lib/permissions do not load under this Jest setup)
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../../../../lib/permissions', () => ({ usePermission: () => true }));

import { SETTINGS_GROUPS, SETTINGS_SECTIONS, filterSettingsGroups } from '../SettingsNav';

const es = require('../../../../locales/es/translation.json');
const t = (key: string): string => key.split('.').reduce((o: any, k) => (o ? o[k] : undefined), es) ?? key;
const sections = (query: string, allowed: (perm: string) => boolean = () => true) =>
  filterSettingsGroups(SETTINGS_GROUPS, query, t, allowed).flatMap((g) => g.items.map((i) => i.section));

describe('settings navigation', () => {
  it('lists all 14 pages, each with a name, description and keywords in Spanish', () => {
    expect(SETTINGS_SECTIONS).toHaveLength(14);
    for (const i of SETTINGS_GROUPS.flatMap((g) => g.items)) {
      for (const key of [i.labelKey, i.descKey, i.keywordsKey]) expect(t(key)).not.toBe(key);
    }
  });

  it('an empty search shows everything', () => {
    expect(sections('')).toEqual(SETTINGS_SECTIONS);
  });

  it.each([
    ['moneda', ['profile']],
    ['RNC', ['profile']],
    ['booking', ['channel-manager']],
    ['dgii', ['e-invoicing']],
    ['auditoria', ['night-audit']], // accents ignored
    ['facturación', ['e-invoicing']], // group name
  ])('“%s” finds %j', (query, expected) => {
    expect(sections(query)).toEqual(expected);
  });

  it('nothing matches → no groups', () => {
    expect(filterSettingsGroups(SETTINGS_GROUPS, 'zzz', t, () => true)).toEqual([]);
  });

  it('hides the Channel Manager without its permission', () => {
    expect(sections('', (perm) => perm !== 'admin.ota.view')).not.toContain('channel-manager');
  });
});
