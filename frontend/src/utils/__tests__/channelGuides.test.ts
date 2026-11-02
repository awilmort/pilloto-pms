import mockEs from '../../locales/es/translation.json';
import mockEn from '../../locales/en/translation.json';
import { CHANNEL_GUIDES, Localized, channelCatalog, guideFor, nextStep, stepsFor, localized, CONNECTIVITY_PROVIDER } from '../channelGuides';
import { CHANNEL_STATES } from '../channels';

const texts = (g: ReturnType<typeof guideFor>): Localized[] => [
  g.summary, ...g.checklist.map((c) => c.text), ...(g.authorize?.steps ?? []), ...(g.authorize?.propertyId ? [g.authorize.propertyId] : []),
  ...g.connect, ...(g.tips ?? []), ...(g.afterActivation ?? []),
];

describe('channelGuides', () => {
  it('every guide is complete in Spanish and English', () => {
    for (const g of [...Object.values(CHANNEL_GUIDES), guideFor('AGO')]) {
      expect(g.checklist.length).toBeGreaterThan(0);
      expect(g.connect.length).toBeGreaterThan(0);
      for (const l of texts(g)) {
        expect(l.es.trim()).not.toBe('');
        expect(l.en.trim()).not.toBe('');
      }
    }
  });

  it('only names the connectivity provider through the {{provider}} placeholder', () => {
    for (const g of [...Object.values(CHANNEL_GUIDES), guideFor('DDC')]) {
      for (const l of texts(g)) expect(`${l.es} ${l.en}`).not.toMatch(/channex/i);
    }
    expect(localized(CHANNEL_GUIDES.BDC.authorize!.steps[2], 'es', { provider: CONNECTIVITY_PROVIDER })).toContain('«Channex»');
  });

  it('the guides for Booking.com, Expedia, Airbnb and Vrbo exist; other codes get the generic guide', () => {
    expect(Object.keys(CHANNEL_GUIDES).sort()).toEqual(['ABB', 'BDC', 'EXP', 'VRB']);
    expect(guideFor('AGO')).toMatchObject({ code: 'AGO', name: 'Agoda' });
    expect(guideFor('ZZZ')).toMatchObject({ code: 'ZZZ', name: 'ZZZ' });
    expect(guideFor('ZZZ').docsUrl).toMatch(/^https:\/\//);
  });

  it('"Open in new window" is offered only where flagged (Airbnb)', () => {
    expect(Object.values(CHANNEL_GUIDES).filter((g) => g.openInNewWindow).map((g) => g.code)).toEqual(['ABB']);
    expect(guideFor('AGO').openInNewWindow).toBeFalsy();
  });

  it('OTAs that log in inside the connect step skip "authorize"', () => {
    expect(stepsFor(CHANNEL_GUIDES.BDC).map((s) => s.key)).toEqual(['before', 'authorize', 'connect', 'verify', 'done']);
    expect(stepsFor(CHANNEL_GUIDES.ABB).map((s) => s.number)).toEqual([1, 3, 4, 5]);
    expect(stepsFor(CHANNEL_GUIDES.VRB).map((s) => s.key)).not.toContain('authorize');
    expect(nextStep(CHANNEL_GUIDES.ABB, 1, 1)).toBe(3);
    expect(nextStep(CHANNEL_GUIDES.ABB, 3, -1)).toBe(1);
    expect(nextStep(CHANNEL_GUIDES.BDC, 1, 1)).toBe(2);
    expect(nextStep(CHANNEL_GUIDES.BDC, 3, -1)).toBe(2);
    expect(nextStep(CHANNEL_GUIDES.BDC, 5, 1)).toBe(5);
    expect(nextStep(CHANNEL_GUIDES.BDC, 1, -1)).toBe(1);
    // A saved step the OTA does not show (e.g. guide changed) moves to a real one
    expect(nextStep(CHANNEL_GUIDES.ABB, 2, 1)).toBe(3);
  });

  it('the platform console catalogue: guided OTAs first, then the generic-guide ones, no repeats', () => {
    const catalog = channelCatalog();
    expect(catalog.filter((c) => c.guided).map((c) => c.code)).toEqual(Object.keys(CHANNEL_GUIDES));
    expect(catalog.find((c) => c.code === 'DDC')).toEqual({ code: 'DDC', name: 'Despegar', guided: false });
    expect(new Set(catalog.map((c) => c.code)).size).toBe(catalog.length);
  });

  it('fills placeholders', () => {
    expect(localized({ es: 'Moneda {{currency}} en {{name}}', en: '' }, 'es', { currency: 'USD', name: 'Expedia' })).toBe('Moneda USD en Expedia');
  });

  it('every channel state has a label and a sentence in both languages', () => {
    for (const locale of [mockEs, mockEn] as any[]) {
      const ch = locale.admin.channelManager.channels;
      for (const s of CHANNEL_STATES) {
        expect(ch.state[s]).toBeTruthy();
        expect(ch.stateText[s]).toBeTruthy();
      }
    }
  });
});
