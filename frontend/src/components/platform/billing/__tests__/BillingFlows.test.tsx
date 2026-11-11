/**
 * The billing console's screens against a mocked API: recording a payment (which issues the e-CF),
 * what each payment's menu offers, the contracted-price dialog, the price list, the settings and
 * Pilloto's own e-CF setup.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../../i18n';
import { charge, ecf, fail, ok, payment, tenant } from '../testFixtures';

const mockApi: Record<string, jest.Mock> = {
  charges: jest.fn(), charge: jest.fn(), generateCharge: jest.fn(), runBilling: jest.fn(), voidCharge: jest.fn(), notifyCharge: jest.fn(), recordPayment: jest.fn(),
  payments: jest.fn(), retryEcf: jest.fn(), refreshEcf: jest.fn(), reversePayment: jest.fn(), ecfPdf: jest.fn(), ecfXml: jest.fn(), emailEcf: jest.fn(),
  tenants: jest.fn(), tenant: jest.fn(), updateTenant: jest.fn(), addPriceChange: jest.fn(), cancelPriceChange: jest.fn(), addDiscount: jest.fn(), endDiscount: jest.fn(),
  plans: jest.fn(), setPlanPrice: jest.fn(), getSettings: jest.fn(), saveSettings: jest.fn(),
  issuer: jest.fn(), issuerReadiness: jest.fn(), linkIssuer: jest.fn(), syncIssuer: jest.fn(), recordSequence: jest.fn(),
};
jest.mock('../../../../services/api', () => ({ platformBillingService: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockApi as any)[k](...a) }) }));

/* eslint-disable import/first */
import ChargesTab from '../ChargesTab';
import DiscountDialog, { discountedPrice } from '../DiscountDialog';
import IssuerTab from '../IssuerTab';
import TenantBillingDrawer from '../TenantBillingDrawer';
import PaymentActions from '../PaymentActions';
import PaymentsTab from '../PaymentsTab';
import PlansTab from '../PlansTab';
import PriceChangeDialog from '../PriceChangeDialog';
import RecordPaymentDialog from '../RecordPaymentDialog';
import SettingsTab from '../SettingsTab';
import TenantsTab from '../TenantsTab';
/* eslint-enable import/first */

const paged = (rows: unknown[]) => ({ data: { success: true, data: rows, meta: { total: rows.length, page: 1, limit: 25, pages: 1 } } });

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.charges.mockResolvedValue(paged([charge()]));
  mockApi.charge.mockResolvedValue(ok({ ...charge(), payments: [] }));
  mockApi.payments.mockResolvedValue(paged([payment()]));
  mockApi.tenants.mockResolvedValue(ok([tenant()]));
});

describe('RecordPaymentDialog', () => {
  const open = (props: Partial<React.ComponentProps<typeof RecordPaymentDialog>> = {}) => {
    const onRecorded = jest.fn();
    const onClose = jest.fn();
    render(<RecordPaymentDialog charge={charge()} issuerReady onClose={onClose} onRecorded={onRecorded} {...props} />);
    return { onRecorded, onClose };
  };

  it('starts with the balance, says the e-CF will be issued, and needs a reference for a transfer', () => {
    open();
    expect(screen.getByLabelText('amount')).toHaveValue(17593.8);
    expect(screen.getByText(/issues a credit-fiscal e-CF \(E31\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment and issue e-CF' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Reference/), { target: { value: 'TRF-9' } });
    expect(screen.getByRole('button', { name: 'Record payment and issue e-CF' })).toBeEnabled();
  });

  it('sends the payment and hands back what came of it, e-CF included', async () => {
    const recorded = payment();
    mockApi.recordPayment.mockResolvedValue(ok({ payment: recorded, charge: charge({ status: 'paid', balance: 0 }) }));
    const { onRecorded } = open();
    fireEvent.change(screen.getByLabelText(/^Reference/), { target: { value: 'TRF-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment and issue e-CF' }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(recorded, expect.objectContaining({ status: 'paid' })));
    expect(mockApi.recordPayment).toHaveBeenCalledWith('c1', expect.objectContaining({ amount: 17593.8, method: 'transfer', reference: 'TRF-9', paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T16:00:00.000Z$/) }));
  });

  it('cash needs no reference', () => {
    open();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Method/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Cash' }));
    expect(screen.getByRole('button', { name: 'Record payment and issue e-CF' })).toBeEnabled();
  });

  it('warns that the e-CF will wait when Pilloto cannot issue yet', () => {
    open({ issuerReady: false });
    expect(screen.getByText(/cannot issue e-CF yet/)).toBeInTheDocument();
  });

  it('shows what the server refused, next to the field', async () => {
    mockApi.recordPayment.mockRejectedValue(fail('BILLING_INVALID', 'Review', { amount: 'Excede el saldo pendiente' }));
    open();
    fireEvent.change(screen.getByLabelText(/^Reference/), { target: { value: 'TRF-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment and issue e-CF' }));
    expect(await screen.findByText('Excede el saldo pendiente')).toBeInTheDocument();
    expect(screen.getByText('Review the highlighted fields.')).toBeInTheDocument();
  });

  it('notes what a partial payment leaves owed', () => {
    open();
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '10000' } });
    expect(screen.getByText(/leaves RD\$7,593\.80 still owed/)).toBeInTheDocument();
  });
});

