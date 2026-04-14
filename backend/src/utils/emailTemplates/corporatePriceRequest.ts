/**
 * Corporate Price Request email template.
 * Sent to users with 'admin.reservations.assignCorporatePrice' permission
 * (or admins) when a reservation requests corporate pricing and the guest
 * is not pre-approved (no companyId on guest record).
 */

import { applyLayout, escapeHtml, formatCurrency, formatDate } from './layout';

export interface CorporatePriceRequestParams {
  reservation: any;
  guestName: string;
  guestEmail: string;
  /** Company name requested by the guest (if provided) */
  requestedCompanyName?: string;
  /** Tenant name (e.g. "Hotel Banana Ranch") */
  tenantName: string;
  /** Absolute URL for the tenant logo */
  tenantLogoUrl?: string;
  /** Tenant currency code (e.g. "DOP") */
  currency?: string;
  /** Absolute frontend URL for the approve action page */
  approveUrl: string;
  /** Absolute frontend URL for the decline action page */
  declineUrl: string;
  /** Tenant-customizable HTML footer (already sanitized) */
  customFooterHtml?: string;
  /** Tenant-customizable plain-text footer */
  customFooterText?: string;
  locale?: string;
}

export function renderCorporatePriceRequest(params: CorporatePriceRequestParams): { html: string; text: string } {
  const {
    reservation,
    guestName,
    guestEmail,
    requestedCompanyName,
    tenantName,
    tenantLogoUrl,
    currency = 'DOP',
    approveUrl,
    declineUrl,
    customFooterHtml,
    customFooterText,
    locale = 'es-DO',
  } = params;

  const resCode = reservation.reservationCode || reservation._id;
  const checkIn = reservation.checkInDate
    ? formatDate(new Date(reservation.checkInDate), locale)
    : '—';
  const checkOut = reservation.checkOutDate
    ? formatDate(new Date(reservation.checkOutDate), locale)
    : '—';
  const estimatedTotal = formatCurrency(reservation.estimatedTotal ?? 0, currency, locale);

  const typeLabel = reservation.type === 'room'
    ? 'Alojamiento'
    : reservation.type === 'daypass'
    ? 'Day Pass'
    : reservation.type === 'PasaTarde'
    ? 'Pasa Tarde'
    : 'Evento';

  // Discount info
  const discountAmount: number = reservation.discountAmount ?? 0;
  const discountPercent: number = reservation.discountPercent ?? 0;
  const hasDiscount = discountAmount > 0;
  const discountFormatted = formatCurrency(discountAmount, currency, locale);
  const originalTotal = hasDiscount
    ? formatCurrency((reservation.estimatedTotal ?? 0) + discountAmount, currency, locale)
    : null;

  const companyRow = requestedCompanyName
    ? `
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;width:140px;">Empresa solicitada</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;">${escapeHtml(requestedCompanyName)}</td>
      </tr>`
    : '';

  const discountRows = hasDiscount
    ? `
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;">Total sin descuento</td>
        <td style="padding:8px 0;font-size:14px;">${escapeHtml(originalTotal!)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;">Descuento aplicado</td>
        <td style="padding:8px 0;font-size:14px;color:#c62828;">−${escapeHtml(discountFormatted)}${discountPercent > 0 ? ` (${discountPercent}%)` : ''}</td>
      </tr>`
    : '';

  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#333;">Solicitud de Precio Corporativo</h2>
    <p style="margin:0 0 12px;font-size:14px;color:#555;line-height:1.5;">
      Se ha creado una reserva con una <strong>solicitud de precio corporativo</strong>. El huésped no está asociado
      aún a una empresa, por lo que se requiere tu aprobación.
    </p>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;width:140px;">Reserva</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;">${escapeHtml(String(resCode))}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;">Huésped</td>
        <td style="padding:8px 0;font-size:14px;">${escapeHtml(guestName)} (${escapeHtml(guestEmail)})</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;">Tipo</td>
        <td style="padding:8px 0;font-size:14px;">${escapeHtml(typeLabel)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;">Check-in</td>
        <td style="padding:8px 0;font-size:14px;">${escapeHtml(checkIn)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;">Check-out</td>
        <td style="padding:8px 0;font-size:14px;">${escapeHtml(checkOut)}</td>
      </tr>${companyRow}${discountRows}
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;">Total estimado</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;">${escapeHtml(estimatedTotal)}</td>
      </tr>
    </table>

    <p style="margin:16px 0 24px;font-size:14px;color:#555;line-height:1.5;">
      Si apruebas, el huésped será asociado a una empresa y las reglas de precio corporativo serán aplicadas
      a esta y futuras reservas. Puedes asignar la empresa específica desde el detalle de la reserva.
    </p>

    <!-- Action buttons -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
      <tr>
        <td align="center" style="padding:0 8px 0 0;">
          <a href="${escapeHtml(approveUrl)}" target="_blank"
             style="display:inline-block;padding:12px 32px;background-color:#2e7d32;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:6px;letter-spacing:0.3px;">
            &#10003; Aprobar
          </a>
        </td>
        <td align="center" style="padding:0 0 0 8px;">
          <a href="${escapeHtml(declineUrl)}" target="_blank"
             style="display:inline-block;padding:12px 32px;background-color:#c62828;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:6px;letter-spacing:0.3px;">
            &#10007; Rechazar
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:12px;color:#999;line-height:1.4;">
      Esta es una notificación automática de Pilloto. Si no esperabas este correo, verifica la reserva en el panel de administración.
    </p>
  `;

  const companyLine = requestedCompanyName ? `\nEmpresa solicitada: ${requestedCompanyName}` : '';
  const discountLine = hasDiscount
    ? `\nDescuento aplicado: −${discountFormatted}${discountPercent > 0 ? ` (${discountPercent}%)` : ''}\nTotal sin descuento: ${originalTotal}`
    : '';

  const bodyText = `SOLICITUD DE PRECIO CORPORATIVO

Se ha creado una reserva con una solicitud de precio corporativo. El huésped no está asociado aún a una empresa, por lo que se requiere tu aprobación.

Reserva: ${resCode}
Huésped: ${guestName} (${guestEmail})
Tipo: ${typeLabel}
Check-in: ${checkIn}
Check-out: ${checkOut}${companyLine}${discountLine}
Total estimado: ${estimatedTotal}

APROBAR: ${approveUrl}
RECHAZAR: ${declineUrl}

Si apruebas, el huésped será asociado a una empresa y las reglas de precio corporativo serán aplicadas.
`;

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
