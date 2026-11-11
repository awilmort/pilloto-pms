/** Small helpers shared by the invoice list, editor and detail pages. */
import type { Customer, ElectronicInvoice, Invoice, InvoiceStatus } from '../../../types';

export const STATUS_COLOR: Record<InvoiceStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  sent: 'info',
  partial: 'warning',
  paid: 'success',
  void: 'error',
};

/** The populated Customer of a registered-customer invoice (null for a final consumer / unpopulated id). */
export const customerOf = (inv: Invoice): Customer | null =>
  !inv.isIndividual && inv.customer && typeof inv.customer === 'object' ? inv.customer : null;

export const customerLabel = (inv: Invoice): string => {
  if (inv.isIndividual) return inv.individualCustomer?.name || '—';
  const c = customerOf(inv);
  return c ? (c.razonSocial || c.name) : '—';
};

export const electronicInvoiceOf = (inv: Invoice | null): ElectronicInvoice | null =>
  inv?.electronicInvoiceId && typeof inv.electronicInvoiceId === 'object' ? inv.electronicInvoiceId : null;

/**
 * Open (issued, unpaid) and past its due date. Computed here rather than read from the server's
 * `isOverdue` virtual, which does not come through on lean queries.
 */
export const isOverdueInvoice = (inv: Invoice): boolean =>
  (inv.status === 'sent' || inv.status === 'partial') && inv.balanceDue > 0.005 && !!inv.dueDate && new Date(inv.dueDate).getTime() < Date.now();

/** Document title of each comprobante type. */
export const ECF_TITLE_KEY: Record<string, string> = {
  E31: 'accounting.invoices.page.ecfType.E31',
  E32: 'accounting.invoices.page.ecfType.E32',
};
