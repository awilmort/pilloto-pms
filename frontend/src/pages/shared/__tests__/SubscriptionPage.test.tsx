/**
 * The tenant's "Plan & billing" page against a mocked API: what each product shows, adding a
 * product (free trial), an upgrade, a downgrade blocked by usage, cancelling, paying online and the
 * return from the payment page.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../i18n';

const mockApi: Record<string, jest.Mock> = {
  overview: jest.fn(), catalog: jest.fn(), changePlan: jest.fn(), addProduct: jest.fn(), cancelProduct: jest.fn(), keepProduct: jest.fn(),
  setBillingEmail: jest.fn(), charges: jest.fn(), charge: jest.fn(), pay: jest.fn(), confirm: jest.fn(), ecfPdf: jest.fn(),
};
let mockUrl = new URL('http://sol.localhost/admin/subscription');
const mockSetParams = jest.fn();
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockUrl.pathname, search: mockUrl.search }),
  useSearchParams: () => [mockUrl.searchParams, mockSetParams],
}));
jest.mock('../../../services/subscriptionApi', () => ({ subscriptionService: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockApi as any)[k](...a) }) }));

/* eslint-disable import/first */
import SubscriptionPage from '../SubscriptionPage';
/* eslint-enable import/first */

const ok = (data: unknown) => ({ data: { success: true, data } });

const overview = (over: Record<string, unknown> = {}) => ({
  today: '2026-11-16', currency: 'DOP', taxPercent: 18, suiteDiscountPercent: 20,
  products: [{
    product: 'pms', plan: 'pro', planName: 'Pro', status: 'active', startedOn: '2026-09-01', billableFrom: '2026-09-01', endsOn: null, pendingPlan: null,
    price: 5540, discount: null, monthly: 5540, limits: { maxRooms: 50, maxUsers: null }, features: { channelManager: true, bookingEngine: true },
  }],
  available: ['accounting'],
  usage: { pms: { users: 4, rooms: 20 }, accounting: { users: 0, warehouses: 0 } },
  ecf: { includedPlan: 'essential', plan: 'essential', state: 'ready' },
  billingEmail: 'owner@sol.com', paymentInstructions: 'Banco Popular 123-456',
  ...over,
});

const option = (product: string, slug: string, name: string, price: number, over: Record<string, unknown> = {}) => ({
  product, slug, name, monthlyPrice: price, tenantPrice: price, features: {}, limits: {}, includedEcf: { plan: 'essential', transactions: 300 },
  current: false, direction: null, violations: [], lostFeatures: [], ...over,
});

const catalog = {
  currency: 'DOP', taxPercent: 18, suiteDiscountPercent: 20,
  pms: [
    option('pms', 'basic', 'Basic', 2450, { direction: -1, violations: [{ limit: 'rooms', max: 15, current: 20 }], limits: { maxRooms: 15, maxUsers: 2 } }),
    option('pms', 'pro', 'Pro', 5540, { current: true, direction: 0 }),
    option('pms', 'enterprise', 'Enterprise', 9370, { direction: 1 }),
  ],
  accounting: [
    option('accounting', 'invoicing', 'Facturación', 1590, { tenantPrice: 1272 }),
    option('accounting', 'essentials', 'Esencial', 4090, { tenantPrice: 3272 }),
  ],
};

const chargesPage = (rows: unknown[], over: { total?: number; pages?: number; summary?: Record<string, number> } = {}) => ({
  data: {
    success: true, data: rows,
    meta: { total: over.total ?? rows.length, page: 1, limit: 12, pages: over.pages ?? 1 },
    summary: { outstanding: 6537.2, overdueCount: 1, overdueBalance: 6537.2, ...over.summary },
  },
});

const charge = { id: 'c1', number: 'COB-000001', period: '2026-10', lines: [], subtotal: 5540, itbis: 997.2, total: 6537.2, paidAmount: 0, balance: 6537.2, status: 'open', dueDate: '2026-11-15', overdue: true };

const renderPage = (url = '/admin/subscription') => {
  mockUrl = new URL(`http://sol.localhost${url}`);
  return render(<SubscriptionPage />);
};

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.overview.mockResolvedValue(ok(overview()));
  mockApi.catalog.mockResolvedValue(ok(catalog));
  mockApi.charges.mockResolvedValue(chargesPage([charge]));
});

it('shows each product with its price, usage against the plan, and what can be added', async () => {
  renderPage();
  expect(await screen.findByText('Plan Pro')).toBeInTheDocument();
  expect(screen.getByText('Active')).toBeInTheDocument();
  expect(screen.getByText('20 of 50')).toBeInTheDocument();
  expect(screen.getByText('4 · unlimited')).toBeInTheDocument();
  expect(screen.getByText(/20% off Pilloto Contabilidad/)).toBeInTheDocument();
  expect(await screen.findByText('Overdue')).toBeInTheDocument();
  expect(screen.getByText('Banco Popular 123-456')).toBeInTheDocument();
});

it('adds Accounting with a free trial at the suite price', async () => {
  mockApi.addProduct.mockResolvedValue(ok(overview()));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'See plans' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('RD$3,272.00')).toBeInTheDocument();
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Start 14-day free trial' })[1]);
  expect(within(dialog).getByText(/Nothing is charged during the 14-day trial/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(mockApi.addProduct).toHaveBeenCalledWith('accounting', 'essentials'));
});

