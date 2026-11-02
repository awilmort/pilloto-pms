/**
 * Channels on the home and the connect-a-channel wizard (plan Phases 8.1–8.2), with the API
 * faked: every channel state in words, the platform-only switch hiding the connect actions,
 * the wizard's steps (checklist gate, connect frame for that OTA, live verification, done),
 * resuming at the saved step, the popup option only for flagged OTAs, and a new guide entry
 * rendering with no code change. Real English strings.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../../locales/en/translation.json';

const mockApi = {
  channels: jest.fn(),
  getChannelOnboarding: jest.fn(),
  saveChannelOnboarding: jest.fn(),
  iframeSession: jest.fn(),
  preview: jest.fn(),
};
jest.mock('../../../../services/api', () => ({
  channelManagerService: new Proxy({}, { get: (_t, k: string) => (...args: any[]) => (mockApi as any)[k](...args) }),
}));
jest.mock('react-i18next', () => {
  const lookup = (key: string) => key.split('.').reduce((o: any, p) => (o ? o[p] : undefined), mockEn);
  const t = (key: string, opts: Record<string, any> = {}) => {
    let s = opts.count !== undefined ? lookup(`${key}_${opts.count === 1 ? 'one' : 'other'}`) ?? lookup(key) : lookup(key);
    if (typeof s !== 'string') return key;
    for (const [k, v] of Object.entries(opts)) s = s.split(`{{${k}}}`).join(String(v));
    return s;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

// eslint-disable-next-line import/first
import ChannelsPanel from '../ChannelsPanel';
// eslint-disable-next-line import/first
import ConnectChannelWizard from '../ConnectChannelWizard';
// eslint-disable-next-line import/first
import { CHANNEL_GUIDES } from '../../../../utils/channelGuides';

const ok = (data: any) => Promise.resolve({ data: { data } });
const card = (state: string, over: Record<string, any> = {}) => ({
  id: `id-${state}`, title: `T ${state}`, otaCode: 'BDC', otaName: 'Booking.com', active: state === 'active' || state === 'attention', state,
  alerts: { critical: state === 'attention' ? 1 : 0, warning: 0 }, ...over,
});
/** What the fake server has saved for the wizard (a PUT merges into it, like the real one) */
let saved: Record<string, any> = {};
const progress = (over: Record<string, any> = {}) => ({ otaCode: 'BDC', step: 1, answers: {}, status: 'in_progress', started: true, channel: null, ...over });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.iframeSession.mockImplementation(() => ok({ url: 'https://frame.example/auth/exchange?oauth_session_key=x', expiresAt: '2026-11-01T10:15:00Z' }));
  mockApi.preview.mockImplementation(() => ok({ roomTypes: [{ name: 'Twin Room', isActive: true, sellOnChannels: true, ratePlans: [{ name: 'Best Available Rate', isActive: true, sellOnChannels: true }] }] }));
  saved = {};
  mockApi.saveChannelOnboarding.mockImplementation((code: string, patch: any) => { saved = { ...saved, ...patch }; return ok(progress({ otaCode: code, ...saved })); });
});

