/**
 * Account email verification template.
 * Used when an admin creates a new user or when a user changes their email.
 */

import { applyLayout, escapeHtml } from './layout';

export interface EmailVerificationParams {
  firstName: string;
  verifyUrl: string;
  tenantName?: string;
  tenantLogoUrl?: string;
  customFooterHtml?: string;
  customFooterText?: string;
}

export function renderEmailVerification(params: EmailVerificationParams): { html: string; text: string } {
  const {
    firstName,
    verifyUrl,
    tenantName = 'Pilloto',
    tenantLogoUrl,
    customFooterHtml,
    customFooterText,
  } = params;

  const safeUrl = escapeHtml(verifyUrl);

  const bodyHtml = `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
  <tr>
    <td style="padding:0 0 20px 0;">
      <h1 style="margin:0 0 8px 0;font-size:22px;color:#111111;text-align:center;">Verifica tu correo electrónico</h1>
      <p style="padding:20px 0 0 0;margin:0;font-size:15px;line-height:1.6;color:#555555;">
        Hola <strong>${escapeHtml(firstName)}</strong>, tu cuenta ha sido creada en <strong>${escapeHtml(tenantName)}</strong>.
        Por favor verifica tu correo electrónico para activar tu cuenta.
      </p>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding:0 0 24px 0;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background-color:#111111;border-radius:6px;">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
              Verificar Email
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:10px 0 12px 0;border-top:1px solid #f0f0f0;">
      <p style="margin:25px 0 15px;font-size:13px;color:#888888;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:
      </p>
      <p style="margin:0;font-size:12px;background-color:#f7f9fb;border:1px solid #e0e0e0;border-radius:4px;padding:10px 12px;word-break:break-all;color:#555555;">
        ${safeUrl}
      </p>
    </td>
  </tr>
  <tr>
    <td>
      <p style="margin:25px 0 0;font-size:13px;line-height:1.6;color:#aaaaaa;">
        Este enlace expira en <strong>24 horas</strong>.
        Si no creaste esta cuenta, puedes ignorar este correo con seguridad.
      </p>
    </td>
  </tr>
</table>`;

  const bodyText = `Verifica tu correo electrónico

Hola ${firstName},

Tu cuenta ha sido creada en ${tenantName}. Por favor verifica tu correo electrónico para activar tu cuenta haciendo clic en el siguiente enlace:

${verifyUrl}

Este enlace expira en 24 horas.
Si no creaste esta cuenta, puedes ignorar este correo con seguridad.`;

  return applyLayout({
    hotelName: tenantName,
    logoUrl: tenantLogoUrl,
    bodyHtml,
    bodyText,
    customFooterHtml,
    customFooterText,
  });
}
