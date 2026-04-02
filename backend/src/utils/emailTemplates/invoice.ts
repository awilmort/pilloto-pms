/**
 * Invoice / receipt email template.
 * Rendered when a folio transitions to `closed` (check-out).
 */

import { applyLayout, escapeHtml, formatCurrency, formatDate } from './layout';

export interface InvoiceTemplateCharge {
  description: string;
  amount: number;
  category?: string;
}

export interface InvoiceTemplatePayment {
  amount: number;
  method: string;
  status: string;
  reference?: string;
  createdAt?: Date | string;
}

export interface InvoiceTemplateParams {
  reservationCode: string;
  guestName: string;
  checkInDate: Date | string;
  checkOutDate?: Date | string;
  reservationType: string;
  charges: InvoiceTemplateCharge[];
  payments: InvoiceTemplatePayment[];
  totalCharges: number;
  totalPayments: number;
  balance: number;
  tenantName: string;
  tenantLogoUrl?: string;
  currency?: string;
  customFooterHtml?: string;
  customFooterText?: string;
  locale?: string;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  credit: 'Crédito',
  check: 'Cheque',
};

export function renderInvoice(params: InvoiceTemplateParams): { html: string; text: string } {
  const {
    reservationCode,
    guestName,
    checkInDate,
    checkOutDate,
    reservationType,
    charges,
    payments,
    totalCharges,
    totalPayments,
    balance,
    tenantName,
    tenantLogoUrl,
    currency = 'DOP',
    locale = 'es-ES',
    customFooterHtml,
    customFooterText,
  } = params;

  const fmt = (n: number) => formatCurrency(n, currency, locale);

  // ── Charges table rows ────────────────────────────────────────────────────
  const chargeRowsHtml = charges
    .map(c => `
      <tr>
        <td style="padding:7px 12px;font-size:13px;color:#444444;border-bottom:1px solid #f0f0f0;">${escapeHtml(c.description)}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;border-bottom:1px solid #f0f0f0;">${fmt(c.amount)}</td>
      </tr>`)
    .join('');

  const chargeRowsText = charges
    .map(c => `  ${c.description.padEnd(36)} ${fmt(c.amount)}`)
    .join('\n');

  // ── Payments table rows ───────────────────────────────────────────────────
  const activePayments = payments.filter(p => p.status !== 'reversed');
  const paymentRowsHtml = activePayments
    .map(p => `
      <tr>
        <td style="padding:7px 12px;font-size:13px;color:#444444;border-bottom:1px solid #f0f0f0;">${METHOD_LABELS[p.method] ?? p.method}${p.reference ? ` (${escapeHtml(p.reference)})` : ''}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;border-bottom:1px solid #f0f0f0;color:#2E7D32;">-${fmt(p.amount)}</td>
      </tr>`)
    .join('');

  const paymentRowsText = activePayments
    .map(p => `  ${(METHOD_LABELS[p.method] ?? p.method).padEnd(36)} -${fmt(p.amount)}`)
    .join('\n');

  const balanceColor = balance > 0 ? '#c62828' : '#2E7D32';

  const bodyHtml = `
    <p style="margin:0 0 4px;font-size:20px;font-weight:bold;color:#333333;">Factura / Recibo</p>
    <p style="margin:0 0 24px;font-size:14px;color:#777777;">${escapeHtml(tenantName)}</p>

    <!-- Guest & reservation info -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
      <tr>
        <td style="font-size:13px;color:#777777;padding:3px 0;">Huésped:</td>
        <td style="font-size:13px;font-weight:bold;padding:3px 0;">${escapeHtml(guestName)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#777777;padding:3px 0;">Código de reserva:</td>
        <td style="font-size:13px;font-family:monospace;letter-spacing:1px;padding:3px 0;">${escapeHtml(reservationCode)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#777777;padding:3px 0;">Tipo:</td>
        <td style="font-size:13px;padding:3px 0;">${escapeHtml(reservationType)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#777777;padding:3px 0;">Check-in:</td>
        <td style="font-size:13px;padding:3px 0;">${escapeHtml(formatDate(checkInDate, locale))}</td>
      </tr>
      ${checkOutDate ? `
      <tr>
        <td style="font-size:13px;color:#777777;padding:3px 0;">Check-out:</td>
        <td style="font-size:13px;padding:3px 0;">${escapeHtml(formatDate(checkOutDate, locale))}</td>
      </tr>` : ''}
    </table>

    <!-- Charges -->
    <p style="margin:0 0 6px;font-size:14px;font-weight:bold;color:#333333;">Cargos</p>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e8e8e8;border-radius:4px;margin-bottom:16px;border-collapse:collapse;">
      <thead>
        <tr style="background-color:#f5f5f5;">
          <th style="padding:8px 12px;font-size:12px;font-weight:bold;text-align:left;color:#666666;border-bottom:1px solid #e0e0e0;">Descripción</th>
          <th style="padding:8px 12px;font-size:12px;font-weight:bold;text-align:right;color:#666666;border-bottom:1px solid #e0e0e0;">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${chargeRowsHtml}
        <tr style="background-color:#f9f9f9;">
          <td style="padding:8px 12px;font-size:14px;font-weight:bold;">Subtotal</td>
          <td style="padding:8px 12px;font-size:14px;font-weight:bold;text-align:right;">${fmt(totalCharges)}</td>
        </tr>
      </tbody>
    </table>

    <!-- Payments -->
    ${activePayments.length > 0 ? `
    <p style="margin:0 0 6px;font-size:14px;font-weight:bold;color:#333333;">Pagos recibidos</p>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e8e8e8;border-radius:4px;margin-bottom:16px;border-collapse:collapse;">
      <thead>
        <tr style="background-color:#f5f5f5;">
          <th style="padding:8px 12px;font-size:12px;font-weight:bold;text-align:left;color:#666666;border-bottom:1px solid #e0e0e0;">Método</th>
          <th style="padding:8px 12px;font-size:12px;font-weight:bold;text-align:right;color:#666666;border-bottom:1px solid #e0e0e0;">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${paymentRowsHtml}
        <tr style="background-color:#f9f9f9;">
          <td style="padding:8px 12px;font-size:14px;font-weight:bold;">Total pagado</td>
          <td style="padding:8px 12px;font-size:14px;font-weight:bold;text-align:right;color:#2E7D32;">-${fmt(totalPayments)}</td>
        </tr>
      </tbody>
    </table>` : ''}

    <!-- Balance -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f9f9f9;border:2px solid #e0e0e0;border-radius:4px;margin-bottom:24px;">
      <tr>
        <td style="padding:14px 20px;font-size:16px;font-weight:bold;">Saldo final</td>
        <td style="padding:14px 20px;font-size:20px;font-weight:bold;text-align:right;color:${balanceColor};">${fmt(balance)}</td>
      </tr>
    </table>

    <p style="margin:0;font-size:13px;color:#888888;font-style:italic;">
      Gracias por hospedarte con nosotros. ¡Esperamos verte pronto!
    </p>`;

  const bodyText = [
    `FACTURA / RECIBO`,
    `${tenantName}`,
    ``,
    `Huésped: ${guestName}`,
    `Código de reserva: ${reservationCode}`,
    `Tipo: ${reservationType}`,
    `Check-in: ${formatDate(checkInDate, locale)}`,
    checkOutDate ? `Check-out: ${formatDate(checkOutDate, locale)}` : '',
    ``,
    `── CARGOS ──`,
    chargeRowsText,
    `${'─'.repeat(44)}`,
    `${'Subtotal'.padEnd(36)} ${fmt(totalCharges)}`,
    ``,
    activePayments.length > 0 ? `── PAGOS ──` : '',
    activePayments.length > 0 ? paymentRowsText : '',
    activePayments.length > 0 ? `${'─'.repeat(44)}` : '',
    activePayments.length > 0 ? `${'Total pagado'.padEnd(36)} -${fmt(totalPayments)}` : '',
    ``,
    `${'SALDO FINAL'.padEnd(36)} ${fmt(balance)}`,
    ``,
    `Gracias por hospedarte con nosotros. ¡Esperamos verte pronto!`,
  ].filter(l => l !== undefined && l !== null).join('\n');

  return applyLayout({
    hotelName: tenantName,
    logoUrl: tenantLogoUrl,
    bodyHtml,
    bodyText,
    customFooterHtml,
    customFooterText,
    locale,
  });
}
