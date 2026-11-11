/**
 * The settings panel across the company's lifecycle: not activated, being certified, ready,
 * suspended — plus the activation form's validation and changing plan.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../i18n';
import { fail, LINKS, ok, org, plans, readyStatus, status } from '../testFixtures';

const mockApi = {
  getStatus: jest.fn(), sync: jest.fn(), activate: jest.fn(), getPlans: jest.fn(), changePlan: jest.fn(),
  getReadiness: jest.fn(), getUsage: jest.fn(), getStatements: jest.fn(),
};
jest.mock('../../../services/api', () => ({ fiscalService: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockApi as any)[k](...a) }) }));

/* eslint-disable import/first */
import FiscalSettingsPanel from '../FiscalSettingsPanel';
import { resetFiscalStatusCache } from '../useFiscalStatus';
/* eslint-enable import/first */

const usage = (over = {}) => ({
  currency: 'DOP', period: { start: '2026-11-01T04:00:00Z', end: '2026-12-01T04:00:00Z' }, plan: 'essential', includedPlan: 'essential',
  transactions: { included: 300, used: 120, extra: 0 }, overageUnitPrice: 4.75, overageAmount: 0, planCharge: 0, total: 0, users: { used: 1, limit: 1 }, ...over,
});
const readiness = (over = {}) => ({
  environment: 'testecf', certification: 'not_started', complete: false, certificate: 'none', usableTypes: [], organization: null,
  steps: [{ step: 'profile', done: true }, { step: 'certificate', done: false }, { step: 'sequences', done: false }, { step: 'directory', done: false }, { step: 'first_document', done: false }], ...over,
});

const show = (props: React.ComponentProps<typeof FiscalSettingsPanel> = {}) => render(<FiscalSettingsPanel {...props} />);

/** The server answers /status and /sync with the same company state. */
const serve = (s: ReturnType<typeof status>) => {
  mockApi.getStatus.mockImplementation(() => ok(s));
  mockApi.sync.mockImplementation(() => ok(s));
};

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  jest.clearAllMocks();
  resetFiscalStatusCache();
  mockApi.getPlans.mockImplementation(() => ok(plans()));
  mockApi.getUsage.mockImplementation(() => ok(usage()));
  mockApi.getStatements.mockImplementation(() => ok([]));
  mockApi.getReadiness.mockImplementation(() => ok(readiness()));
  mockApi.sync.mockImplementation(() => ok(status()));
});

