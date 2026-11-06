/**
 * Channel alert digest: the new critical channel-manager alerts of one property, sent to the
 * users who can resolve them (at most one email per 15 minutes, services/channex/alerts.service.ts).
 * White-label: never names the channel-manager provider.
 */

import { applyLayout, escapeHtml } from './layout';

export interface ChannelAlertDigestItem {
  type: string;
  params: Record<string, unknown>;
  createdAt: Date;
}

export interface ChannelAlertDigestParams {
  tenantName: string;
  alertsUrl: string;
  alerts: ChannelAlertDigestItem[];
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const booking = (p: Record<string, unknown>) =>
  [s(p.otaName), s(p.otaReservationCode) || s(p.reservationCode), p.guestName ? `(${s(p.guestName)})` : ''].filter(Boolean).join(' ');
const channel = (p: Record<string, unknown>) => s(p.channelName) || 'un canal';

/** One line in Spanish per alert type (the app shows the full explanation). */
export function digestLine(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'overbooking': return `Sobreventa: ${booking(p) || 'una reserva de canal'} no tiene habitación libre ${Array.isArray(p.nights) ? `en ${p.nights.length} noche(s)` : ''}.`.replace(' .', '.');
    case 'unmapped_booking': return `Reserva sin habitación asignada: ${booking(p) || 'una reserva de canal'} llegó para una habitación o tarifa no enlazada.`;
    case 'non_acked_booking': return 'Una reserva de canal todavía no se ha recibido en Pilloto.';
    case 'sync_error': return `${channel(p)} reportó un error con tus precios o disponibilidad.`;
    case 'push_failing': return 'Pilloto no puede enviar cambios a tus canales; está reintentando.';
    case 'channel_disconnected': return `${channel(p)} se desconectó.`;
    case 'listing_disconnected': return `Un anuncio de ${channel(p)} se desconectó.`;
    case 'channel_removal_warning': return `${channel(p)} está desactivado y se eliminará pronto.`;
    case 'property_removal_warning': return 'Tu Channel Manager se eliminará pronto porque no tiene canales conectados.';
    case 'airbnb_reservation_request': return `Solicitud de reserva en Airbnb${p.guestName ? ` de ${s(p.guestName)}` : ''}: respóndela en 24 horas.`;
    case 'airbnb_alteration_request': return `Solicitud de cambio en Airbnb${p.guestName ? ` de ${s(p.guestName)}` : ''}: respóndela en 24 horas.`;
    case 'airbnb_inquiry': return `Consulta de un huésped en Airbnb${p.guestName ? ` (${s(p.guestName)})` : ''}: respóndela en 24 horas.`;
    default: return 'Hay un problema con tus canales que necesita atención.';
  }
}

export function renderChannelAlertDigest(params: ChannelAlertDigestParams): { subject: string; html: string; text: string } {
  const { tenantName, alertsUrl, alerts } = params;
  const lines = alerts.map((a) => digestLine(a.type, a.params));
  const subject = alerts.length === 1
    ? `Alerta del Channel Manager — ${tenantName}`
    : `${alerts.length} alertas del Channel Manager — ${tenantName}`;
  const safeUrl = escapeHtml(alertsUrl);

  const bodyHtml = `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
  <tr>
    <td style="padding:0 0 16px 0;">
      <h1 style="margin:0 0 8px 0;font-size:20px;color:#121A33;">Tus canales necesitan atención</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#555555;">
        ${alerts.length === 1 ? 'Hay una alerta crítica nueva' : `Hay ${alerts.length} alertas críticas nuevas`} en <strong>${escapeHtml(tenantName)}</strong>:
      </p>
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 24px 0;">
      <ul style="margin:0;padding:0 0 0 20px;font-size:14px;line-height:1.7;color:#333333;">
        ${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('\n        ')}
      </ul>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding:0 0 24px 0;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background-color:#121A33;border-radius:6px;">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">
              Ver alertas de canales
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#aaaaaa;">
        Recibes este correo porque puedes resolver alertas de canales. Te enviamos como máximo un correo cada 15 minutos.
      </p>
    </td>
  </tr>
</table>`;

  const bodyText = `Tus canales necesitan atención

${alerts.length === 1 ? 'Hay una alerta crítica nueva' : `Hay ${alerts.length} alertas críticas nuevas`} en ${tenantName}:

${lines.map((l) => `- ${l}`).join('\n')}

Ver alertas de canales: ${alertsUrl}

Recibes este correo porque puedes resolver alertas de canales. Te enviamos como máximo un correo cada 15 minutos.`;

  const { html, text } = applyLayout({ hotelName: tenantName, bodyHtml, bodyText });
  return { subject, html, text };
}
