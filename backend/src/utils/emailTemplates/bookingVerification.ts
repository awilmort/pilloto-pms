/**
 * Booking verification email — sends a 4-digit code to the guest
 * for email ownership proof before finalizing a public reservation.
 */

import { applyLayout, escapeHtml } from './layout';

export interface BookingVerificationEmailParams {
  code: string;
  email: string;
  tenantName: string;
  tenantLogoUrl?: string;
  customFooterHtml?: string;
  customFooterText?: string;
  locale?: string;
}

export function renderBookingVerification(params: BookingVerificationEmailParams): { html: string; text: string } {
  const {
    code,
    email,
    tenantName,
    tenantLogoUrl,
    customFooterHtml,
    customFooterText,
    locale = 'es-ES',
  } = params;

  const bodyHtml = `
<tr>
  <td style="padding:30px 40px 10px 40px;">
    <h1 style="margin:0 0 10px 0;font-size:22px;color:#111111;">Código de verificación</h1>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#555555;">
      ¡Ya casi terminas! Usa el código de abajo para verificar tu correo electrónico
      y confirmar tu reserva en <strong>${escapeHtml(tenantName)}</strong>.
    </p>
  </td>
</tr>
<tr>
  <td align="center" style="padding:10px 40px 10px 40px;">
    <div style="display:inline-block;background-color:#fafafa;border:2px solid #dddddd;border-radius:10px;padding:20px 40px;">
      <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#111111;font-family:monospace;">${escapeHtml(code)}</span>
    </div>
  </td>
</tr>
<tr>
  <td style="padding:20px 40px 10px 40px;">
    <p style="margin:0 0 10px 0;font-size:14px;line-height:1.6;color:#777777;">
      Este código es válido por <strong>15 minutos</strong>. No lo compartas con nadie.
    </p>
    <p style="margin:0 0 10px 0;font-size:14px;line-height:1.6;color:#777777;">
      Si no solicitaste esto, puedes ignorar este correo sin problema.
    </p>
  </td>
</tr>`;

  const bodyText = `Código de verificación: ${code}

Usa este código para verificar tu correo y confirmar tu reserva en ${tenantName}.

Este código es válido por 15 minutos. No lo compartas con nadie.

Si no solicitaste esto, puedes ignorar este correo sin problema.`;

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