describe('not activated', () => {
  beforeEach(() => serve(status()));

  it('offers to activate, starting from the company profile and the owner', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Activate electronic invoicing' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^RNC/)).toHaveValue('131880681');
    expect(screen.getByLabelText(/^Legal name/)).toHaveValue('Hotel Prueba SRL');
    expect(screen.getByLabelText(/^Address/)).toHaveValue('Av. Principal 1, Sosúa');
    expect(screen.getByLabelText(/^Email/)).toHaveValue('dueno@hotel.test');
    expect(screen.getByText('Not activated')).toBeInTheDocument();
    // it is honest that nothing fiscal is issued before DGII certifies
    expect(screen.getByText(/until DGII certifies you, Pilloto will not issue fiscal invoices/)).toBeInTheDocument();
  });

  it('shows the plans with what this company pays: its included plan costs nothing', async () => {
    show();
    const essential = await screen.findByRole('radio', { name: 'Essential' });
    expect(essential).toBeChecked();
    expect(screen.getByText('Included in your Pilloto plan')).toBeInTheDocument();
    expect(screen.getByText('RD$325.00 / month')).toBeInTheDocument(); // Pro, less what is included
    expect(screen.getByText('RD$1,025.00 / month')).toBeInTheDocument();
  });

  it('will not submit an incomplete form, and says what is missing without calling the server', async () => {
    show();
    await screen.findByRole('radio', { name: 'Essential' });
    fireEvent.click(screen.getByRole('button', { name: 'Activate electronic invoicing' }));
    expect(await screen.findByText('You need to confirm this to continue.')).toBeInTheDocument();
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0); // administrator name
    expect(mockApi.activate).not.toHaveBeenCalled();
  });

  it('rejects a malformed RNC and email before asking the server', async () => {
    show();
    await screen.findByRole('radio', { name: 'Essential' });
    fireEvent.change(screen.getByLabelText(/^RNC/), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate electronic invoicing' }));
    expect(await screen.findByText('Enter a valid RNC (9 digits) or cédula (11).')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email.')).toBeInTheDocument();
    expect(mockApi.activate).not.toHaveBeenCalled();
  });

  it('activates with the confirmation, cleaned values and the chosen plan', async () => {
    mockApi.activate.mockImplementation(() => ok(status({ state: 'not_started', organization: org() })));
    show();
    await screen.findByRole('radio', { name: 'Essential' });
    fireEvent.change(screen.getByLabelText(/^RNC/), { target: { value: '1-31-88068-1' } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '  Carla Pérez ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Pro' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Activate electronic invoicing' }));
    await waitFor(() => expect(mockApi.activate).toHaveBeenCalledTimes(1));
    expect(mockApi.activate).toHaveBeenCalledWith({
      plan: 'pro', rnc: '131880681', razonSocial: 'Hotel Prueba SRL', address: 'Av. Principal 1, Sosúa',
      admin: { name: 'Carla Pérez', email: 'dueno@hotel.test' }, confirmPreviousPostulationConcluded: true,
    });
    // the panel moves on to the setup progress
    expect(await screen.findByRole('heading', { name: 'Getting ready to issue' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Activate electronic invoicing' })).not.toBeInTheDocument();
  });

  it('shows the server\'s reason next to the field it is about', async () => {
    mockApi.activate.mockImplementation(() => fail('FISCAL_REJECTED', 'Review the highlighted fields', { rnc: 'RNC inválido' }));
    show();
    await screen.findByRole('radio', { name: 'Essential' });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Carla' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Activate electronic invoicing' }));
    expect(await screen.findByText('RNC inválido')).toBeInTheDocument();
    expect(screen.getByText('Review the highlighted fields')).toBeInTheDocument();
  });

  it('explains when the RNC already belongs to another account', async () => {
    mockApi.activate.mockImplementation(() => fail('FISCAL_RNC_IN_USE'));
    show();
    await screen.findByRole('radio', { name: 'Essential' });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Carla' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Activate electronic invoicing' }));
    expect(await screen.findByText('Another account already uses this RNC. Contact support.')).toBeInTheDocument();
  });

  it('says so when the server has no BillingSoft credential, and does not let anyone try', async () => {
    serve(status({ configured: false }));
    show();
    expect(await screen.findByText(/not available on this server yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate electronic invoicing' })).toBeDisabled();
  });
});

describe('being certified', () => {
  it('shows the steps only the company can do, linking straight to BillingSoft', async () => {
    serve(status({ state: 'not_started', organization: org() }));
    show();
    expect(await screen.findByRole('heading', { name: 'Getting ready to issue' })).toBeInTheDocument();
    expect(screen.getByText('Awaiting certification')).toBeInTheDocument();
    expect(screen.getByText('We invited carla@hotel.test to set a password and finish the steps below.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the certification wizard/ })).toHaveAttribute('href', LINKS.certification);
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Open BillingSoft/ })[0]).toHaveAttribute('href', LINKS.certificate));
    expect(screen.getByText(/never through Pilloto/)).toBeInTheDocument();
    expect(screen.getByText(/Pilloto does not issue fiscal invoices/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Activate electronic invoicing' })).not.toBeInTheDocument();
  });

  it('reflects progress as DGII\'s certification runs', async () => {
    serve(status({ state: 'in_progress', organization: org({ certification: 'in_progress', environment: 'certecf' }) }));
    mockApi.getReadiness.mockImplementation(() => ok(readiness({ certificate: 'valid', steps: [{ step: 'profile', done: true }, { step: 'certificate', done: true }, { step: 'sequences', done: false }, { step: 'directory', done: false }, { step: 'first_document', done: false }] })));
    show();
    expect(await screen.findByText('Being certified')).toBeInTheDocument();
    expect(screen.getByText('Certification environment')).toBeInTheDocument();
    expect(await screen.findByText(/In progress\. DGII’s tests run in BillingSoft/)).toBeInTheDocument();
    // account created and certificate uploaded; certification is still running, so it is not counted yet
    await waitFor(() => expect(screen.getByText('2 of 6')).toBeInTheDocument());
  });

  it('offers to record e-NCF ranges inside Pilloto', async () => {
    const onNavigate = jest.fn();
    serve(status({ state: 'in_progress', organization: org({ certification: 'in_progress' }) }));
    show({ sequencesPath: '/admin/invoices/ecf?tab=sequences', onNavigate });
    const button = await screen.findByRole('button', { name: 'Record ranges' });
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith('/admin/invoices/ecf?tab=sequences');
  });

  it('warns when the certificate is expiring or expired', async () => {
    serve(status({ state: 'in_progress', organization: org({ certification: 'in_progress' }) }));
    mockApi.getReadiness.mockImplementation(() => ok(readiness({ certificate: 'expired' })));
    show();
    expect(await screen.findByText('It expired. Upload a new one in BillingSoft.')).toBeInTheDocument();
  });

  it('keeps working when BillingSoft cannot be asked: shows a warning, not a blank', async () => {
    serve(status({ state: 'not_started', organization: org() }));
    mockApi.getReadiness.mockImplementation(() => fail('BILLINGSOFT_UNREACHABLE'));
    show();
    expect(await screen.findByText('The invoicing service did not answer. Try again in a moment.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Getting ready to issue' })).toBeInTheDocument();
  });
});

