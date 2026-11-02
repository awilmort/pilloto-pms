import i18next from 'i18next';
import mockEs from '../../locales/es/translation.json';
import mockEn from '../../locales/en/translation.json';
import { alertTexts, CHANNEL_ALERT_TYPES, deadlineLeft, todoKey, whatKey } from '../channelAlerts';
import type { ChannelAlert } from '../../services/api';

const get = (obj: any, key: string) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const VARIANTS: Partial<ChannelAlert>[] = [
  { type: 'modification_needs_review', params: { change: 'cancelled' } },
  { type: 'modification_needs_review', params: { change: 'reinstated' } },
  { type: 'ari_warning', params: { what: 'rates', count: 2 } },
  { type: 'channel_removal_warning', params: { removalDate: '2026-12-01' } },
  { type: 'remap_required', params: { phase: 'map_in_channels', name: 'Twin' } },
];

describe('channel alert texts', () => {
  const all = [...CHANNEL_ALERT_TYPES.map((type) => ({ type, params: {} })), ...VARIANTS] as ChannelAlert[];

  it.each([['es', mockEs], ['en', mockEn]])('every alert type and variant has a title, what and todo in %s, never naming the provider', (_lang, dict) => {
    for (const a of all) {
      for (const key of [`admin.channelAlerts.types.${a.type}.title`, whatKey(a), todoKey(a), `admin.channelAlerts.actions.reservation`]) {
        const text = get(dict, key);
        expect(typeof text).toBe('string');
        expect(text.trim()).not.toBe('');
      }
    }
    expect(JSON.stringify(get(dict, 'admin.channelAlerts'))).not.toMatch(/channex/i);
    expect(get(dict, 'admin.nav.channelAlerts')).toBeTruthy();
  });

  it('interpolates every placeholder with real values or plain fallbacks', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'es', resources: { es: { translation: mockEs }, en: { translation: mockEn } }, interpolation: { escapeValue: false } });
    const t = i18n.t.bind(i18n) as any;
    const samples: ChannelAlert[] = [
      ...all,
      { type: 'overbooking', params: { otaName: 'BookingCom', otaReservationCode: '4021', guestName: 'Ana Pérez', nights: ['2026-12-01', '2026-12-02'] } } as any,
      { type: 'airbnb_reservation_request', params: { guestName: 'Luis', checkIn: '2026-12-10', checkOut: '2026-12-13', nights: 3 } } as any,
      { type: 'currency_mismatch', params: { otaName: 'Expedia', bookingCurrency: 'EUR', propertyCurrency: 'USD' } } as any,
    ];
    for (const lng of ['es', 'en']) {
      await i18n.changeLanguage(lng);
      for (const a of samples) {
        const x = alertTexts(a, t, lng);
        for (const s of [x.title, x.what, x.todo]) expect(s).not.toMatch(/\{\{|\}\}|admin\.channelAlerts/);
      }
    }
    await i18n.changeLanguage('es');
    expect(alertTexts(samples[samples.length - 3], t, 'es').what).toMatch(/^Booking\.com 4021 \(Ana Pérez\) llegó para fechas sin habitación libre \(1 dic de 2026, 2 dic de 2026\)/);
    expect(alertTexts(samples[samples.length - 2], t, 'es').what).toMatch(/^Luis quiere reservar del 10 dic de 2026 al 13 dic de 2026 \(3 noches\)/);
    expect(alertTexts({ type: 'sync_error', params: {} } as any, t, 'es').what).toMatch(/^Un canal reportó/);
  });

  it('deadline countdown', () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    expect(deadlineLeft('2026-11-02T08:30:00Z', now)).toEqual({ expired: false, hours: 22, minutes: 30 });
    expect(deadlineLeft('2026-11-01T09:00:00Z', now)).toEqual({ expired: true, hours: 0, minutes: 0 });
    expect(deadlineLeft(undefined, now)).toBeNull();
  });
});
