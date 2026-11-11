/**
 * Received documents and commercial approval, e-NCF ranges, the monthly report, the Fiscal Center
 * (what it says in each state, which tabs exist) and the form for document types 41–47.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, useLocation } from 'react-router-dom';
import i18n from '../../../i18n';
import { doc, fail, ok, org, readyStatus, status } from '../testFixtures';

const mockApi = {
  getStatus: jest.fn(), getAlerts: jest.fn(), getDocuments: jest.fn(), getDocument: jest.fn(),
  getReceived: jest.fn(), getReceivedOne: jest.fn(), decideReceived: jest.fn(), retryReceivedDelivery: jest.fn(), getReceivedFileBlob: jest.fn(),
  getSequences: jest.fn(), recordSequence: jest.fn(), annulSequences: jest.fn(), getMonthlyTaxReport: jest.fn(), issueOther: jest.fn(),
};
jest.mock('../../../services/api', () => ({ fiscalService: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockApi as any)[k](...a) }) }));

// react-router-dom v7 does not resolve under CRA's jest (every test in this repo mocks it); a small in-memory router is enough here.
jest.mock('react-router-dom', () => {
  const R = require('react');
  const Ctx = R.createContext(null);
  const parse = (url: string) => { const [pathname, search = ''] = url.split('?'); return { pathname, search: search ? `?${search}` : '' }; };
  return {
    MemoryRouter: ({ initialEntries, children }: any) => {
      const [loc, setLoc] = R.useState(parse(initialEntries[0]));
      return R.createElement(Ctx.Provider, { value: { loc, go: (u: string) => setLoc(parse(u)) } }, children);
    },
    useLocation: () => R.useContext(Ctx).loc,
    useNavigate: () => { const c = R.useContext(Ctx); return (to: string) => c.go(to); },
    useSearchParams: () => {
      const c = R.useContext(Ctx);
      return [new URLSearchParams(c.loc.search), (next: any) => { const q = new URLSearchParams(next).toString(); c.go(c.loc.pathname + (q ? `?${q}` : '')); }];
    },
  };
});

let mockAccess = { app: 'pms' as 'pms' | 'accounting', canView: true, canIssue: true, canManage: true };
jest.mock('../useFiscalAccess', () => ({
  useFiscalAccess: () => mockAccess,
  FISCAL_PATHS: { pms: { center: '/admin/invoices/ecf', settings: '/admin/settings/e-invoicing' }, accounting: { center: '/accounting/fiscal', settings: '/accounting/settings?tab=fiscal' } },
}));

/* eslint-disable import/first */
import FiscalCenter from '../FiscalCenter';
import FiscalOtherDocumentDialog from '../FiscalOtherDocumentDialog';
import FiscalReceivedTab from '../FiscalReceivedTab';
import FiscalSequencesTab from '../FiscalSequencesTab';
import FiscalTaxReportTab from '../FiscalTaxReportTab';
import { resetFiscalStatusCache } from '../useFiscalStatus';
/* eslint-enable import/first */

const page = (rows: unknown[], total = rows.length) => ok(rows, { meta: { total, page: 1, limit: 25, pages: 1 } });
const received = (over = {}) => ({ id: 'r1', type: '31', encf: 'E310000000555', issuerRnc: '101000002', issuerName: 'Suplidora del Caribe SRL', issuedOn: '2026-11-05', total: '2360.00', receivedAt: '2026-11-05T14:00:00Z', decision: null, ...over });
const receivedDetail = (over = {}) => ({ ...received(), itbisTotal: '360.00', securityCode: 'ABC123', fileName: 'x.xml', approval: null, deliveries: [], ...over });

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  jest.clearAllMocks();
  resetFiscalStatusCache();
  mockAccess = { app: 'pms', canView: true, canIssue: true, canManage: true };
  mockApi.getStatus.mockImplementation(() => ok(readyStatus()));
  mockApi.getAlerts.mockImplementation(() => ok([]));
  mockApi.getDocuments.mockImplementation(() => page([doc()]));
  mockApi.getReceived.mockImplementation(() => page([]));
});

// ── Received documents ──────────────────────────────────────────────────────