it('upgrades at once, and will not offer a downgrade the usage does not fit', async () => {
  mockApi.changePlan.mockResolvedValue(ok({ outcome: 'upgraded', overview: overview() }));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/You have 20 active rooms; this plan allows 15/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: /Switch on/ })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade now' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(mockApi.changePlan).toHaveBeenCalledWith('pms', 'enterprise'));
  expect(await screen.findByText(/Your plan was changed/)).toBeInTheDocument();
});

it('explains a refused change in words', async () => {
  mockApi.changePlan.mockRejectedValue({ response: { data: { code: 'PLAN_DOWNGRADE_BLOCKED' } } });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade now' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  expect(await within(dialog).findByText(/usage is above the limits of that plan/)).toBeInTheDocument();
});

it('cancels at the end of the month after a confirmation', async () => {
  mockApi.cancelProduct.mockResolvedValue(ok(overview()));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText(/stays available until the end of this month/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
  await waitFor(() => expect(mockApi.cancelProduct).toHaveBeenCalledWith('pms'));
});

it('pays a charge online by going to the HandyPay page, coming back to this app', async () => {
  const assign = jest.fn();
  Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
  mockApi.pay.mockResolvedValue(ok({ url: 'https://pay.handypay.me/c/cs_1', sessionId: 'cs_1' }));
  renderPage('/accounting/subscription');
  fireEvent.click(await screen.findByRole('button', { name: 'Pay online' }));
  await waitFor(() => expect(mockApi.pay).toHaveBeenCalledWith('c1', '/accounting/subscription'));
  expect(assign).toHaveBeenCalledWith('https://pay.handypay.me/c/cs_1');
});

it('confirms the payment on the way back from HandyPay', async () => {
  mockApi.confirm.mockResolvedValue(ok({ outcome: 'recorded' }));
  renderPage('/admin/subscription?payment=success&session=cs_9');
  await waitFor(() => expect(mockApi.confirm).toHaveBeenCalledWith('cs_9'));
  expect(await screen.findByText(/Payment received/)).toBeInTheDocument();
});

describe('charges', () => {
  const many = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ ...charge, id: `c${from + i}`, number: `COB-${String(from + i).padStart(6, '0')}`, status: 'paid', balance: 0, overdue: false }));

  it('puts the billing email settings above the charges, which grow with time', async () => {
    renderPage();
    const email = await screen.findByText('Billing email');
    const charges = await screen.findByRole('heading', { name: 'Charges' });
    expect(email.compareDocumentPosition(charges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks for one page at a time and pages through the history', async () => {
    mockApi.charges.mockImplementation(async ({ page }: { page: number }) => chargesPage(many(12, (page - 1) * 12 + 1), { total: 30, pages: 3, summary: { outstanding: 0, overdueCount: 0, overdueBalance: 0 } }));
    renderPage();
    expect(await screen.findByText('COB-000001')).toBeInTheDocument();
    expect(mockApi.charges).toHaveBeenCalledWith({ page: 1, limit: 12, status: 'all', search: undefined });
    expect(screen.getByText('1–12 of 30')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(await screen.findByText('COB-000013')).toBeInTheDocument();
    expect(mockApi.charges).toHaveBeenLastCalledWith({ page: 2, limit: 12, status: 'all', search: undefined });
  });

  it('shows what is owed across all pages, so an old unpaid charge is not out of sight', async () => {
    mockApi.charges.mockResolvedValue(chargesPage(many(12), { total: 30, pages: 3, summary: { outstanding: 7000, overdueCount: 2, overdueBalance: 5000 } }));
    renderPage();
    expect(await screen.findByText(/You owe RD\$\s?7,000\.00, of which RD\$\s?5,000\.00 is overdue \(2 charges\)/)).toBeInTheDocument();
  });

  it('filters by status and goes back to the first page', async () => {
    mockApi.charges.mockImplementation(async () => chargesPage(many(12), { total: 30, pages: 3 }));
    renderPage();
    await screen.findByText('COB-000001');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(mockApi.charges).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    await waitFor(() => expect(mockApi.charges).toHaveBeenLastCalledWith({ page: 1, limit: 12, status: 'pending', search: undefined }));
  });

  it('searches after the typing pauses, and says when nothing matches', async () => {
    mockApi.charges.mockImplementation(async ({ search }: { search?: string }) => (search ? chargesPage([], { total: 0, summary: { outstanding: 0, overdueCount: 0, overdueBalance: 0 } }) : chargesPage(many(3), { summary: { outstanding: 0, overdueCount: 0, overdueBalance: 0 } })));
    renderPage();
    await screen.findByText('COB-000001');
    fireEvent.change(screen.getByLabelText('Search charges'), { target: { value: '  2031 ' } });
    await waitFor(() => expect(mockApi.charges).toHaveBeenLastCalledWith({ page: 1, limit: 12, status: 'all', search: '2031' }));
    expect(await screen.findByText('No charges match.')).toBeInTheDocument();
    // the filters stay so the search can be cleared
    expect(screen.getByLabelText('Search charges')).toBeInTheDocument();
  });

  it('offers neither filters nor a table when there are no charges at all', async () => {
    mockApi.charges.mockResolvedValue(chargesPage([], { total: 0, summary: { outstanding: 0, overdueCount: 0, overdueBalance: 0 } }));
    renderPage();
    expect(await screen.findByText('No charges yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search charges')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('can retry when the first load of the charges fails', async () => {
    mockApi.charges.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(chargesPage([charge]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('COB-000001')).toBeInTheDocument();
  });
});
