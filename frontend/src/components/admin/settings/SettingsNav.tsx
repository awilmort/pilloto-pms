/**
 * Settings navigation (Configuración): the main sidebar has one "Configuración" item; inside it,
 * a lighter secondary column lists the settings pages under group headings, with a search box
 * and an overview page first. Below the md breakpoint the column is hidden: the overview is the
 * list and each page shows a "‹ Configuración" back link. Every page keeps its own URL
 * (`/admin/settings/:section`); `/admin/settings` is the overview.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, InputAdornment, Paper, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import { ChevronLeft, ChevronRight, Search } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../../lib/permissions';
import { BRAND, PRODUCT_COLORS, PRODUCT_COLORS_DEEP, alpha } from '../../../brand';

// Settings lives inside the PMS app, so it takes the PMS accent.
const ACCENT = PRODUCT_COLORS.pms;
const ACCENT_DEEP = PRODUCT_COLORS_DEEP.pms;

export interface SettingsItem {
  section: string;
  /** Page name (admin.settings.tabs.*) */
  labelKey: string;
  /** One-line description shown on the overview (admin.settings.nav.items.*) */
  descKey: string;
  /** Extra words the search matches, comma-separated (admin.settings.nav.keywords.*) */
  keywordsKey: string;
  /** Hidden when the user lacks this permission */
  perm?: string;
}

export interface SettingsGroup {
  key: string;
  labelKey: string;
  descKey: string;
  items: SettingsItem[];
}

const item = (section: string, tab: string, perm?: string): SettingsItem => ({
  section, labelKey: `admin.settings.tabs.${tab}`, descKey: `admin.settings.nav.items.${tab}`, keywordsKey: `admin.settings.nav.keywords.${tab}`, perm,
});

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { key: 'property', labelKey: 'admin.settings.groups.property', descKey: 'admin.settings.nav.groups.property', items: [
    item('profile', 'profile'), item('room-types', 'roomTypes'), item('amenities', 'amenities'), item('media', 'media'),
  ] },
  { key: 'operations', labelKey: 'admin.settings.groups.operations', descKey: 'admin.settings.nav.groups.operations', items: [
    item('checkout', 'checkout'), item('night-audit', 'nightAudit'), item('event-types', 'eventTypes'), item('sections', 'sections'),
  ] },
  { key: 'sales', labelKey: 'admin.settings.groups.sales', descKey: 'admin.settings.nav.groups.sales', items: [
    item('booking-engine', 'booking'), item('channel-manager', 'channelManager', 'admin.ota.view'), item('reviews', 'reviews'),
  ] },
  { key: 'billing', labelKey: 'admin.settings.groups.billing', descKey: 'admin.settings.nav.groups.billing', items: [
    item('e-invoicing', 'ecf'),
  ] },
  { key: 'communication', labelKey: 'admin.settings.groups.communication', descKey: 'admin.settings.nav.groups.communication', items: [
    item('email', 'email'),
  ] },
  { key: 'access', labelKey: 'admin.settings.groups.access', descKey: 'admin.settings.nav.groups.access', items: [
    item('roles', 'roles'),
  ] },
];

export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.section));
export const settingsItem = (section: string) => SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.section === section);

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Groups with the items the user may open (`allowed(perm)`) that match `query` — page name,
 * keywords or group name, case and accents ignored. Groups left empty are dropped.
 */
export function filterSettingsGroups(groups: SettingsGroup[], query: string, t: (key: string) => string, allowed: (perm: string) => boolean): SettingsGroup[] {
  const q = fold(query.trim());
  return groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.perm || allowed(i.perm))
      && (!q || fold(`${t(i.labelKey)} ${t(i.keywordsKey)} ${t(g.labelKey)}`).includes(q))),
  })).filter((g) => g.items.length > 0);
}

function useVisibleGroups(query: string): SettingsGroup[] {
  const { t } = useTranslation();
  const canChannels = usePermission('admin.ota.view');
  return useMemo(
    () => filterSettingsGroups(SETTINGS_GROUPS, query, (k) => t(k), (perm) => perm !== 'admin.ota.view' || canChannels),
    [query, t, canChannels],
  );
}

const SearchBox: React.FC<{ id: string; value: string; onChange: (v: string) => void }> = ({ id, value, onChange }) => {
  const { t } = useTranslation();
  return (
    <TextField id={id} size="small" fullWidth type="search" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={t('admin.settings.nav.search')} inputProps={{ 'aria-label': t('admin.settings.nav.search') }}
      InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
      sx={{ '& .MuiOutlinedInput-root': { bgcolor: BRAND.paper } }} />
  );
};

