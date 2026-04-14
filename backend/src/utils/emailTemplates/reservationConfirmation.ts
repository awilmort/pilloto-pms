/**
 * Reservation confirmation email template.
 * Handles all four reservation types: room, daypass, PasaTarde, event.
 */

import { applyLayout, escapeHtml, formatCurrency, formatDate } from './layout';

export interface ReservationConfirmationParams {
  reservation: any;
  /** Tenant name (e.g. "Hotel Banana Ranch") */
  tenantName: string;
  /** Tenant slug (e.g. "demo") — used to build the correct booking URL */
  tenantSlug?: string;
  /** Absolute URL for the tenant logo */
  tenantLogoUrl?: string;
  /** Tenant currency code (e.g. "DOP") */
  currency?: string;
  /** Tenant-customizable HTML footer (already sanitized) */
  customFooterHtml?: string;
  /** Tenant-customizable plain-text footer */
  customFooterText?: string;
  /** Optional reply-to address from tenant settings */
  replyTo?: string;
  locale?: string;
}

export function renderReservationConfirmation(params: ReservationConfirmationParams): { html: string; text: string } {
  const { reservation, tenantName, tenantSlug, tenantLogoUrl, currency = 'DOP', locale = 'es-DO', customFooterHtml, customFooterText } = params;

  // Build the base URL for the tenant:
  //   - Production: inject slug as subdomain  → https://demo.pilloto.com
  //   - Dev (localhost): keep base URL as-is, the tenant is resolved via header
  const rawBase = process.env.FRONTEND_URL || 'http://localhost:3000';
  let tenantBase = rawBase;
  if (tenantSlug) {
    try {
      const parsed = new URL(rawBase);
      const hostname = parsed.hostname;
      // Only inject subdomain when it's NOT already subdomain-qualified
      // and NOT localhost (localhost doesn't support subdomains reliably)
      if (hostname !== 'localhost' && !hostname.startsWith(`${tenantSlug}.`)) {
        parsed.hostname = `${tenantSlug}.${hostname}`;
        tenantBase = parsed.origin;
      }
    } catch {
      // fallback: use rawBase unchanged
    }
  }

  const reservationUrl = `${tenantBase}/booking/reservation/${reservation.reservationCode}${reservation.confirmationToken ? `?token=${reservation.confirmationToken}` : ''}`;

  const guestName =
    reservation.guestName?.firstName && reservation.guestName?.lastName
      ? `${reservation.guestName.firstName} ${reservation.guestName.lastName}`
      : reservation.user
        ? `${reservation.user.firstName} ${reservation.user.lastName}`
        : 'Huésped';

  const firstName =
    reservation.guestName?.firstName ||
    reservation.user?.firstName ||
    'Huésped';

  const checkInDate = formatDate(reservation.checkInDate, locale);
  const checkOutDate = reservation.checkOutDate ? formatDate(reservation.checkOutDate, locale) : null;

  const type = reservation.type as 'room' | 'daypass' | 'PasaTarde' | 'event';

  // ── Type-specific label & details ────────────────────────────────────────────
  let typeLabel = 'Reserva';
  let detailsHtml = '';
  let detailsText = '';

  if (type === 'room') {
    typeLabel = 'Reserva de habitación';
    const roomNames: string[] = [];
    if (reservation.rooms?.length) {
      reservation.rooms.forEach((r: any) => roomNames.push(typeof r === 'object' ? r.name : String(r)));
    } else if (reservation.room) {
      const r = reservation.room;
      roomNames.push(typeof r === 'object' ? r.name : String(r));
    }
    const roomsHtml = roomNames.length
      ? `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Habitación(es):</td><td style="padding:4px 0;font-size:14px;font-weight:bold;">${escapeHtml(roomNames.join(', '))}</td></tr>`
      : '';
    detailsHtml = `
      ${roomsHtml}
      <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Check-in:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(checkInDate)}</td></tr>
      <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Check-out:</td><td style="padding:4px 0;font-size:14px;">${checkOutDate ? escapeHtml(checkOutDate) : 'N/D'}</td></tr>
      <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Noches:</td><td style="padding:4px 0;font-size:14px;">${reservation.totalNights ?? '—'}</td></tr>`;
    detailsText = [
      roomNames.length ? `Habitación(es): ${roomNames.join(', ')}` : '',
      `Check-in: ${checkInDate}`,
      `Check-out: ${checkOutDate ?? 'N/D'}`,
      `Noches: ${reservation.totalNights ?? '—'}`,
    ].filter(Boolean).join('\n');
  } else if (type === 'daypass') {
    typeLabel = 'Day Pass';
    detailsHtml = `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Fecha de visita:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(checkInDate)}</td></tr>`;
    detailsText = `Fecha de visita: ${checkInDate}`;
  } else if (type === 'PasaTarde') {
    typeLabel = 'Pasa Tarde';
    detailsHtml = `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Fecha de visita:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(checkInDate)}</td></tr>`;
    detailsText = `Fecha de visita: ${checkInDate}`;
  } else if (type === 'event') {
    typeLabel = 'Reserva de evento';
    const eventTypeLabel = reservation.eventTypeName || reservation.eventType || 'Evento';
    detailsHtml = `
      <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Tipo de evento:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(eventTypeLabel)}</td></tr>
      <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Fecha del evento:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(checkInDate)}</td></tr>
      ${checkOutDate ? `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Fecha de finalización:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(checkOutDate)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Asistentes:</td><td style="padding:4px 0;font-size:14px;">${reservation.expectedAttendees || reservation.guests || '—'}</td></tr>
      ${reservation.eventDescription ? `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Descripción:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(reservation.eventDescription)}</td></tr>` : ''}`;
    detailsText = [
      `Tipo de evento: ${eventTypeLabel}`,
      `Fecha del evento: ${checkInDate}`,
      checkOutDate ? `Fecha de finalización: ${checkOutDate}` : '',
      `Asistentes: ${reservation.expectedAttendees || reservation.guests || '—'}`,
      reservation.eventDescription ? `Descripción: ${reservation.eventDescription}` : '',
    ].filter(Boolean).join('\n');
  }

  const totalFormatted = formatCurrency((reservation as any).estimatedTotal ?? reservation.totalPrice ?? 0, currency, locale);
  const contactEmail = reservation.contactInfo?.email ?? '';
  const contactPhone = reservation.contactInfo?.phone ?? '';
  const adults = reservation.guestDetails?.adults ?? 0;
  const children = reservation.guestDetails?.children ?? 0;
  const infants = reservation.guestDetails?.infants ?? 0;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:20px;font-weight:bold;color:#2E7D32;">✓ ¡${escapeHtml(typeLabel)} confirmada!</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555555;">Hola <strong>${escapeHtml(firstName)}</strong>, tu reserva ha sido confirmada en <strong>${escapeHtml(tenantName)}</strong>.</p>

    <!-- Summary box -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#fafafa;border-left:4px solid #dddddd;border-radius:4px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 12px;font-size:15px;font-weight:bold;color:#111111;">${escapeHtml(typeLabel)}</p>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          ${detailsHtml}
          <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Huésped:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(guestName)}</td></tr>
          <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Acompañantes:</td><td style="padding:4px 0;font-size:14px;">${adults} adultos, ${children} niños, ${infants} bebés</td></tr>
          ${contactEmail ? `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Contacto:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(contactEmail)} | ${escapeHtml(contactPhone)}</td></tr>` : ''}
          ${reservation.specialRequests ? `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Solicitudes:</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(reservation.specialRequests)}</td></tr>` : ''}
          <tr><td colspan="2" style="padding:12px 0 4px;border-top:1px solid #e0e0e0;"></td></tr>
          <tr><td style="padding:4px 0;color:#666666;font-size:14px;">Total:</td><td style="padding:4px 0;font-size:18px;font-weight:bold;color:#111111;">${escapeHtml(totalFormatted)}</td></tr>
          ${reservation.reservationCode ? `<tr><td style="padding:4px 0;color:#666666;font-size:14px;">Código:</td><td style="padding:4px 0;font-size:14px;font-family:monospace;letter-spacing:1px;">${escapeHtml(reservation.reservationCode)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <!-- CTA button -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
      <tr><td align="center">
        <a href="${reservationUrl}" target="_blank" rel="noopener noreferrer"
           style="display:inline-block;padding:12px 32px;background-color:#111111;color:#ffffff;text-decoration:none;border-radius:4px;font-size:15px;font-weight:bold;">
          Ver reserva
        </a>
      </td></tr>
    </table>

    <!-- Information bullets -->
    <p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#333333;">Información importante:</p>
    <ul style="margin:0;padding-left:20px;font-size:14px;color:#555555;line-height:1.7;">
      <li>Presenta una identificación válida al momento del check-in.</li>
      <li>Las cancelaciones deben realizarse con al menos 24 horas de anticipación.</li>
      <li>¿Tienes alguna pregunta? Contáctanos respondiendo este correo.</li>
    </ul>`;

  const bodyText = [
    `¡${typeLabel} confirmada!`,
    ``,
    `Hola ${firstName}, tu reserva ha sido confirmada en ${tenantName}.`,
    ``,
    `── RESUMEN DE RESERVA ──`,
    detailsText,
    `Huésped: ${guestName}`,
    `Acompañantes: ${adults} adultos, ${children} niños, ${infants} bebés`,
    contactEmail ? `Contacto: ${contactEmail} | ${contactPhone}` : '',
    reservation.specialRequests ? `Solicitudes: ${reservation.specialRequests}` : '',
    `Total: ${totalFormatted}`,
    reservation.reservationCode ? `Código: ${reservation.reservationCode}` : '',
    ``,
    `Ver reserva: ${reservationUrl}`,
    ``,
    `── INFORMACIÓN IMPORTANTE ──`,
    `• Presenta una identificación válida al momento del check-in.`,
    `• Las cancelaciones deben realizarse con al menos 24 horas de anticipación.`,
    `• ¿Preguntas? Contáctanos respondiendo este correo.`,
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