describe('ready, plan and charges', () => {
  beforeEach(() => serve(readyStatus()));

  it('confirms DGII certified the company and hides the setup checklist', async () => {
    show();
    expect(await screen.findByText(/DGII certified your company\. Invoices issued from PMS or Accounting are fiscal e-CF\./)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Getting ready to issue' })).not.toBeInTheDocument();
  });

  it('shows the plan and what the company pays for it', async () => {
    show();
    const card = (await screen.findByRole('heading', { name: 'Plan' })).closest('div')!.parentElement!;
    expect(await within(card).findByText(/300 documents per month/)).toBeInTheDocument();
    expect(within(card).getByText(/Your Pilloto plan includes the Essential plan\./)).toBeInTheDocument();
    expect(within(card).getByText(/There is no extra charge\./)).toBeInTheDocument();
  });

  it('shows this month\'s usage against the allowance, with no alarm while within it', async () => {
    show();
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('of 300 included')).toBeInTheDocument();
    expect(screen.getByText(/180 left\. After that, RD\$4\.75 each\./)).toBeInTheDocument();
    expect(screen.getByText('No charge')).toBeInTheDocument();
  });

  it('says plainly what going over costs, before the statement arrives', async () => {
    mockApi.getUsage.mockImplementation(() => ok(usage({ transactions: { included: 300, used: 350, extra: 50 }, overageAmount: 237.5, total: 237.5 })));
    show();
    expect(await screen.findByText('50 documents beyond your allowance, RD$4.75 each: RD$237.50 so far.')).toBeInTheDocument();
    expect(screen.getByText('RD$237.50', { selector: '.MuiChip-label' })).toBeInTheDocument();
  });

  it('lists past statements with their state', async () => {
    mockApi.getStatements.mockImplementation(() => ok([
      { _id: 's1', period: '2026-10', status: 'closed', plan: 'pro', planPrice: 800, includedPlanPrice: 475, planCharge: 325, transactions: { included: 1000, used: 1100, extra: 100 }, overageUnitPrice: 2.4, overageAmount: 240, total: 565, planChanges: [{ from: 'essential', to: 'pro', at: '2026-10-12T10:00:00Z' }] },
      { _id: 's2', period: '2026-09', status: 'paid', plan: 'essential', planPrice: 475, includedPlanPrice: 475, planCharge: 0, transactions: { included: 300, used: 20, extra: 0 }, overageUnitPrice: 4.75, overageAmount: 0, total: 0, planChanges: [] },
    ]));
    show();
    const table = await screen.findByRole('table', { name: 'Statements' });
    expect(within(table).getByText('October 2026')).toBeInTheDocument();
    expect(within(table).getByText('RD$565.00')).toBeInTheDocument();
    expect(within(table).getByText('Closed')).toBeInTheDocument();
    expect(within(table).getByText('Paid')).toBeInTheDocument();
    expect(within(table).getByText('changed')).toBeInTheDocument();
  });

  it('is calm about having no statements yet', async () => {
    show();
    expect(await screen.findByText(/No statements yet/)).toBeInTheDocument();
  });

  it('shows a suspended company as such, with no way to issue', async () => {
    serve(status({ state: 'suspended', organization: org({ isActive: false }) }));
    show();
    expect(await screen.findAllByText(/suspended for your company/)).not.toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Getting ready to issue' })).not.toBeInTheDocument();
  });
});