describe('ChannelsPanel', () => {
  const states = ['active', 'attention', 'waiting_ota', 'needs_mapping', 'ready_to_activate', 'inactive', 'removal_scheduled', 'removed'];

  it('every channel state renders in words, with alerts and a continue button for unfinished connections', async () => {
    mockApi.channels.mockImplementation(() => ok({
      channels: states.map((s) => card(s, s === 'needs_mapping' ? { onboarding: { otaCode: 'BDC', step: 3, status: 'in_progress' } } : {})),
      onboardings: [{ otaCode: 'EXP', step: 2, status: 'in_progress' }],
      stale: false, connection: 'tenant', offered: ['BDC', 'EXP', 'ABB'],
    }));
    render(<ChannelsPanel canManage active />);
    const en = (mockEn as any).admin.channelManager.channels;
    for (const s of states) {
      expect(await screen.findByText(en.state[s])).toBeInTheDocument();
      expect(screen.getByText(en.stateText[s].replace('{{name}}', 'Booking.com'))).toBeInTheDocument();
    }
    expect(screen.getByText('1 important alert')).toBeInTheDocument();
    expect(screen.getByText(/Continue connection · step 3 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/You started connecting Expedia \(step 2 of 5\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect a channel/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/channex/i);
  });

  it('platform-only: no connect actions, a note instead', async () => {
    mockApi.channels.mockImplementation(() => ok({ channels: [], onboardings: [], stale: false, connection: 'platform_only', offered: ['BDC'] }));
    render(<ChannelsPanel canManage active />);
    expect(await screen.findByText(/Pilloto connects your channels for you/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect a channel/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open channels screen/ })).toBeNull();
  });

  it('the wizard opens on the OTA cards from the offered list', async () => {
    mockApi.channels.mockImplementation(() => ok({ channels: [card('active')], onboardings: [], stale: false, connection: 'tenant', offered: ['BDC', 'ABB', 'AGO'] }));
    render(<ChannelsPanel canManage active />);
    fireEvent.click(await screen.findByRole('button', { name: /Connect a channel/ }));
    expect(await screen.findByRole('button', { name: 'Connect Booking.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Airbnb' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Agoda' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Connected')).toBeInTheDocument(); // Booking.com already has an active channel
  });
});

describe('ConnectChannelWizard', () => {
  const renderWizard = (props: Partial<React.ComponentProps<typeof ConnectChannelWizard>> = {}) => render(
    <ConnectChannelWizard open otaCode="BDC" offered={['BDC', 'EXP', 'ABB']} platformOnly={false} connectedCodes={[]} canManage onClose={jest.fn()} {...props} />,
  );

  it('step 1: every checklist item must be ticked; each tick is saved', async () => {
    mockApi.getChannelOnboarding.mockImplementation(() => ok(progress({ started: false })));
    renderWizard();
    const next = await screen.findByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(CHANNEL_GUIDES.BDC.checklist.length);
    expect(screen.getByText(/The same as in Pilloto|same as in Pilloto \(DOP\)/)).toBeInTheDocument();
    for (const b of boxes) fireEvent.click(b);
    await waitFor(() => expect(next).toBeEnabled());
    expect(mockApi.saveChannelOnboarding).toHaveBeenLastCalledWith('BDC', { answers: { checklist: { ical: true, otherManager: true, currency: true, policies: true } } });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(mockApi.saveChannelOnboarding).toHaveBeenLastCalledWith('BDC', { step: 2 });
    expect(await screen.findByText(/Account → Connectivity provider/)).toBeInTheDocument();
  });

  it('resumes at the saved step: connect and map with the frame for that OTA, mapping rules and Pilloto names', async () => {
    mockApi.getChannelOnboarding.mockImplementation(() => ok(progress({ step: 3, answers: { authorized: true } })));
    renderWizard();
    await waitFor(() => expect(mockApi.iframeSession).toHaveBeenCalledWith({ otaCode: 'BDC', language: 'en' }));
    expect(await screen.findByTitle('Channel connection')).toHaveAttribute('src', 'https://frame.example/auth/exchange?oauth_session_key=x');
    expect(screen.getByText(/Map EVERY Booking.com room and rate/)).toBeInTheDocument();
    expect(await screen.findByText('Twin Room')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open in new window/ })).toBeNull(); // not flagged for Booking.com
  });

  it('"Open in new window" appears for Airbnb, which also skips the authorize step', async () => {
    mockApi.getChannelOnboarding.mockImplementation(() => ok(progress({ otaCode: 'ABB', step: 3 })));
    renderWizard({ otaCode: 'ABB' });
    expect(await screen.findByRole('button', { name: /Open in new window/ })).toBeInTheDocument();
    expect(screen.queryByText(/Authorize in Airbnb/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(mockApi.saveChannelOnboarding).toHaveBeenLastCalledWith('ABB', { step: 1 });
  });

  it('platform-only: the connect step says Pilloto connects the channel, no frame', async () => {
    mockApi.getChannelOnboarding.mockImplementation(() => ok(progress({ step: 3 })));
    renderWizard({ platformOnly: true });
    expect(await screen.findByText(/Pilloto connects Booking.com for you/)).toBeInTheDocument();
    expect(screen.queryByTitle('Channel connection')).toBeNull();
    expect(mockApi.iframeSession).not.toHaveBeenCalled();
  });

  it('step 4 polls the live state: mapping missing → waiting for approval → active with the full sync, then done', async () => {
    saved = { step: 4 };
    let live: any = progress({ step: 4, channel: { ...card('needs_mapping'), problems: [{ kind: 'mapping', count: 2 }], stale: false } });
    mockApi.getChannelOnboarding.mockImplementation((_c: string, isLive?: boolean) => ok(isLive ? live : progress({ step: 4 })));
    jest.useFakeTimers();
    try {
      renderWizard();
      expect(await screen.findByText('2 rooms or rates to map')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

      live = progress({ step: 4, channel: { ...card('ready_to_activate'), problems: [], stale: false } });
      await act(async () => { jest.advanceTimersByTime(10_000); });
      expect(await screen.findByText(/Press “Activate” in the connection screen/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /I am waiting for Booking.com/ }));
      expect(mockApi.saveChannelOnboarding).toHaveBeenLastCalledWith('BDC', { status: 'waiting_ota' });

      live = progress({ step: 4, status: 'waiting_ota', channel: { ...card('waiting_ota'), problems: [], stale: false } });
      await act(async () => { jest.advanceTimersByTime(10_000); });
      expect(await screen.findByText(/Waiting for Booking.com to approve the connection/)).toBeInTheDocument();

      live = progress({ step: 4, channel: { ...card('active'), stale: false, fullSync: { sentAt: '2026-11-01T10:00:00Z', status: 'ok' } } });
      await act(async () => { jest.advanceTimersByTime(10_000); });
      expect(await screen.findByText('Booking.com is active!')).toBeInTheDocument();
      expect(screen.getByText(/Pilloto sent all your prices and availability/)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/channex/i);
      const next = screen.getByRole('button', { name: 'Continue' });
      expect(next).toBeEnabled();
      fireEvent.click(next);
      expect(mockApi.saveChannelOnboarding).toHaveBeenLastCalledWith('BDC', { step: 5, status: 'completed' });
      expect(await screen.findByText('Booking.com is connected')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a new OTA needs only a channelGuides entry', async () => {
    (CHANNEL_GUIDES as any).TST = {
      code: 'TST', name: 'TestOTA', summary: { es: 'x', en: 'Test OTA summary' },
      checklist: [{ id: 'only', text: { es: 'Solo esto', en: 'Only this one thing' } }],
      connect: [{ es: 'Conecta', en: 'Connect it' }],
    };
    try {
      mockApi.getChannelOnboarding.mockImplementation(() => ok(progress({ otaCode: 'TST', started: false })));
      renderWizard({ otaCode: 'TST', offered: ['TST'] });
      expect(await screen.findByText('Connect TestOTA')).toBeInTheDocument();
      expect(await screen.findByText('Only this one thing')).toBeInTheDocument();
      expect(screen.queryByText(/Authorize in TestOTA/)).toBeNull(); // no authorize data → step not shown
    } finally {
      delete (CHANNEL_GUIDES as any).TST;
    }
  });
});