describe('received documents', () => {
  it('starts on what is waiting for a decision, and says so when nothing is', async () => {
    render(<FiscalReceivedTab canDecide />);
    expect(await screen.findByText('Nothing is waiting for your decision.')).toBeInTheDocument();
    expect(mockApi.getReceived).toHaveBeenCalledWith(expect.objectContaining({ filter: 'undecided' }));
  });

  it('lists what other companies sent, reports the pending count, and opens one', async () => {
    mockApi.getReceived.mockImplementation(() => page([received(), received({ id: 'r2', encf: 'E310000000556', decision: 'approved' })], 2));
    mockApi.getReceivedOne.mockImplementation(() => ok(receivedDetail()));
    const onPending = jest.fn();
    render(<FiscalReceivedTab canDecide onPendingCount={onPending} />);
    expect((await screen.findAllByText('Suplidora del Caribe SRL')).length).toBe(2);
    expect(onPending).toHaveBeenCalledWith(2);
    const table = screen.getByRole('table', { name: 'Received documents' });
    expect(within(table).getByText('Pending')).toBeInTheDocument();
    expect(within(table).getByText('Approved')).toBeInTheDocument();
    fireEvent.click(screen.getByText('E310000000555'));
    const dialog = await screen.findByRole('dialog', { name: 'Received document' });
    expect(within(dialog).getByText('RD$2,360.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/signed with your certificate and sent to DGII and to the issuer/)).toBeInTheDocument();
  });

  it('approves once, with a signed decision', async () => {
    mockApi.getReceived.mockImplementation(() => page([received()]));
    mockApi.getReceivedOne.mockImplementation(() => ok(receivedDetail()));
    mockApi.decideReceived.mockImplementation(() => ok(receivedDetail({ decision: 'approved', approval: { decision: 'approved', decidedAt: '2026-11-10T12:00:00Z', decidedBy: 'Carla' }, deliveries: [{ target: 'dgii', status: 'delivered', attempts: 1, messages: [] }, { target: 'issuer', status: 'pending', attempts: 1, messages: [] }] })));
    render(<FiscalReceivedTab canDecide />);
    fireEvent.click(await screen.findByText('E310000000555'));
    const dialog = await screen.findByRole('dialog', { name: 'Received document' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mockApi.decideReceived).toHaveBeenCalledWith('r1', 'approved', undefined));
    expect(await within(dialog).findByText('Approved by Carla')).toBeInTheDocument();
    // where the decision went
    expect(within(dialog).getByText('Delivered')).toBeInTheDocument();
    expect(within(dialog).getByText('Sending')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument(); // it can be done once
  });

  it('a rejection must give its reason', async () => {
    mockApi.getReceived.mockImplementation(() => page([received()]));
    mockApi.getReceivedOne.mockImplementation(() => ok(receivedDetail()));
    mockApi.decideReceived.mockImplementation(() => ok(receivedDetail({ decision: 'rejected', approval: { decision: 'rejected', reason: 'Mercancía no recibida', decidedAt: '2026-11-10T12:00:00Z', decidedBy: 'Carla' } })));
    render(<FiscalReceivedTab canDecide />);
    fireEvent.click(await screen.findByText('E310000000555'));
    const dialog = await screen.findByRole('dialog', { name: 'Received document' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    const confirm = within(dialog).getByRole('button', { name: 'Confirm rejection' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason for rejecting/), { target: { value: 'Mercancía no recibida' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockApi.decideReceived).toHaveBeenCalledWith('r1', 'rejected', 'Mercancía no recibida'));
    expect(await within(dialog).findByText('“Mercancía no recibida”')).toBeInTheDocument();
  });

  it('a failed delivery can be tried again', async () => {
    mockApi.getReceived.mockImplementation(() => page([received({ decision: 'approved' })]));
    mockApi.getReceivedOne.mockImplementation(() => ok(receivedDetail({ decision: 'approved', approval: { decision: 'approved', decidedAt: '2026-11-10T12:00:00Z', decidedBy: 'Carla' }, deliveries: [{ target: 'issuer', status: 'failed', attempts: 12, messages: ['timeout'] }] })));
    mockApi.retryReceivedDelivery.mockImplementation(() => ok(receivedDetail({ decision: 'approved', approval: { decision: 'approved', decidedAt: '2026-11-10T12:00:00Z', decidedBy: 'Carla' }, deliveries: [{ target: 'issuer', status: 'pending', attempts: 13, messages: [] }] })));
    render(<FiscalReceivedTab canDecide />);
    fireEvent.click(await screen.findByText('E310000000555'));
    const dialog = await screen.findByRole('dialog', { name: 'Received document' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockApi.retryReceivedDelivery).toHaveBeenCalledWith('r1', 'issuer'));
    expect(await within(dialog).findByText('Sending')).toBeInTheDocument();
  });

  it('someone who cannot decide can read but not approve or reject', async () => {
    mockApi.getReceived.mockImplementation(() => page([received()]));
    mockApi.getReceivedOne.mockImplementation(() => ok(receivedDetail()));
    render(<FiscalReceivedTab canDecide={false} />);
    fireEvent.click(await screen.findByText('E310000000555'));
    const dialog = await screen.findByRole('dialog', { name: 'Received document' });
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('shows why a decision failed (it was already taken)', async () => {
    mockApi.getReceived.mockImplementation(() => page([received()]));
    mockApi.getReceivedOne.mockImplementation(() => ok(receivedDetail()));
    mockApi.decideReceived.mockImplementation(() => fail('FISCAL_CONFLICT'));
    render(<FiscalReceivedTab canDecide />);
    fireEvent.click(await screen.findByText('E310000000555'));
    const dialog = await screen.findByRole('dialog', { name: 'Received document' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByText(/conflicts with an existing document/)).toBeInTheDocument();
  });
});

// ── Sequences ───────────────────────────────────────────────────────────────

describe('e-NCF ranges', () => {
  const seq = (over = {}) => ({ id: 's1', documentType: '32', rangeStart: 1, rangeEnd: 1000, next: 100, remaining: 901, usable: true, ...over });

  it('lists ranges with what is left, and flags one running low', async () => {
    mockApi.getSequences.mockImplementation(() => ok([seq(), seq({ id: 's2', documentType: '31', next: 960, remaining: 41, expiresOn: '2027-12-31' }), seq({ id: 's3', documentType: '34', next: 1001, remaining: 0, usable: false })]));
    render(<FiscalSequencesTab canManage />);
    const table = await screen.findByRole('table', { name: 'e-NCF ranges' });
    expect(await within(table).findByText('Consumer invoice (32)')).toBeInTheDocument();
    expect(within(table).getByText('Running low')).toBeInTheDocument();
    expect(within(table).getByText('Used up')).toBeInTheDocument();
    expect(within(table).getByText('Usable')).toBeInTheDocument();
    expect(within(table).getAllByText('Does not expire')).toHaveLength(2); // 32 and 34 never expire
  });

  it('says that without a range nothing can be numbered', async () => {
    mockApi.getSequences.mockImplementation(() => ok([]));
    render(<FiscalSequencesTab canManage />);
    expect(await screen.findByText(/Without one, no e-CF can be numbered/)).toBeInTheDocument();
  });

  it('records a range; types that expire need their last valid day, 32 and 34 never do', async () => {
    mockApi.getSequences.mockImplementation(() => ok([]));
    mockApi.recordSequence.mockImplementation(() => ok(seq()));
    render(<FiscalSequencesTab canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record a range' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '500' } });
    // 32 (the default) does not expire
    expect(within(dialog).getByText('Ranges for this type do not expire.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Record' })).toBeEnabled();
    fireEvent.mouseDown(within(dialog).getByLabelText('Type'));
    fireEvent.click(await screen.findByRole('option', { name: 'Credit-fiscal invoice (31)' }));
    const record = within(dialog).getByRole('button', { name: 'Record' });
    expect(record).toBeDisabled(); // needs its last valid day
    fireEvent.change(within(dialog).getByLabelText(/Last valid day/), { target: { value: '2027-12-31' } });
    expect(record).toBeEnabled();
    fireEvent.click(record);
    await waitFor(() => expect(mockApi.recordSequence).toHaveBeenCalledWith({ documentType: '31', rangeStart: 1, rangeEnd: 500, expiresOn: '2027-12-31' }));
  });

  it('tells a company moving over from another provider to record only the unused part', async () => {
    mockApi.getSequences.mockImplementation(() => ok([]));
    render(<FiscalSequencesTab canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record a range' }));
    expect(await screen.findByText(/Record only the part still unused, starting from the next number/)).toBeInTheDocument();
  });

  it('refuses an end before the start without calling the server', async () => {
    mockApi.getSequences.mockImplementation(() => ok([]));
    render(<FiscalSequencesTab canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record a range' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '500' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '10' } });
    expect(within(dialog).getByRole('button', { name: 'Record' })).toBeDisabled();
  });

  it('cancels unused numbers after a clear warning', async () => {
    mockApi.getSequences.mockImplementation(() => ok([]));
    mockApi.annulSequences.mockImplementation(() => ok({ count: 11, outcome: 'confirmed', fileName: 'ANECF.xml' }));
    render(<FiscalSequencesTab canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel unused numbers' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/It cannot be undone/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '90' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '100' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel these numbers' }));
    await waitFor(() => expect(mockApi.annulSequences).toHaveBeenCalledWith([{ documentType: '32', from: 90, to: 100 }]));
    expect(await within(dialog).findByText('11 numbers cancelled with DGII.')).toBeInTheDocument();
  });

  it('someone who cannot manage can read the ranges but not change them', async () => {
    mockApi.getSequences.mockImplementation(() => ok([seq()]));
    render(<FiscalSequencesTab canManage={false} />);
    await screen.findByText('Consumer invoice (32)');
    expect(screen.queryByRole('button', { name: 'Record a range' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel unused numbers' })).not.toBeInTheDocument();
  });
});

// ── Monthly report ──────────────────────────────────────────────────────────

describe('monthly tax report', () => {
  it('shows accepted documents by month and type, with a year total', async () => {
    mockApi.getMonthlyTaxReport.mockImplementation(() => ok([
      { year: 2026, month: 11, byTipo: [{ tipo: 'E32', totalFactura: 354, totalImpuestos: 54, count: 2 }, { tipo: 'E31', totalFactura: 118, totalImpuestos: 18, count: 1 }], totalFactura: 472, totalImpuestos: 72, totalInvoices: 3 },
      { year: 2026, month: 10, byTipo: [{ tipo: 'E32', totalFactura: 1180, totalImpuestos: 180, count: 4 }], totalFactura: 1180, totalImpuestos: 180, totalInvoices: 4 },
    ]));
    render(<FiscalTaxReportTab />);
    const table = await screen.findByRole('table', { name: 'Monthly totals' });
    expect(await within(table).findByText('November 2026')).toBeInTheDocument();
    expect(within(table).getByText('E32: 2 · E31: 1')).toBeInTheDocument();
    expect(within(table).getByText('RD$1,652.00')).toBeInTheDocument(); // 472 + 1,180
    expect(within(table).getByText('RD$252.00')).toBeInTheDocument(); // ITBIS 72 + 180
  });

  it('says when there is nothing to report', async () => {
    mockApi.getMonthlyTaxReport.mockImplementation(() => ok([]));
    render(<FiscalTaxReportTab />);
    expect(await screen.findByText('No accepted documents this year.')).toBeInTheDocument();
  });
});

// ── The Fiscal Center ───────────────────────────────────────────────────────

const Where: React.FC = () => { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; };
const center = (url = '/admin/invoices/ecf') => render(
  <MemoryRouter initialEntries={[url]}>
    <FiscalCenter />
    <Where />
  </MemoryRouter>,
);

describe('Fiscal Center', () => {
  it('says what is going on in each state, and where to go', async () => {
    mockApi.getStatus.mockImplementation(() => ok(status()));
    center();
    expect(await screen.findByText('Electronic invoicing is not activated for this company yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/settings/e-invoicing');
  });

  it('only a manager is sent to set it up; others are told who to ask', async () => {
    mockAccess = { ...mockAccess, canManage: false };
    mockApi.getStatus.mockImplementation(() => ok(status()));
    center();
    expect(await screen.findByText(/Ask an administrator to set it up/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up' })).not.toBeInTheDocument();
  });

  it('while being certified, says fiscal e-CF cannot be issued yet', async () => {
    mockApi.getStatus.mockImplementation(() => ok(status({ state: 'in_progress', organization: org({ certification: 'in_progress' }) })));
    center();
    expect(await screen.findByText(/DGII has not certified this company yet, so fiscal e-CF cannot be issued/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other document' })).toBeDisabled();
  });

  it('on a development server, warns that what it issues before certification has no fiscal value', async () => {
    mockApi.getStatus.mockImplementation(() => ok(status({ state: 'not_started', canIssue: true, allowUncertified: true, organization: org() })));
    center();
    expect(await screen.findByText(/development only\): these documents have no fiscal value/)).toBeInTheDocument();
  });

  it('shows the four tabs once the company is set up, with the pending approvals counted', async () => {
    mockApi.getReceived.mockImplementation((p: { filter?: string }) => page(p.filter === 'undecided' ? [received(), received({ id: 'r2' })] : []));
    center();
    expect(await screen.findByRole('tab', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sequences' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tax report' })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /Received/ })).toHaveTextContent('2');
  });

  it('a company that has not activated has no received/sequences tabs to fail on', async () => {
    mockApi.getStatus.mockImplementation(() => ok(status()));
    center('/admin/invoices/ecf?tab=sequences');
    await screen.findByText('Electronic invoicing is not activated for this company yet.');
    expect(screen.queryByRole('tab', { name: 'Sequences' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Received' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'true'); // falls back
  });

  it('keeps the open tab in the address so any view can be linked to', async () => {
    mockApi.getSequences.mockImplementation(() => ok([]));
    center();
    fireEvent.click(await screen.findByRole('tab', { name: 'Sequences' }));
    expect(screen.getByTestId('where')).toHaveTextContent('tab=sequences');
    expect(await screen.findByText(/Without one, no e-CF can be numbered/)).toBeInTheDocument();
  });

  it('shows what needs attention at the top', async () => {
    mockApi.getAlerts.mockImplementation(() => ok([{ type: 'rejected', severity: 'error', count: 2 }, { type: 'queued', severity: 'warning', count: 1 }, { type: 'certification_in_progress', severity: 'info' }]));
    center();
    expect(await screen.findByText('2 e-CF rejected by DGII in the last 30 days.')).toBeInTheDocument();
    expect(screen.getByText(/1 e-CF waiting to be sent to BillingSoft/)).toBeInTheDocument();
    expect(screen.queryByText(/certification is in progress/)).not.toBeInTheDocument(); // information lives in Settings
  });

  it('refuses someone with no access instead of showing an empty page', async () => {
    mockAccess = { ...mockAccess, canView: false };
    center();
    expect(await screen.findByText('You do not have access to electronic invoices.')).toBeInTheDocument();
  });

  it('works the same inside Accounting', async () => {
    mockAccess = { app: 'accounting', canView: true, canIssue: true, canManage: true };
    mockApi.getStatus.mockImplementation(() => ok(status()));
    center('/accounting/fiscal');
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/accounting/settings?tab=fiscal');
  });
});

// ── Other document types ────────────────────────────────────────────────────

describe('other document types (41–47)', () => {
  const open = (onIssued = jest.fn()) => {
    render(<FiscalOtherDocumentDialog open onClose={jest.fn()} onIssued={onIssued} />);
    return onIssued;
  };
  const pickType = async (name: string) => {
    fireEvent.mouseDown(screen.getByLabelText('Type'));
    fireEvent.click(await screen.findByRole('option', { name }));
  };

  it('a minor expense (43) has no counterparty and only exempt items', () => {
    open();
    expect(screen.queryByText('Counterparty')).not.toBeInTheDocument();
    expect(screen.getByText(/Small expenses paid by staff/)).toBeInTheDocument();
    expect(screen.getByLabelText('ITBIS')).toHaveAttribute('aria-disabled', 'true'); // exempt is the only choice
  });

  it('issues a minor expense with the lines as typed', async () => {
    mockApi.issueOther.mockImplementation(() => ok(doc({ tipo: 'E43', eNCF: 'E430000000001', totalFactura: 200, estadoECF: 'En Proceso' }), { queued: false }));
    const onIssued = open();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Peaje' } });
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '100' } });
    expect(screen.getByText('RD$200.00')).toBeInTheDocument(); // the total, computed as DGII does
    fireEvent.click(screen.getByRole('button', { name: 'Issue document' }));
    await waitFor(() => expect(mockApi.issueOther).toHaveBeenCalledTimes(1));
    expect(mockApi.issueOther).toHaveBeenCalledWith({
      type: '43', payment: { type: 'cash' },
      lines: [{ name: 'Peaje', kind: 'service', quantity: '2', unitPrice: '100', tax: 'exempt' }],
    });
    expect(await screen.findByText('The document was issued and sent to DGII.')).toBeInTheDocument();
    expect(screen.getByText('E430000000001')).toBeInTheDocument();
    expect(onIssued).toHaveBeenCalled();
  });

  it('lets an item be a good or a service where the type admits both', async () => {
    mockApi.issueOther.mockImplementation(() => ok(doc({ tipo: 'E43' })));
    open();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Combustible' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '800' } });
    fireEvent.mouseDown(screen.getByLabelText('Kind'));
    fireEvent.click(await screen.findByRole('option', { name: 'Good' }));
    fireEvent.click(screen.getByRole('button', { name: 'Issue document' }));
    await waitFor(() => expect(mockApi.issueOther).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ kind: 'good' })] })));
  });

  it('a purchase (41) needs the seller\'s RNC and says what is withheld on each item', async () => {
    open();
    await pickType('Purchases (41)');
    expect(screen.getByText('Seller')).toBeInTheDocument();
    expect(screen.getByLabelText('ITBIS withheld')).toBeInTheDocument();
    expect(screen.getByLabelText('ISR withheld')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Verduras' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '500' } });
    const issue = screen.getByRole('button', { name: 'Issue document' });
    expect(issue).toBeDisabled(); // no seller yet
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Don Pedro' } });
    expect(issue).toBeDisabled(); // a purchase's seller needs an RNC
    fireEvent.change(screen.getByLabelText('RNC'), { target: { value: '101000002' } });
    expect(issue).toBeEnabled();
  });

  it('a payment abroad (47) withholds income tax, takes services only, and the foreigner is optional', async () => {
    mockApi.issueOther.mockImplementation(() => ok(doc({ tipo: 'E47' })));
    open();
    await pickType('Payments abroad (47)');
    expect(screen.getByText(/optional/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Kind')).not.toBeInTheDocument(); // services only: nothing to choose
    expect(screen.getByLabelText('ISR withheld')).toBeInTheDocument();
    expect(screen.queryByLabelText('ITBIS withheld')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Licencia de software' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('ISR withheld'), { target: { value: '270' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue document' }));
    await waitFor(() => expect(mockApi.issueOther).toHaveBeenCalledWith(expect.objectContaining({
      type: '47', lines: [expect.objectContaining({ kind: 'service', tax: 'exempt', withholding: { isr: '270' } })],
    })));
  });

  it('government sales (45) must state the type of income', async () => {
    mockApi.issueOther.mockImplementation(() => ok(doc({ tipo: 'E45' })));
    open();
    await pickType('Government (45)');
    expect(screen.getByLabelText('Type of income')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ministerio de Turismo' } });
    fireEvent.change(screen.getByLabelText('RNC'), { target: { value: '401000001' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Alojamiento' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue document' }));
    await waitFor(() => expect(mockApi.issueOther).toHaveBeenCalledWith(expect.objectContaining({ type: '45', incomeType: '01', buyer: { name: 'Ministerio de Turismo', rnc: '401000001' } })));
  });

  it('a credit sale needs its due date', async () => {
    open();
    await pickType('Government (45)');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ministerio' } });
    fireEvent.change(screen.getByLabelText('RNC'), { target: { value: '401000001' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '10' } });
    fireEvent.mouseDown(screen.getByLabelText('Payment'));
    fireEvent.click(await screen.findByRole('option', { name: 'Credit' }));
    const issue = screen.getByRole('button', { name: 'Issue document' });
    expect(issue).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Due on/), { target: { value: '2026-12-30' } });
    expect(issue).toBeEnabled();
  });

  it('shows BillingSoft\'s reason when it refuses, on the field it names', async () => {
    mockApi.issueOther.mockImplementation(() => fail('FISCAL_REJECTED', 'Revise los datos', { 'buyer.name': 'Nombre demasiado largo' }));
    open();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Peaje' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue document' }));
    expect(await screen.findByText('Revise los datos')).toBeInTheDocument();
  });

  it('items can be added and removed, but never down to none', () => {
    open();
    expect(screen.getByRole('button', { name: 'Remove item' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getAllByLabelText('Description')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove item' })[0]);
    expect(screen.getAllByLabelText('Description')).toHaveLength(1);
  });
});