describe('changing plan', () => {
  beforeEach(() => serve(readyStatus()));

  const openDialog = async () => {
    show();
    const change = await screen.findByRole('button', { name: 'Change plan' });
    await waitFor(() => expect(change).toBeEnabled()); // plans have loaded
    fireEvent.click(change);
    return screen.findByRole('dialog');
  };

  it('an upgrade says it applies at once and the difference is charged', async () => {
    mockApi.changePlan.mockImplementation(() => Promise.resolve({ data: { success: true, outcome: 'applied', data: readyStatus({ organization: org({ plan: 'max', environment: 'ecf', certification: 'certified' }) }) } }));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Max' }));
    expect(within(dialog).getByText(/takes effect immediately, and the difference is charged/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockApi.changePlan).toHaveBeenCalledWith('max'));
    expect(await screen.findByText('Plan changed. It applies from now.')).toBeInTheDocument();
  });

  it('a downgrade says it waits for the 1st, and the confirmation says when', async () => {
    serve(readyStatus({ organization: org({ plan: 'max', environment: 'ecf', certification: 'certified' }) }));
    mockApi.getPlans.mockImplementation(() => ok(plans({ currentPlan: 'max', plans: plans().plans.map((p) => ({ ...p, change: p.id === 'max' ? 0 : -1 })) as any })));
    mockApi.changePlan.mockImplementation(() => Promise.resolve({ data: { success: true, outcome: 'scheduled', data: readyStatus() } }));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Pro' }));
    expect(within(dialog).getByText(/takes effect on the 1st of next month/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Done. The new plan applies on the 1st of next month.')).toBeInTheDocument();
  });

  it('cannot choose a plan below the one the Pilloto plan includes', async () => {
    mockApi.getPlans.mockImplementation(() => ok(plans({ includedPlan: 'pro', currentPlan: 'pro', plans: [
      { id: 'essential', users: 1, transactions: 300, monthlyPrice: 475, monthlyCharge: 0, overageUnitPrice: 4.75, selectable: false, included: false, change: -1 },
      { id: 'pro', users: 3, transactions: 1000, monthlyPrice: 800, monthlyCharge: 0, overageUnitPrice: 2.4, selectable: true, included: true, change: 0 },
      { id: 'max', users: 5, transactions: 3000, monthlyPrice: 1500, monthlyCharge: 700, overageUnitPrice: 1.5, selectable: true, included: false, change: 1 },
    ] })));
    const dialog = await openDialog();
    expect(within(dialog).getByRole('radio', { name: 'Essential' })).toBeDisabled();
    expect(within(dialog).getByText('Below your included plan')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled(); // nothing changed
  });

  it('shows a scheduled change, and choosing the current plan cancels it', async () => {
    const pending = { plan: 'pro' as const, effectiveOn: '2026-12-01' };
    serve(readyStatus({ organization: org({ plan: 'max', environment: 'ecf', certification: 'certified', pendingPlan: pending }) }));
    mockApi.getPlans.mockImplementation(() => ok(plans({ currentPlan: 'max', pendingPlan: pending, plans: plans().plans.map((p) => ({ ...p, change: p.id === 'max' ? 0 : -1 })) as any })));
    mockApi.changePlan.mockImplementation(() => Promise.resolve({ data: { success: true, outcome: 'cancelled', data: readyStatus() } }));
    show();
    expect(await screen.findByText('Changing to the Pro plan on December 1.')).toBeInTheDocument();
    const change = screen.getByRole('button', { name: 'Change plan' });
    await waitFor(() => expect(change).toBeEnabled());
    fireEvent.click(change);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cancels the scheduled change/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel the change' }));
    await waitFor(() => expect(mockApi.changePlan).toHaveBeenCalledWith('max'));
    expect(await screen.findByText('The scheduled change was cancelled.')).toBeInTheDocument();
  });

  it('keeps the dialog open and explains when the change is refused', async () => {
    mockApi.changePlan.mockImplementation(() => fail('BILLINGSOFT_UNREACHABLE'));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Pro' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('The invoicing service did not answer. Try again in a moment.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('in Spanish', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('reads naturally to a Dominican hotel owner', async () => {
    await i18n.changeLanguage('es');
    serve(status());
    show();
    expect(await screen.findByRole('heading', { name: 'Activar facturación electrónica' })).toBeInTheDocument();
    expect(screen.getByText('No activada')).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: 'Esencial' })).toBeInTheDocument();
    expect(screen.getByText('Incluido en tu plan de Pilloto')).toBeInTheDocument();
    expect(screen.getByText('RD$325.00 / mes')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{\{|fiscal\./); // no raw keys or placeholders leak through
  });
});
