/**
 * The DGII tab (606 preview + TXT, ITBIS figures) and the quick expense dialog, against a mocked API.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../../i18n';

const mockReports = { getDgii606: jest.fn(), getDgii606Txt: jest.fn(), getItbisSummary: jest.fn() };
const mockBills = { createQuickExpense: jest.fn() };
jest.mock('../../../../services/api', () => ({
  accountingReportsService: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockReports as any)[k](...a) }),
  billsService: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockBills as any)[k](...a) }),
}));

// The quick expense dialog reads the plan's modules (bank and currency fields stay hidden here).
jest.mock('../../../../contexts/TenantContext', () => ({ useAccountingFeature: () => false }));

/* eslint-disable import/first */
import DgiiTab from '../DgiiTab';
import QuickExpenseDialog from '../../bills/QuickExpenseDialog';
/* eslint-enable import/first */

const ok = (data: unknown) => ({ data: { success: true, data } });
const row = (over: Record<string, unknown> = {}) => ({
  billId: 'b1', billNumber: 'BILL-000001', supplierName: 'Edenorte', rncCedula: '101821248', idType: '1', expenseType: '02', ncf: 'B0100000012',
  issueDate: '20261005', paymentDate: '20261010', servicesAmount: 1000, goodsAmount: 0, totalAmount: 1000, itbisBilled: 180, itbisWithheld: 0,
  itbisToCost: 0, itbisAdvance: 180, isrType: '', isrWithheld: 0, paymentForm: '02', ...over,
});
const report = (over: Record<string, unknown> = {}) => ({
  period: '2026-10', rnc: '101010101', rows: [row()], issues: [],
  totals: { count: 1, servicesAmount: 1000, goodsAmount: 0, totalAmount: 1000, itbisBilled: 180, itbisWithheld: 0, itbisToCost: 0, itbisAdvance: 180, isrWithheld: 0 },
  ...over,
});
const summary = {
  period: '2026-10', sales: { documents: 3, itbis: 2070, creditNotes: 1, creditNotesItbis: 180, netItbis: 1890 },
  purchases: { bills: 1, itbisBilled: 180, itbisAdvance: 180, itbisToCost: 0 }, withheld: { itbis: 54, isr: 0 }, itbisBalance: 1710, itbisToPay: 1764,
};

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  jest.clearAllMocks();
  mockReports.getItbisSummary.mockResolvedValue(ok(summary));
});

describe('DgiiTab', () => {
  it('shows the month\'s ITBIS figures and the 606 rows, and downloads the TXT', async () => {
    mockReports.getDgii606.mockResolvedValue(ok(report()));
    mockReports.getDgii606Txt.mockResolvedValue({ data: new Blob(['606|101010101|202610|1\r\n']) });
    (URL as any).createObjectURL = jest.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = jest.fn();
    render(<DgiiTab />);
    expect(await screen.findByText('Edenorte')).toBeInTheDocument();
    expect(screen.getByText('ITBIS balance to pay')).toBeInTheDocument();
    expect(screen.getByText('B0100000012')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download TXT/ }));
    await waitFor(() => expect(mockReports.getDgii606Txt).toHaveBeenCalled());
  });

  it('blocks the TXT and says what to fix while a bill is missing data', async () => {
    mockReports.getDgii606.mockResolvedValue(ok(report({
      rows: [row({ ncf: '' })],
      issues: [{ billId: 'b1', billNumber: 'BILL-000001', severity: 'error', problem: 'missing_ncf' }],
    })));
    render(<DgiiTab />);
    expect(await screen.findByText(/missing data the 606 needs/)).toBeInTheDocument();
    expect(screen.getByText('BILL-000001: no NCF', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download TXT/ })).toBeDisabled();
  });
});

describe('QuickExpenseDialog', () => {
  const suppliers = [{ _id: 's1', name: 'Juan Pérez', taxId: '00112345678', defaultExpenseType: '03', isActive: true }] as any;
  const accounts = [{ _id: 'a1', code: '6010', name: 'Alquiler' }] as any;

  it('records a paid expense with the supplier\'s expense type and suggested withholdings for an individual', async () => {
    mockBills.createQuickExpense.mockResolvedValue(ok({}));
    const onSaved = jest.fn();
    render(<QuickExpenseDialog open suppliers={suppliers} accounts={accounts} onClose={jest.fn()} onSaved={onSaved} />);
    const dialog = screen.getByRole('dialog');

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: /Juan Pérez/ }));
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Alquiler local' } });
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1]);
    fireEvent.click(await screen.findByRole('option', { name: /6010/ }));
    fireEvent.change(within(dialog).getByLabelText('Amount before tax'), { target: { value: '10000' } });
    fireEvent.change(within(dialog).getByLabelText('Supplier NCF / e-CF'), { target: { value: 'b11 0000 0001' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /suggest 100% ITBIS/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record expense' }));

    await waitFor(() => expect(mockBills.createQuickExpense).toHaveBeenCalled());
    expect(mockBills.createQuickExpense.mock.calls[0][0]).toMatchObject({
      supplier: 's1', ncf: 'B1100000001', expenseType: '03', itbisWithheld: 1800, isrWithheld: 1000, isrWithholdingType: '2',
      lineItems: [{ description: 'Alquiler local', account: 'a1', lineTotal: 10000, taxRate: 18, isGoods: false }],
      payment: { method: 'cash' },
    });
    expect(onSaved).toHaveBeenCalled();
  });
});
