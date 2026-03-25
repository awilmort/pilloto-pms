/**
 * print.ts
 *
 * Enterprise PMS print utilities.
 * Generates professional hotel documents and sends them to the browser's
 * print dialog via a new window.
 *
 * Documents:
 *  1. Reservation Confirmation
 *  2. Folio / Invoice  (itemised charges + payments)
 *  3. Single Payment Receipt  (per-transaction)
 *  4. Payment Summary  (all payments for a reservation)
 */
import { formatMoney } from './currency';
import i18n from '../i18n';

// ─── Public types ──────────────────────────────────────────────────────────

export interface PrintHotelInfo {
  name: string;
  logoUrl?: string;
}

// i18n shorthand – resolves against the current app language at print time
function pt(key: string): string {
  return i18n.t(`admin.printing.docs.${key}`);
}

// ─── Core engine ───────────────────────────────────────────────────────────

export function printDocument(html: string): void {
  const win = window.open('', '_blank', 'width=960,height=720,scrollbars=yes,resizable=yes');
  if (!win) {
    // eslint-disable-next-line no-alert
    alert(pt('popupBlocked'));
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Allow images / fonts to load before triggering the print dialog
  setTimeout(() => {
    win.focus();
    win.print();
    win.addEventListener('afterprint', () => win.close());
  }, 350);
}

// ─── Shared HTML helpers ───────────────────────────────────────────────────

function baseStyles(): string {
  return `<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 12px;
      color: #1a1a1a;
      background: #fff;
      padding: 32px 40px;
    }
    .hdr {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #1a1a1a;
    }
    .hotel-name { font-size: 21px; font-weight: 700; letter-spacing: 0.5px; }
    .hotel-logo { max-height: 58px; max-width: 180px; object-fit: contain; }
    .doc-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      margin-bottom: 3px;
      text-align: right;
    }
    .doc-meta { font-size: 11px; color: #666; text-align: right; }
    .sec { margin-top: 20px; }
    .sec-lbl {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 6px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 3px;
    }
    .ig { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 28px; }
    .ir { font-size: 12px; line-height: 1.65; }
    .il { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    thead th {
      background: #f4f4f4;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid #ccc;
    }
    tbody td { padding: 6px 8px; border-bottom: 1px solid #ededed; vertical-align: top; }
    tbody tr:last-child td { border-bottom: none; }
    .tr { text-align: right; }
    .tc { text-align: center; }
    .tt { margin-top: 12px; border-top: 2px solid #1a1a1a; font-size: 12px; }
    .tt td { padding: 4px 8px; }
    .tt-grand td { font-size: 14px; font-weight: 700; padding: 8px; border-top: 1px solid #1a1a1a; }
    .badge {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .b-ok  { background: #d4edda; color: #155724; }
    .b-warn { background: #fff3cd; color: #856404; }
    .b-info { background: #d1ecf1; color: #0c5460; }
    .b-def  { background: #e2e3e5; color: #383d41; }
    .ftr {
      margin-top: 36px;
      padding-top: 12px;
      border-top: 1px solid #e0e0e0;
      font-size: 10px;
      color: #999;
      text-align: center;
    }
    .hbox {
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 14px 18px;
      margin-top: 16px;
    }
    .amt-lg { font-size: 26px; font-weight: 700; }
    hr.dashed { border: none; border-top: 1px dashed #ccc; margin: 16px 0; }
    @media print {
      body { padding: 0; }
      @page { margin: 18mm 14mm; }
    }
  </style>`;
}

function wrapPage(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  ${baseStyles()}
</head>
<body>${body}</body>
</html>`;
}

function hdr(hotel: PrintHotelInfo, docTitle: string, subLine: string): string {
  const logoOrName = hotel.logoUrl
    ? `<img src="${esc(hotel.logoUrl)}" class="hotel-logo" alt="${esc(hotel.name)}">`
    : `<div class="hotel-name">${esc(hotel.name)}</div>`;
  return `
    <div class="hdr">
      <div>${logoOrName}</div>
      <div>
        <div class="doc-title">${docTitle}</div>
        <div class="doc-meta">${subLine}</div>
      </div>
    </div>`;
}

function ftr(hotelName: string): string {
  return `<div class="ftr">${esc(hotelName)} &bull; ${pt('printedOn')} ${new Date().toLocaleString()}</div>`;
}

function esc(s?: string | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fm(v?: number): string { return formatMoney(v ?? 0); }

function fd(d?: string): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

function fdt(d?: string): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(); } catch { return d; }
}

function badge(status: string): string {
  const cls: Record<string, string> = {
    confirmed: 'b-ok',  completed: 'b-ok',
    'checked-in': 'b-info', in_house: 'b-info', pre_arrival: 'b-warn',
    pending: 'b-warn',  cancelled: 'b-def',  closed: 'b-def',
  };
  return `<span class="badge ${cls[status] ?? 'b-def'}">${esc(status)}</span>`;
}

function methodLbl(m: string): string {
  const map: Record<string, string> = {
    cash: pt('methods.cash'),
    card: pt('methods.card'),
    transfer: pt('methods.transfer'),
    check: pt('methods.check'),
    credit: pt('methods.credit'),
  };
  return map[m] ?? m;
}

function guestName(res: any): string {
  if (res.guestName?.firstName)
    return `${res.guestName.firstName} ${res.guestName.lastName ?? ''}`.trim();
  if (typeof res.user === 'object' && res.user?.firstName)
    return `${res.user.firstName} ${res.user.lastName ?? ''}`.trim();
  return res.guestName ?? '—';
}

function roomsStr(res: any): string {
  if (Array.isArray(res.rooms) && res.rooms.length > 0)
    return res.rooms
      .map((r: any) => (typeof r === 'object' ? r.number ?? r.name ?? r._id : r))
      .join(', ');
  if (res.room)
    return typeof res.room === 'object' ? res.room.number ?? res.room.name ?? '' : String(res.room);
  return '—';
}

function cashierStr(createdBy: any): string {
  if (!createdBy) return '—';
  return typeof createdBy === 'object'
    ? `${createdBy.firstName ?? ''} ${createdBy.lastName ?? ''}`.trim() || '—'
    : String(createdBy);
}

// ─── 1. Reservation Confirmation ──────────────────────────────────────────

export function printConfirmation(reservation: any, hotel: PrintHotelInfo): void {
  const guest = guestName(reservation);
  const nights = reservation.totalNights
    ?? (reservation.checkOutDate
      ? Math.ceil(
          (new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime())
          / 86_400_000,
        )
      : null);

  const body = `
    ${hdr(hotel, pt('confirmation.title'), `${pt('confirmation.issued')}: ${fdt(reservation.createdAt)}`)}

    <div class="sec">
      <div class="sec-lbl">${pt('confirmation.reservationSection')}</div>
      <div class="ig">
        <div class="ir"><span class="il">${pt('fields.code')}:</span> ${esc(reservation.reservationCode ?? '—')}</div>
        <div class="ir"><span class="il">${pt('fields.status')}:</span> ${badge(reservation.status)}</div>
        <div class="ir"><span class="il">${pt('fields.type')}:</span> ${esc(reservation.type)}</div>
        ${reservation.isCorporate && reservation.company
          ? `<div class="ir"><span class="il">${pt('fields.company')}:</span> ${esc(typeof reservation.company === 'object' ? reservation.company.name : String(reservation.company))}</div>`
          : ''}
      </div>
    </div>

    <div class="sec">
      <div class="sec-lbl">${pt('confirmation.guestSection')}</div>
      <div class="ig">
        <div class="ir"><span class="il">${pt('fields.name')}:</span> ${esc(guest)}</div>
        <div class="ir"><span class="il">${pt('fields.email')}:</span> ${esc(reservation.contactInfo?.email || '—')}</div>
        <div class="ir"><span class="il">${pt('fields.phone')}:</span> ${esc(reservation.contactInfo?.phone || '—')}</div>
        ${reservation.contactInfo?.country
          ? `<div class="ir"><span class="il">${pt('fields.country')}:</span> ${esc(reservation.contactInfo.country)}</div>`
          : ''}
      </div>
    </div>

    <div class="sec">
      <div class="sec-lbl">${pt('confirmation.staySection')}</div>
      <div class="ig">
        <div class="ir"><span class="il">${pt('fields.checkIn')}:</span> ${fd(reservation.checkInDate)}</div>
        <div class="ir"><span class="il">${pt('fields.checkOut')}:</span> ${reservation.checkOutDate ? fd(reservation.checkOutDate) : '—'}</div>
        ${nights != null ? `<div class="ir"><span class="il">${pt('fields.nights')}:</span> ${nights}</div>` : ''}
        <div class="ir"><span class="il">${pt('fields.rooms')}:</span> ${esc(roomsStr(reservation))}</div>
        <div class="ir"><span class="il">${pt('fields.adults')}:</span> ${reservation.guestDetails?.adults ?? reservation.guests ?? '—'}</div>
        <div class="ir"><span class="il">${pt('fields.children')}:</span> ${reservation.guestDetails?.children ?? 0}</div>
        ${reservation.guestDetails?.infants
          ? `<div class="ir"><span class="il">${pt('fields.infants')}:</span> ${reservation.guestDetails.infants}</div>`
          : ''}
      </div>
    </div>

    <div class="hbox" style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600">${pt('confirmation.estimatedTotal')}</span>
      <span class="amt-lg">${fm(reservation.estimatedTotal ?? reservation.totalPrice)}</span>
    </div>

    ${reservation.specialRequests ? `
    <div class="sec">
      <div class="sec-lbl">${pt('confirmation.specialRequests')}</div>
      <div class="ir" style="white-space:pre-wrap;padding:8px 10px;background:#fafafa;border:1px solid #e0e0e0;border-radius:3px;margin-top:6px">${esc(reservation.specialRequests)}</div>
    </div>` : ''}

    ${reservation.confirmationToken ? `
    <div class="sec">
      <div class="ir" style="font-size:11px;color:#666">${pt('confirmation.confirmationToken')}: <strong>${esc(reservation.confirmationToken)}</strong></div>
    </div>` : ''}

    ${ftr(hotel.name)}`;

  printDocument(wrapPage(body));
}

// ─── 2. Folio / Invoice ────────────────────────────────────────────────────

export function printFolio(
  reservation: any,
  charges: any[],
  payments: any[],
  summary: any,
  hotel: PrintHotelInfo,
): void {
  const guest = guestName(reservation);
  const isPreArrival = summary.stage === 'pre_arrival';
  const balanceDue = isPreArrival
    ? Math.max(0, summary.balanceOnArrival ?? 0)
    : Math.max(0, summary.balance ?? 0);

  const chargeRows = charges.map(c => `
    <tr>
      <td>${fdt(c.createdAt)}</td>
      <td>${esc(c.description)}</td>
      <td>${esc(c.category ?? '—')}</td>
      <td>${esc(c.type ?? 'base')}</td>
      <td class="tr">${fm(c.amount)}</td>
    </tr>`).join('');

  const paymentRows = payments
    .filter(p => p.status !== 'reversed')
    .map(p => `
      <tr>
        <td>${fdt(p.createdAt)}</td>
        <td>${esc(methodLbl(p.method))}</td>
        <td>${esc(p.reference || p.note || '—')}</td>
        <td>${esc(cashierStr(p.createdBy))}</td>
        <td class="tr">${fm(p.amount)}</td>
      </tr>`)
    .join('');

  const body = `
    ${hdr(hotel, pt('folio.title'), `${pt('fields.date')}: ${new Date().toLocaleDateString()}`)}

    <div class="sec">
      <div class="ig">
        <div class="ir"><span class="il">${pt('fields.guest')}:</span> ${esc(guest)}</div>
        <div class="ir"><span class="il">${pt('fields.reservation')}:</span> ${esc(reservation.reservationCode ?? '—')}</div>
        <div class="ir"><span class="il">${pt('fields.email')}:</span> ${esc(reservation.contactInfo?.email || '—')}</div>
        <div class="ir"><span class="il">${pt('fields.phone')}:</span> ${esc(reservation.contactInfo?.phone || '—')}</div>
        <div class="ir"><span class="il">${pt('fields.checkIn')}:</span> ${fd(reservation.checkInDate)}</div>
        <div class="ir"><span class="il">${pt('fields.checkOut')}:</span> ${reservation.checkOutDate ? fd(reservation.checkOutDate) : '—'}</div>
        <div class="ir"><span class="il">${pt('fields.rooms')}:</span> ${esc(roomsStr(reservation))}</div>
        <div class="ir"><span class="il">${pt('fields.status')}:</span> ${badge(reservation.status)}</div>
      </div>
    </div>

    <div class="sec">
      <div class="sec-lbl">${pt('folio.chargesSection')}</div>
      <table>
        <thead>
          <tr>
            <th>${pt('fields.dateTime')}</th>
            <th>${pt('fields.description')}</th>
            <th>${pt('fields.category')}</th>
            <th>${pt('fields.type')}</th>
            <th class="tr">${pt('fields.amount')}</th>
          </tr>
        </thead>
        <tbody>
          ${chargeRows || `<tr><td colspan="5" class="tc" style="color:#888;padding:12px">${pt('folio.noCharges')}</td></tr>`}
        </tbody>
      </table>
      <table class="tt" style="width:auto;margin-left:auto">
        <tbody>
          <tr><td style="padding-right:28px;font-weight:600">${pt('folio.totalCharges')}</td><td class="tr">${fm(summary.totalCharges)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="sec">
      <div class="sec-lbl">${pt('folio.paymentsSection')}</div>
      <table>
        <thead>
          <tr>
            <th>${pt('fields.dateTime')}</th>
            <th>${pt('fields.method')}</th>
            <th>${pt('fields.referenceNote')}</th>
            <th>${pt('fields.cashier')}</th>
            <th class="tr">${pt('fields.amount')}</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows || `<tr><td colspan="5" class="tc" style="color:#888;padding:12px">${pt('folio.noPayments')}</td></tr>`}
        </tbody>
      </table>
      <table class="tt" style="width:auto;margin-left:auto">
        <tbody>
          <tr><td style="padding-right:28px;font-weight:600">${pt('folio.totalPayments')}</td><td class="tr">${fm(summary.totalPayments)}</td></tr>
        </tbody>
      </table>
    </div>

    <div style="margin-top:24px">
      <table class="tt" style="width:300px;margin-left:auto">
        <tbody>
          <tr><td>${pt('folio.estimatedTotal')}</td><td class="tr">${fm(summary.estimatedTotal)}</td></tr>
          <tr><td>${pt('folio.totalCharges')}</td><td class="tr">${fm(summary.totalCharges)}</td></tr>
          <tr><td>${pt('folio.totalPayments')}</td><td class="tr">${fm(summary.totalPayments)}</td></tr>
        </tbody>
        <tbody>
          <tr class="tt-grand">
            <td>${isPreArrival ? pt('folio.balanceOnArrival') : pt('folio.balanceDue')}</td>
            <td class="tr">${fm(balanceDue)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    ${ftr(hotel.name)}`;

  printDocument(wrapPage(body));
}

// ─── 3. Single Payment Receipt ─────────────────────────────────────────────

export function printPaymentReceipt(
  payment: any,
  reservation: any,
  currentBalance: number,
  cashierName: string,
  hotel: PrintHotelInfo,
): void {
  const receiptNo = String(payment._id ?? '').slice(-8).toUpperCase();
  const isDeposit = payment.paymentStage === 'deposit';
  const guest = guestName(reservation);

  const body = `
    ${hdr(hotel, pt('receipt.title'), `${pt('receipt.receiptNo')}: ${esc(receiptNo)}`)}

    <hr class="dashed">

    <div class="ig" style="margin-bottom:14px">
      <div class="ir"><span class="il">${pt('fields.date')}:</span> ${fdt(payment.createdAt)}</div>
      <div class="ir"><span class="il">${pt('fields.cashier')}:</span> ${esc(cashierName)}</div>
      <div class="ir"><span class="il">${pt('fields.reservation')}:</span> ${esc(reservation.reservationCode ?? '—')}</div>
      <div class="ir"><span class="il">${pt('fields.guest')}:</span> ${esc(guest)}</div>
    </div>

    <div class="hbox" style="text-align:center">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#666;margin-bottom:8px">
        ${isDeposit ? pt('receipt.depositReceived') : pt('receipt.amountReceived')}
      </div>
      <div class="amt-lg">${fm(payment.amount)}</div>
      <div style="margin-top:10px;font-size:14px;font-weight:600">${esc(methodLbl(payment.method))}</div>
      ${payment.reference ? `<div style="margin-top:4px;font-size:11px;color:#666">${pt('receipt.ref')}: ${esc(payment.reference)}</div>` : ''}
      ${payment.note ? `<div style="margin-top:4px;font-size:11px;color:#666">${pt('receipt.note')}: ${esc(payment.note)}</div>` : ''}
    </div>

    <hr class="dashed">

    <div class="ig">
      ${isDeposit
        ? `<div class="ir"><span class="il">${pt('fields.type')}:</span> ${pt('receipt.preArrivalDeposit')}</div>`
        : `<div class="ir"><span class="il">${pt('receipt.balanceAfter')}:</span> ${fm(currentBalance)}</div>`}
      <div class="ir"><span class="il">${pt('fields.status')}:</span> ${badge(payment.status ?? 'completed')}</div>
    </div>

    ${ftr(hotel.name)}`;

  printDocument(wrapPage(body));
}

// ─── 4. Payment Summary ────────────────────────────────────────────────────

export function printPaymentSummary(
  payments: any[],
  reservation: any,
  charges: any[],
  summary: any,
  cashierName: string,
  hotel: PrintHotelInfo,
): void {
  const guest = guestName(reservation);
  const isPreArrival = summary.stage === 'pre_arrival';
  const balanceDue = isPreArrival
    ? Math.max(0, summary.balanceOnArrival ?? 0)
    : Math.max(0, summary.balance ?? 0);

  const paymentRows = payments.map((p, i) => {
    const stageLabel = p.paymentStage === 'deposit' ? pt('stages.deposit') : pt('stages.payment');
    const reversed = p.status === 'reversed';
    return `
      <tr ${reversed ? 'style="opacity:.5"' : ''}>
        <td>${i + 1}</td>
        <td>${fdt(p.createdAt)}</td>
        <td>${esc(methodLbl(p.method))}</td>
        <td>${esc(p.reference || '—')}</td>
        <td>${esc(cashierStr(p.createdBy))}</td>
        <td><span class="badge b-info">${esc(stageLabel)}</span></td>
        <td><span class="badge ${reversed ? 'b-def' : 'b-ok'}">${esc(p.status ?? 'completed')}</span></td>
        <td class="tr">${reversed ? `<s>${fm(p.amount)}</s>` : fm(p.amount)}</td>
      </tr>`;
  }).join('');

  const totalChargesFromList = charges.reduce((s, c) => s + Number(c.amount ?? 0), 0);

  const body = `
    ${hdr(
      hotel,
      pt('paymentSummary.title'),
      `${pt('paymentSummary.generated')}: ${new Date().toLocaleString()} &bull; ${pt('paymentSummary.printedBy')}: ${esc(cashierName)}`,
    )}

    <div class="sec">
      <div class="ig">
        <div class="ir"><span class="il">${pt('fields.guest')}:</span> ${esc(guest)}</div>
        <div class="ir"><span class="il">${pt('fields.reservation')}:</span> ${esc(reservation.reservationCode ?? '—')}</div>
        <div class="ir"><span class="il">${pt('fields.checkIn')}:</span> ${fd(reservation.checkInDate)}</div>
        <div class="ir"><span class="il">${pt('fields.checkOut')}:</span> ${reservation.checkOutDate ? fd(reservation.checkOutDate) : '—'}</div>
        <div class="ir"><span class="il">${pt('fields.rooms')}:</span> ${esc(roomsStr(reservation))}</div>
        <div class="ir"><span class="il">${pt('fields.status')}:</span> ${badge(reservation.status)}</div>
      </div>
    </div>

    <div class="sec">
      <div class="sec-lbl">${pt('paymentSummary.paymentHistorySection')}</div>
      <table>
        <thead>
          <tr>
            <th>${pt('fields.num')}</th>
            <th>${pt('fields.dateTime')}</th>
            <th>${pt('fields.method')}</th>
            <th>${pt('fields.reference')}</th>
            <th>${pt('fields.cashier')}</th>
            <th>${pt('fields.type')}</th>
            <th>${pt('fields.status')}</th>
            <th class="tr">${pt('fields.amount')}</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows || `<tr><td colspan="8" class="tc" style="color:#888;padding:12px">${pt('paymentSummary.noPayments')}</td></tr>`}
        </tbody>
      </table>
    </div>

    <div style="margin-top:24px">
      <table class="tt" style="width:320px;margin-left:auto">
        <tbody>
          <tr><td>${pt('paymentSummary.estimatedTotal')}</td><td class="tr">${fm(summary.estimatedTotal)}</td></tr>
          <tr><td>${pt('paymentSummary.totalCharges')}</td><td class="tr">${fm(summary.totalCharges || totalChargesFromList)}</td></tr>
          <tr><td>${pt('paymentSummary.totalPayments')}</td><td class="tr">${fm(summary.totalPayments)}</td></tr>
          ${summary.depositTotal > 0
            ? `<tr><td style="padding-left:16px;color:#666">&mdash; ${pt('paymentSummary.ofWhichDeposits')}</td><td class="tr">${fm(summary.depositTotal)}</td></tr>`
            : ''}
        </tbody>
        <tbody>
          <tr class="tt-grand">
            <td>${isPreArrival ? pt('paymentSummary.balanceOnArrival') : pt('paymentSummary.balanceDue')}</td>
            <td class="tr">${fm(balanceDue)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    ${ftr(hotel.name)}`;

  printDocument(wrapPage(body));
}
