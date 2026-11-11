/**
 * The documents list, the document drawer (what can be done in each state) and the note dialog.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../i18n';
import { doc, fail, ok } from '../testFixtures';

const mockApi = {
  getDocuments: jest.fn(), getDocument: jest.fn(), refreshDocument: jest.fn(), retryDocument: jest.fn(), emailDocument: jest.fn(),
  getDocumentPdfBlob: jest.fn(), getDocumentXmlBlob: jest.fn(), issueCreditNote: jest.fn(), issueDebitNote: jest.fn(),
};
jest.mock('../../../services/api', () => ({ fiscalService: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockApi as any)[k](...a) }) }));

/* eslint-disable import/first */
import FiscalDocumentsTab from '../FiscalDocumentsTab';
import FiscalDocumentDrawer from '../FiscalDocumentDrawer';
import FiscalNoteDialog from '../FiscalNoteDialog';
/* eslint-enable import/first */

const list = (rows = [doc()], total = rows.length) => ok(rows, { meta: { total, page: 1, limit: 25, pages: 1 } });

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getDocuments.mockImplementation(() => list());
});
afterEach(() => { jest.useRealTimers(); });

describe('documents list', () => {
  it('lists documents with number, type, buyer, total and state', async () => {
    mockApi.getDocuments.mockImplementation(() => list([
      doc(),
      doc({ _id: 'd2', eNCF: undefined, billingsoftDocumentId: undefined, estadoECF: 'Pendiente', buyerName: undefined, buyerRnc: '131880681', totalFactura: 590, tipo: 'E31' }),
    ]));
    render(<FiscalDocumentsTab canIssue />);
    const table = await screen.findByRole('table', { name: 'Electronic invoices' });
    expect(await within(table).findByText('E320000000001')).toBeInTheDocument();
    expect(within(table).getByText('Ana Gómez')).toBeInTheDocument();
    expect(within(table).getByText('RD$11,800.00')).toBeInTheDocument();
    expect(within(table).getByText('Accepted')).toBeInTheDocument();
    // not yet numbered by BillingSoft: says so rather than showing a blank
    expect(within(table).getByText('Number pending')).toBeInTheDocument();
    expect(within(table).getByText('Pending')).toBeInTheDocument();
    expect(within(table).getByText('131880681')).toBeInTheDocument(); // the buyer RNC when there is no name
  });

  it('marks documents issued in a DGII test environment', async () => {
    mockApi.getDocuments.mockImplementation(() => list([doc({ environment: 'testecf' })]));
    render(<FiscalDocumentsTab canIssue />);
    expect(await screen.findByText('TEST')).toBeInTheDocument();
  });

  it('is calm when there is nothing, and different when filters hide everything', async () => {
    mockApi.getDocuments.mockImplementation(() => list([]));
    render(<FiscalDocumentsTab canIssue />);
    expect(await screen.findByText('No electronic invoices yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search e-NCF, buyer, RNC or reference'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No documents match these filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('No electronic invoices yet.')).toBeInTheDocument();
  });

  it('asks the server to search and filter (debounced), starting again from page one', async () => {
    render(<FiscalDocumentsTab canIssue />);
    await screen.findByText('E320000000001');
    mockApi.getDocuments.mockClear();
    fireEvent.change(screen.getByLabelText('Search e-NCF, buyer, RNC or reference'), { target: { value: 'E32000' } });
    await waitFor(() => expect(mockApi.getDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'E32000', page: 1 })));
    fireEvent.mouseDown(screen.getByLabelText('Status'));
    fireEvent.click(await screen.findByRole('option', { name: 'Needs attention' }));
    await waitFor(() => expect(mockApi.getDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ estadoECF: 'Rechazado,Error,Sin Resolver,Aceptado Condicional' })));
  });

  it('narrows to one source when asked (e.g. the documents of an Accounting invoice)', async () => {
    render(<FiscalDocumentsTab canIssue fixedQuery={{ invoiceId: 'inv-9' }} />);
    await waitFor(() => expect(mockApi.getDocuments).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 'inv-9' })));
  });

  it('shows the error with a way to try again', async () => {
    mockApi.getDocuments.mockImplementationOnce(() => fail('BILLINGSOFT_UNREACHABLE'));
    render(<FiscalDocumentsTab canIssue />);
    expect(await screen.findByText('The invoicing service did not answer. Try again in a moment.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('E320000000001')).toBeInTheDocument();
  });

  it('keeps itself up to date while a document is still moving toward DGII\'s verdict — and stops when none is', async () => {
    jest.useFakeTimers();
    mockApi.getDocuments.mockImplementationOnce(() => list([doc({ estadoECF: 'En Proceso' })]));
    mockApi.getDocuments.mockImplementation(() => list([doc({ estadoECF: 'Aceptado' })]));
    render(<FiscalDocumentsTab canIssue />);
    expect(await screen.findByText('In process')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(20_000); });
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    const calls = mockApi.getDocuments.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(mockApi.getDocuments.mock.calls.length).toBe(calls); // settled: no more polling
  });

  it('opens a document in the drawer when asked by a link', async () => {
    mockApi.getDocument.mockImplementation(() => ok(doc({ eNCF: 'E320000000777' })));
    render(<FiscalDocumentsTab canIssue openId="d7" />);
    expect(await screen.findByRole('heading', { name: 'E320000000777' })).toBeInTheDocument();
  });

  it('a row opens its drawer from the keyboard too', async () => {
    render(<FiscalDocumentsTab canIssue />);
    const row = await screen.findByRole('row', { name: /E320000000001/ });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'View PDF' })).toBeInTheDocument();
  });
});