/** Same language as the main sidebar: the current page is a solid deep-accent pill with white text. */
const linkSx = (active: boolean) => ({
  justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.875rem', fontWeight: active ? 600 : 500,
  px: 1.25, py: 0.75, borderRadius: '8px', minHeight: 36, textAlign: 'left',
  color: active ? BRAND.white : BRAND.inkSoft,
  bgcolor: active ? ACCENT_DEEP : 'transparent',
  boxShadow: active ? `0 1px 2px ${alpha(ACCENT_DEEP, 0.35)}` : 'none',
  '&:hover': { bgcolor: active ? ACCENT_DEEP : alpha(ACCENT, 0.1), color: active ? BRAND.white : BRAND.ink },
});

const groupHeadingSx = {
  px: 1.25, pt: 2, pb: 0.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: ACCENT_DEEP, fontSize: '0.6875rem',
} as const;

/** The secondary column (md and up). */
const SettingsColumn: React.FC<{ section: string }> = ({ section }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const groups = useVisibleGroups(query);
  return (
    <Box component="nav" aria-label={t('admin.settings.title')} sx={{
      width: 236, flex: 'none', alignSelf: 'flex-start', position: 'sticky', top: 16, maxHeight: 'calc(100vh - 112px)', overflowY: 'auto',
      bgcolor: BRAND.white, border: `1px solid ${BRAND.mist}`, borderTop: `3px solid ${ACCENT}`, borderRadius: 2, p: 1.5,
      display: 'flex', flexDirection: 'column', gap: 0.25,
    }}>
      <SearchBox id="settings-nav-search" value={query} onChange={setQuery} />
      <Button sx={{ ...linkSx(section === 'overview'), mt: 1 }} onClick={() => navigate('/admin/settings')} aria-current={section === 'overview' ? 'page' : undefined}>
        {t('admin.settings.nav.overview')}
      </Button>
      {groups.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ p: 1 }}>{t('admin.settings.nav.noResults', { query })}</Typography>}
      {groups.map((g) => (
        <React.Fragment key={g.key}>
          <Typography variant="caption" sx={groupHeadingSx}>
            {t(g.labelKey)}
          </Typography>
          {g.items.map((i) => (
            <Button key={i.section} sx={linkSx(section === i.section)} onClick={() => navigate(`/admin/settings/${i.section}`)}
              aria-current={section === i.section ? 'page' : undefined}>
              {t(i.labelKey)}
            </Button>
          ))}
        </React.Fragment>
      ))}
    </Box>
  );
};

/** The overview: every group with its pages (cards on desktop, a tappable list on phones). */
export const SettingsOverview: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const [query, setQuery] = useState('');
  const groups = useVisibleGroups(query);
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="h6" fontWeight={700}>{t('admin.settings.title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('admin.settings.nav.overviewIntro')}</Typography>
      </Box>
      {!wide && <SearchBox id="settings-overview-search" value={query} onChange={setQuery} />}
      {groups.length === 0 && <Typography variant="body2" color="text.secondary">{t('admin.settings.nav.noResults', { query })}</Typography>}
      {wide ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {groups.map((g) => (
            <Paper key={g.key} variant="outlined" sx={{ p: 2, display: 'grid', gap: 0.5, alignContent: 'start', borderTop: `3px solid ${ACCENT}` }}>
              <Typography fontWeight={700} sx={{ color: ACCENT_DEEP }}>{t(g.labelKey)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>{t(g.descKey)}</Typography>
              {g.items.map((i) => (
                <Box key={i.section}>
                  <Button size="small" onClick={() => navigate(`/admin/settings/${i.section}`)} sx={{ textTransform: 'none', p: 0, minWidth: 0, fontWeight: 600, color: ACCENT_DEEP }}>
                    {t(i.labelKey)}
                  </Button>
                  <Typography variant="caption" color="text.secondary" display="block">{t(i.descKey)}</Typography>
                </Box>
              ))}
            </Paper>
          ))}
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {groups.map((g) => (
            <Box key={g.key}>
              <Typography variant="caption" sx={{ px: 0.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: ACCENT_DEEP }}>{t(g.labelKey)}</Typography>
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                {g.items.map((i, idx) => (
                  <Button key={i.section} fullWidth onClick={() => navigate(`/admin/settings/${i.section}`)} endIcon={<ChevronRight />}
                    sx={{ justifyContent: 'space-between', textTransform: 'none', color: 'text.primary', px: 1.5, py: 1.25, borderRadius: 0, borderTop: idx ? 1 : 0, borderColor: 'divider' }}>
                    {t(i.labelKey)}
                  </Button>
                ))}
              </Paper>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

/** Layout of every settings page: the column (md and up) beside the page, or a back link on phones. */
export const SettingsShell: React.FC<{ section: string; children: React.ReactNode }> = ({ section, children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  return (
    <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', pb: 4 }}>
      {wide && <SettingsColumn section={section} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {!wide && section !== 'overview' && (
          <Button size="small" startIcon={<ChevronLeft />} onClick={() => navigate('/admin/settings')} sx={{ mb: 1, textTransform: 'none' }}>
            {t('admin.settings.title')}
          </Button>
        )}
        {children}
      </Box>
    </Box>
  );
};