describe('ChargesTab', () => {
  it('lists charges with their state, marking overdue ones', async () => {
    mockApi.charges.mockResolvedValue(paged([charge(), charge({ id: 'c2', number: 'COB-000002', overdue: true }), charge({ id: 'c3', number: 'COB-000003', status: 'paid', balance: 0, paidAmount: 17593.8 })]));
    render(<ChargesTab issuerReady onChanged={jest.fn()} />);
    await screen.findByText('COB-000001'); // the table exists before its rows do
    const table = screen.getByRole('table', { name: 'Charges' });
    expect(within(table).getAllByText('RD$17,593.80').length).toBeGreaterThan(0);
    expect(within(table).getByText('Overdue')).toBeInTheDocument();
    expect(within(table).getByText('Paid')).toBeInTheDocument();
    // only what is still owed offers a payment
    expect(within(table).getAllByRole('button', { name: 'Record payment' })).toHaveLength(2);
  });

  it('asks the server for overdue ones only, and for a month', async () => {
    render(<ChargesTab issuerReady onChanged={jest.fn()} />);
    await screen.findByText('COB-000001');
    fireEvent.click(screen.getByLabelText('Overdue only'));
    await waitFor(() => expect(mockApi.charges).toHaveBeenLastCalledWith(expect.objectContaining({ overdue: true, page: 1 })));
  });

  it('records a payment from the row and says which e-CF it issued', async () => {
    mockApi.recordPayment.mockResolvedValue(ok({ payment: payment({ ecf: ecf({ eNCF: 'E310000000042' }) }), charge: charge({ status: 'paid', balance: 0 }) }));
    const onChanged = jest.fn();
    render(<ChargesTab issuerReady onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    fireEvent.change(await screen.findByLabelText(/^Reference/), { target: { value: 'TRF-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment and issue e-CF' }));
    expect(await screen.findByText('Payment recorded. e-CF E310000000042 issued.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('says plainly when the payment was kept but the e-CF could not be issued', async () => {
    mockApi.recordPayment.mockResolvedValue(ok({ payment: payment({ ecf: null, ecfError: 'DGII has not certified Pilloto to issue e-CF yet' }), charge: charge({ status: 'paid', balance: 0 }) }));
    render(<ChargesTab issuerReady={false} onChanged={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    fireEvent.change(await screen.findByLabelText(/^Reference/), { target: { value: 'TRF-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment and issue e-CF' }));
    expect(await screen.findByText(/The e-CF was not issued: DGII has not certified Pilloto/)).toBeInTheDocument();
  });

  it('runs the monthly billing on demand and reports the outcome', async () => {
    mockApi.runBilling.mockResolvedValue(ok({ period: '2026-10', created: 3, existing: 1, skipped: 0, failed: 0 }));
    render(<ChargesTab issuerReady onChanged={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run monthly billing' }));
    expect(await screen.findByText(/October 2026: 3 charged, 1 already had one/)).toBeInTheDocument();
  });

  it('opens the charge with its lines, totals and payments', async () => {
    mockApi.charge.mockResolvedValue(ok({ ...charge({ status: 'partial', paidAmount: 10000, balance: 7593.8 }), payments: [payment({ amount: 10000 })] }));
    render(<ChargesTab issuerReady onChanged={jest.fn()} />);
    fireEvent.click(await screen.findByText('COB-000001'));
    const lines = await screen.findByRole('table', { name: 'Charge lines' });
    expect(within(lines).getByText(/Suscripción Pilloto PMS/)).toBeInTheDocument();
    expect(within(lines).getByText('RD$2,683.80')).toBeInTheDocument();
    expect(within(lines).getByText('RD$7,593.80')).toBeInTheDocument();
    expect(await screen.findByText('E310000000001')).toBeInTheDocument();
  });
});

describe('PaymentsTab', () => {
  it('shows the e-CF of each payment, or why there is none', async () => {
    mockApi.payments.mockResolvedValue(paged([payment(), payment({ id: 'p2', ecf: null, ecfError: 'Pilloto’s own e-invoicing is not set up yet.' }), payment({ id: 'p3', status: 'reversed' })]));
    render(<PaymentsTab onChanged={jest.fn()} />);
    await screen.findByText('E310000000001');
    const table = screen.getByRole('table', { name: 'Payments' });
    expect(within(table).getByText('No e-CF')).toBeInTheDocument();
    expect(within(table).getByText('Pilloto’s own e-invoicing is not set up yet.')).toBeInTheDocument();
    expect(within(table).getByText('Reversed')).toBeInTheDocument();
  });

  it('lists only the payments without an e-CF on request', async () => {
    render(<PaymentsTab onChanged={jest.fn()} />);
    await screen.findByRole('table', { name: 'Payments' });
    fireEvent.click(screen.getByLabelText('Without e-CF only'));
    await waitFor(() => expect(mockApi.payments).toHaveBeenLastCalledWith(expect.objectContaining({ ecf: 'missing' })));
  });
});

describe('PaymentActions', () => {
  const menu = (p = payment()) => {
    const onChanged = jest.fn();
    const onError = jest.fn();
    render(<PaymentActions payment={p} onChanged={onChanged} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Payment actions' }));
    return { onChanged, onError };
  };

  it('offers the files and the email for a confirmed e-CF, but no retry', () => {
    menu();
    expect(screen.getByRole('menuitem', { name: 'View PDF' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download XML' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Email e-CF to the tenant' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /again|Issue e-CF/ })).not.toBeInTheDocument();
  });

  it('offers to issue when there is no e-CF, and does it', async () => {
    mockApi.retryEcf.mockResolvedValue(ok(payment()));
    const { onChanged } = menu(payment({ ecf: null, ecfError: 'x' }));
    expect(screen.queryByRole('menuitem', { name: 'View PDF' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Issue e-CF' }));
    await waitFor(() => expect(mockApi.retryEcf).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('e-CF sent.'));
  });

  it('offers to send again after a DGII rejection', () => {
    menu(payment({ ecf: ecf({ estado: 'Rechazado' }) }));
    expect(screen.getByRole('menuitem', { name: 'Send or issue the e-CF again' })).toBeInTheDocument();
  });

  it('reports a failed action instead of swallowing it', async () => {
    mockApi.refreshEcf.mockRejectedValue(fail('BILLINGSOFT_UNREACHABLE', 'down'));
    const { onError } = menu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Check DGII status' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('BillingSoft could not be reached. Try again in a moment.'));
  });

  it('reverses only with a reason, and tells when a credit note will be issued', async () => {
    mockApi.reversePayment.mockResolvedValue(ok({ payment: payment({ status: 'reversed' }), charge: charge() }));
    const { onChanged } = menu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reverse payment' }));
    expect(await screen.findByText(/a credit note \(E34\) cancels the e-CF/)).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Reverse payment' }).pop()!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Pago duplicado' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mockApi.reversePayment).toHaveBeenCalledWith('p1', 'Pago duplicado'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Payment reversed.'));
  });

  it('shows the server’s reason when a reversal is refused (DGII still deciding)', async () => {
    mockApi.reversePayment.mockRejectedValue(fail('BILLING_ECF_PENDING', 'x'));
    menu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reverse payment' }));
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: 'Pago duplicado' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reverse payment' }).pop()!);
    expect(await screen.findByText(/still being processed/)).toBeInTheDocument();
  });
});

describe('TenantsTab and PriceChangeDialog', () => {
  it('lists tenants with what they pay, marking a custom price, a missing RNC and a pause', async () => {
    mockApi.tenants.mockResolvedValue(ok([
      tenant({ outstanding: 1200 }),
      tenant({ id: 't2', name: 'Sin RNC', slug: 'sinrnc', rnc: '', paused: true, products: [{ product: 'pms', plan: 'basic', listPrice: 2450, contractPrice: 2000, contractSource: 'override', contractSince: '2026-10' }] }),
    ]));
    render(<TenantsTab onChanged={jest.fn()} onOpenCharge={jest.fn()} />);
    await screen.findByText('Sin RNC');
    const table = screen.getByRole('table', { name: 'Tenants' });
    expect(within(table).getByText('RD$1,200.00')).toBeInTheDocument();
    expect(within(table).getByText('Custom')).toBeInTheDocument();
    expect(within(table).getByText('No RNC')).toBeInTheDocument();
    expect(within(table).getByText('Not charged')).toBeInTheDocument();
  });

  it('needs a price and a reason of at least ten characters, then schedules and says the tenant is emailed', async () => {
    mockApi.addPriceChange.mockResolvedValue(ok(tenant()));
    const onSaved = jest.fn();
    render(<PriceChangeDialog tenant={tenant()} onClose={jest.fn()} onSaved={onSaved} />);
    const save = screen.getByRole('button', { name: 'Save and email the tenant' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'corto' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Acuerdo comercial anual' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockApi.addPriceChange).toHaveBeenCalledWith('t1', expect.objectContaining({ product: 'pms', price: 4000, reason: 'Acuerdo comercial anual', effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}$/) }));
  });

  it('shows the current price and the server’s complaint about the month', async () => {
    mockApi.addPriceChange.mockRejectedValue(fail('BILLING_PERIOD_CLOSED', 'x', { effectiveFrom: 'Mes ya cobrado' }));
    render(<PriceChangeDialog tenant={tenant()} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByText('Now: RD$5,540.00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Acuerdo comercial anual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and email the tenant' }));
    expect(await screen.findByText('Mes ya cobrado')).toBeInTheDocument();
  });
});

describe('DiscountDialog and the tenant’s discounts', () => {
  it('computes what the tenant would pay', () => {
    expect(discountedPrice(5540, 'percent', 20)).toBe(4432);
    expect(discountedPrice(5540, 'amount', 500)).toBe(5040);
    expect(discountedPrice(300, 'amount', 500)).toBe(0);
  });

  it('grants a percentage discount, showing the price it leads to, and needs a reason', async () => {
    mockApi.addDiscount.mockResolvedValue(ok(tenant()));
    const onSaved = jest.fn();
    render(<DiscountDialog tenant={tenant()} onClose={jest.fn()} onSaved={onSaved} />);
    const save = screen.getByRole('button', { name: 'Grant discount' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('value'), { target: { value: '20' } });
    expect(screen.getByText('Per month: RD$5,540.00 → RD$4,432.00 (before ITBIS)')).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Cliente fundador' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockApi.addDiscount).toHaveBeenCalledWith('t1', { product: 'pms', type: 'percent', value: 20, effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}$/), reason: 'Cliente fundador' });
  });

  it('grants a fixed amount until a last month, and refuses a percentage above 100', async () => {
    mockApi.addDiscount.mockResolvedValue(ok(tenant()));
    render(<DiscountDialog tenant={tenant()} onClose={jest.fn()} onSaved={jest.fn()} />);
    const save = screen.getByRole('button', { name: 'Grant discount' });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Acuerdo comercial anual' } });
    fireEvent.change(screen.getByLabelText('value'), { target: { value: '150' } });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fixed amount' }));
    fireEvent.change(screen.getByLabelText('value'), { target: { value: '500' } });
    fireEvent.mouseDown(screen.getByLabelText('Last month with the discount'));
    fireEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[1]);
    fireEvent.click(save);
    await waitFor(() => expect(mockApi.addDiscount).toHaveBeenCalled());
    expect(mockApi.addDiscount).toHaveBeenCalledWith('t1', expect.objectContaining({ type: 'amount', value: 500, effectiveUntil: expect.stringMatching(/^\d{4}-\d{2}$/) }));
  });

  it('shows the server’s complaint when the discounts overlap', async () => {
    mockApi.addDiscount.mockRejectedValue(fail('BILLING_DISCOUNT_OVERLAP', 'x', { effectiveFrom: 'Ya hay un descuento en esos meses' }));
    render(<DiscountDialog tenant={tenant()} onClose={jest.fn()} onSaved={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('value'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Acuerdo comercial anual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant discount' }));
    expect(await screen.findByText('Ya hay un descuento en esos meses')).toBeInTheDocument();
  });

  it('lists a tenant’s discounts in its drawer and ends one that is in force', async () => {
    const discounts = [
      { id: 'd1', product: 'pms' as const, type: 'percent' as const, value: 20, effectiveFrom: '2026-08', effectiveUntil: null, reason: 'Cliente fundador', createdByEmail: 'ops@pilloto.com', createdAt: '2026-08-01T12:00:00Z', status: 'active' as const },
      { id: 'd2', product: 'accounting' as const, type: 'amount' as const, value: 500, effectiveFrom: '2025-01', effectiveUntil: '2025-06', reason: 'Prueba', createdByEmail: 'ops@pilloto.com', createdAt: '2025-01-01T12:00:00Z', status: 'ended' as const },
    ];
    mockApi.tenant.mockResolvedValue(ok({ ...tenant({ discounts }), charges: [], payments: [] }));
    mockApi.endDiscount.mockResolvedValue(ok(tenant()));
    render(<TenantBillingDrawer tenantId="t1" onClose={jest.fn()} onChanged={jest.fn()} onOpenCharge={jest.fn()} />);
    expect(await screen.findByText('20%')).toBeInTheDocument();
    expect(screen.getByText('RD$500.00')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'End' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    await waitFor(() => expect(mockApi.endDiscount).toHaveBeenCalledWith('t1', 'd1'));
  });
});

describe('PlansTab', () => {
  const plans = [
    { product: 'pms', plan: 'basic', name: 'Basic', monthlyPrice: 2450, history: [{ previous: null, price: 2450, changedAt: '2026-11-01T00:00:00Z', changedByEmail: 'system' }] },
    { product: 'accounting', plan: 'plus', name: 'Plus', monthlyPrice: 9370, history: [] },
  ];

  it('lists the price list and saves an edited price, reminding that existing subscriptions keep theirs', async () => {
    mockApi.plans.mockResolvedValue(ok(plans));
    mockApi.setPlanPrice.mockResolvedValue(ok(plans[0]));
    render(<PlansTab />);
    expect(await screen.findByText('RD$2,450.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit price pms Basic' }));
    fireEvent.change(await screen.findByLabelText('price'), { target: { value: '2600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockApi.setPlanPrice).toHaveBeenCalledWith('pms', 'basic', 2600));
    expect(await screen.findByText(/existing subscriptions keep the price they have/i)).toBeInTheDocument();
  });

  it('shows a refused price', async () => {
    mockApi.plans.mockResolvedValue(ok(plans));
    mockApi.setPlanPrice.mockRejectedValue(fail('BILLING_INVALID', 'x', { price: 'Precio fuera de rango' }));
    render(<PlansTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit price pms Basic' }));
    fireEvent.change(await screen.findByLabelText('price'), { target: { value: '99999999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Precio fuera de rango')).toBeInTheDocument();
  });
});

describe('SettingsTab', () => {
  it('loads and saves the tax, due days, notice email and payment instructions', async () => {
    const settings = { tax: 'itbis18', dueDays: 10, notifyEmail: '', paymentInstructions: '' };
    mockApi.getSettings.mockResolvedValue(ok(settings));
    mockApi.saveSettings.mockImplementation((s: unknown) => Promise.resolve(ok(s)));
    const onSaved = jest.fn();
    render(<SettingsTab onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText('Days to pay a charge'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/How to pay/), { target: { value: 'Banco X 123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockApi.saveSettings).toHaveBeenCalledWith({ tax: 'itbis18', dueDays: 15, notifyEmail: '', paymentInstructions: 'Banco X 123' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it('offers the four tax treatments and warns to confirm with an accountant', async () => {
    mockApi.getSettings.mockResolvedValue(ok({ tax: 'itbis18', dueDays: 10, notifyEmail: '', paymentInstructions: '' }));
    render(<SettingsTab onSaved={jest.fn()} />);
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Tax on subscription charges/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['ITBIS 18%', 'ITBIS 16%', 'ITBIS 0% (taxed at zero rate)', 'Exempt (no ITBIS)']);
    expect(screen.getByText(/confirm the treatment of software subscriptions with your accountant/)).toBeInTheDocument();
  });
});

describe('IssuerTab (Pilloto’s own e-invoicing)', () => {
  const unlinked = { configured: true, allowUncertified: false, state: 'inactive', linked: false, environment: null, certification: null, rnc: null, webhookRegistered: false, lastSyncedAt: null, appUrl: 'https://app.billingsoft.test', notifyEmail: '' };
  const linked = { ...unlinked, state: 'in_progress', linked: true, environment: 'certecf', certification: 'in_progress', rnc: '131000000', webhookRegistered: true, lastSyncedAt: '2026-11-10T12:00:00Z' };
  const readiness = {
    environment: 'certecf', certification: 'in_progress', complete: false, certificate: 'valid', usableTypes: ['31'], organization: { rnc: '131000000', razonSocial: 'Pilloto SRL' },
    steps: [{ step: 'profile', done: true }, { step: 'certificate', done: true }, { step: 'sequences', done: false }, { step: 'directory', done: false }, { step: 'first_document', done: false }],
    sequences: [{ id: 's1', documentType: '31', rangeStart: 1, rangeEnd: 100, next: 5, remaining: 96, usable: true }],
  };

  it('links Pilloto’s own account when it is not linked yet', async () => {
    mockApi.issuer.mockResolvedValueOnce(ok(unlinked)).mockResolvedValue(ok(linked));
    mockApi.linkIssuer.mockResolvedValue(ok(linked));
    mockApi.issuerReadiness.mockResolvedValue(ok(readiness));
    const onChanged = jest.fn();
    render(<IssuerTab onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Link Pilloto’s e-invoicing' }));
    await waitFor(() => expect(mockApi.linkIssuer).toHaveBeenCalled());
    expect(await screen.findByText('DGII setup')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('cannot link on a server without a BillingSoft credential, and says so', async () => {
    mockApi.issuer.mockResolvedValue(ok({ ...unlinked, configured: false }));
    render(<IssuerTab onChanged={jest.fn()} />);
    expect(await screen.findByText(/no BillingSoft credential/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link Pilloto’s e-invoicing' })).toBeDisabled();
  });

  it('shows DGII’s steps, the certificate, the usable types and the ranges; records a new range', async () => {
    mockApi.issuer.mockResolvedValue(ok(linked));
    mockApi.issuerReadiness.mockResolvedValue(ok(readiness));
    mockApi.recordSequence.mockResolvedValue(ok({}));
    render(<IssuerTab onChanged={jest.fn()} />);
    expect(await screen.findByText('Digital certificate uploaded')).toBeInTheDocument();
    expect(screen.getByText('Test environment')).toBeInTheDocument();
    expect(screen.getByText(/Can issue: E31/)).toBeInTheDocument();
    const ranges = screen.getByRole('table', { name: 'e-NCF ranges' });
    expect(within(ranges).getByText('96')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('range start'), { target: { value: '101' } });
    fireEvent.change(screen.getByLabelText('range end'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record range' }));
    await waitFor(() => expect(mockApi.recordSequence).toHaveBeenCalledWith({ documentType: '31', rangeStart: 101, rangeEnd: 200 }));
    expect(await screen.findByText('Range recorded.')).toBeInTheDocument();
  });

  it('warns when this server issues without DGII’s certification', async () => {
    mockApi.issuer.mockResolvedValue(ok({ ...linked, allowUncertified: true }));
    mockApi.issuerReadiness.mockResolvedValue(ok(readiness));
    render(<IssuerTab onChanged={jest.fn()} />);
    expect(await screen.findByText(/development\/QA only/)).toBeInTheDocument();
  });
});