describe('document drawer', () => {
  const open = (d = doc(), canIssue = true) => {
    const onChanged = jest.fn();
    render(<FiscalDocumentDrawer document={d} canIssue={canIssue} onClose={jest.fn()} onChanged={onChanged} />);
    return onChanged;
  };

  it('an accepted invoice can be viewed, downloaded, emailed and modified with a note', () => {
    open();
    expect(screen.getByRole('button', { name: 'View PDF' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'XML' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Email' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Credit note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Debit note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check status' })).not.toBeInTheDocument(); // settled
  });

  it('a read-only user sees the document but cannot email or issue notes', () => {
    open(doc(), false);
    expect(screen.getByRole('button', { name: 'View PDF' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Credit note' })).not.toBeInTheDocument();
  });

  it('a document still with DGII can be checked, and a refresh updates it', async () => {
    mockApi.refreshDocument.mockImplementation(() => ok(doc({ estadoECF: 'Aceptado' })));
    const onChanged = open(doc({ estadoECF: 'En Proceso' }));
    expect(screen.queryByRole('button', { name: 'Credit note' })).not.toBeInTheDocument(); // not accepted yet
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(mockApi.refreshDocument).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('a document BillingSoft never confirmed has no files, explains itself, and can be sent again — safely', async () => {
    mockApi.retryDocument.mockImplementation(() => ok(doc({ estadoECF: 'En Proceso' }), { queued: false }));
    const onChanged = open(doc({ estadoECF: 'Pendiente', eNCF: undefined, billingsoftDocumentId: undefined }));
    expect(screen.getByText(/cannot be issued twice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Email' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(mockApi.retryDocument).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('a rejected document shows DGII\'s reason and cannot be modified', () => {
    open(doc({ estadoECF: 'Rechazado', dgiiMessages: [{ code: '101', message: 'RNC del comprador inválido' }] }));
    expect(screen.getByText('101: RNC del comprador inválido')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Credit note' })).not.toBeInTheDocument();
  });

  it('a conditionally accepted document shows DGII\'s observations', () => {
    open(doc({ estadoECF: 'Aceptado Condicional', mensaje: 'Corrija el correo del comprador' }));
    expect(screen.getByText('DGII’s observations')).toBeInTheDocument();
    expect(screen.getByText('Corrija el correo del comprador')).toBeInTheDocument();
  });

  it('a test-environment document warns it has no fiscal value and cannot be emailed', () => {
    open(doc({ environment: 'certecf' }));
    expect(screen.getByText(/has no fiscal value/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email' })).toBeDisabled();
  });

  it('an Accounting invoice is modified from Accounting, not here, so the books stay in step', () => {
    open(doc({ generationSource: 'accounting_invoice', tipo: 'E31' }));
    expect(screen.queryByRole('button', { name: 'Credit note' })).not.toBeInTheDocument();
    expect(screen.getByText(/issue its credit and debit notes from Accounting/)).toBeInTheDocument();
  });

  it('shows the lines with their net price and ITBIS rate', () => {
    open();
    const items = screen.getByRole('table', { name: 'Items' });
    expect(within(items).getByText('Habitación 101')).toBeInTheDocument();
    expect(within(items).getByText('RD$10,000.00')).toBeInTheDocument();
    expect(within(items).getByText('18%')).toBeInTheDocument();
  });

  it('emails the document, to the buyer or to an address given', async () => {
    mockApi.emailDocument.mockImplementation(() => ok(null));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send by email' });
    expect(within(dialog).getByLabelText('Send to')).toHaveValue('ana@gmail.com');
    fireEvent.change(within(dialog).getByLabelText('Send to'), { target: { value: 'otra@persona.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockApi.emailDocument).toHaveBeenCalledWith('d1', 'otra@persona.com'));
    expect(await screen.findByText('Sent to otra@persona.com.')).toBeInTheDocument();
  });

  it('says why an email could not be sent, on the field', async () => {
    mockApi.emailDocument.mockImplementation(() => fail('FISCAL_REJECTED', 'The email address is invalid', { email: 'Correo inválido' }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send by email' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByText('Correo inválido')).toBeInTheDocument();
  });
});

describe('note dialog', () => {
  const original = doc({ totalFactura: 1180 });
  const renderNote = (kind: 'credit' | 'debit', onIssued = jest.fn()) => {
    render(<FiscalNoteDialog open kind={kind} original={original} onClose={jest.fn()} onIssued={onIssued} />);
    return onIssued;
  };
  const issued = (over = {}, queued = false) => ok(doc({ tipo: 'E34', eNCF: 'E340000000001', estadoECF: 'En Proceso', totalFactura: 590, ...over }), { queued });

  it('a credit note needs a reason and an amount, and cannot credit more than the invoice', async () => {
    renderNote('credit');
    const submit = screen.getByRole('button', { name: 'Issue credit note' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Descuento acordado' } });
    fireEvent.change(screen.getByLabelText(/^Amount to credit/), { target: { value: '2000' } });
    expect(screen.getByText('A credit note cannot credit more than the invoice.')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Amount to credit/), { target: { value: '590' } });
    expect(submit).toBeEnabled();
  });

  it('issues the note with DGII\'s code, the reason and the amount', async () => {
    mockApi.issueCreditNote.mockImplementation(() => issued());
    const onIssued = renderNote('credit');
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Descuento acordado' } });
    fireEvent.change(screen.getByLabelText(/^Amount to credit/), { target: { value: '590' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue credit note' }));
    await waitFor(() => expect(mockApi.issueCreditNote).toHaveBeenCalledWith({ originalId: 'd1', codigoModificacion: '3', razonModificacion: 'Descuento acordado', totalAmount: 590 }));
    expect(await screen.findByText('The note was issued and sent to DGII.')).toBeInTheDocument();
    expect(screen.getByText('E340000000001')).toBeInTheDocument();
    expect(onIssued).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'E34' }), false);
  });

  it('voiding credits the whole invoice and locks the amount', async () => {
    mockApi.issueCreditNote.mockImplementation(() => issued({ totalFactura: 1180 }));
    renderNote('credit');
    fireEvent.mouseDown(screen.getByLabelText('Why'));
    fireEvent.click(await screen.findByRole('option', { name: 'Void the invoice' }));
    const amount = screen.getByLabelText(/^Amount to credit/);
    expect(amount).toBeDisabled();
    expect(amount).toHaveValue(1180);
    expect(screen.getByText('Voiding credits the whole invoice.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Emitida por error' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue credit note' }));
    await waitFor(() => expect(mockApi.issueCreditNote).toHaveBeenCalledWith(expect.objectContaining({ codigoModificacion: '1', totalAmount: 1180 })));
  });

  it('a debit note charges more, with no cap and no code to choose', async () => {
    mockApi.issueDebitNote.mockImplementation(() => issued({ tipo: 'E33', eNCF: 'E330000000001' }));
    renderNote('debit');
    expect(screen.queryByLabelText('Why')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Late checkout' } });
    fireEvent.change(screen.getByLabelText(/^Amount to charge/), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue debit note' }));
    await waitFor(() => expect(mockApi.issueDebitNote).toHaveBeenCalledWith({ originalId: 'd1', razonModificacion: 'Late checkout', totalAmount: 5000 }));
  });

  it('keeps the reason within what the document can print', () => {
    renderNote('debit');
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'x'.repeat(200) } });
    expect((screen.getByLabelText(/^Reason/) as HTMLInputElement).value).toHaveLength(90);
  });

  it('tells the user when the note was saved but not yet sent', async () => {
    mockApi.issueCreditNote.mockImplementation(() => issued({ estadoECF: 'Pendiente', eNCF: undefined }, true));
    renderNote('credit');
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Ajuste' } });
    fireEvent.change(screen.getByLabelText(/^Amount to credit/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue credit note' }));
    expect(await screen.findByText(/it will be sent automatically in a moment/)).toBeInTheDocument();
    expect(screen.getByText('Number pending')).toBeInTheDocument();
  });

  it('shows BillingSoft\'s own reason when it refuses, and stays open to fix it', async () => {
    mockApi.issueCreditNote.mockImplementation(() => fail('FISCAL_REJECTED', 'La nota excede el monto acreditable', { reason: 'Motivo demasiado largo' }));
    renderNote('credit');
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Ajuste' } });
    fireEvent.change(screen.getByLabelText(/^Amount to credit/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue credit note' }));
    expect(await screen.findByText('La nota excede el monto acreditable')).toBeInTheDocument();
    expect(screen.getByText('Motivo demasiado largo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue credit note' })).toBeEnabled();
  });
});
