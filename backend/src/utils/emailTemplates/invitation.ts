/**
 * Invitation template: a new user (a tenant's owner or a staff member) chooses their first
 * password from the emailed link. No password is ever sent by email.
 */

import { applyLayout, escapeHtml } from './layout';

export interface InvitationParams {
  firstName: string;
  setPasswordUrl: string;
  /** The property the account belongs to */
  tenantName?: string;
  /** Owner of a newly created tenant (vs. a staff member added later) */
  isOwner?: boolean;
  expiresInHours: number;
  tenantLogoUrl?: string;
  customFooterHtml?: string;
  customFooterText?: string;
}

export function renderInvitation(params: InvitationParams): { html: string; text: string } {
  const {
    firstName, setPasswordUrl, tenantName = 'Pilloto', isOwner = false, expiresInHours,
    tenantLogoUrl, customFooterHtml, customFooterText,
  } = params;

  const safeUrl = escapeHtml(setPasswordUrl);
  const intro = isOwner
    ? `Tu cuenta de Pilloto para <strong>${escapeHtml(tenantName)}</strong> está lista. Eres el administrador principal de la propiedad.`
    : `Te agregaron como usuario de <strong>${escapeHtml(tenantName)}</strong> en Pilloto.`;
  const introText = isOwner
    ? `Tu cuenta de Pilloto para ${tenantName} está lista. Eres el administrador principal de la propiedad.`
    : `Te agregaron como usuario de ${tenantName} en Pilloto.`;

  const bodyHtml = `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
  <tr>
    <td style="padding:0 0 20px 0;">
      <h1 style="margin:0 0 8px 0;font-size:22px;color:#111111;text-align:center;">Bienvenido a Pilloto</h1>
      <p style="padding:20px 0 0 0;margin:0;font-size:15px;line-height:1.6;color:#555555;">
        Hola <strong>${escapeHtml(firstName)}</strong>. ${intro}
        Elige tu contraseña para entrar por primera vez.
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
              Elegir mi contraseña
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
        Este enlace funciona una sola vez y expira en <strong>${expiresInHours} horas</strong>.
        Si expiró, pide a quien te invitó que te envíe uno nuevo. Si no esperabas este correo, puedes ignorarlo.
      </p>
    </td>
  </tr>
</table>`;

  const bodyText = `Bienvenido a Pilloto

Hola ${firstName}. ${introText}
Elige tu contraseña para entrar por primera vez:

${setPasswordUrl}

Este enlace funciona una sola vez y expira en ${expiresInHours} horas.
Si expiró, pide a quien te invitó que te envíe uno nuevo. Si no esperabas este correo, puedes ignorarlo.`;

  return applyLayout({
    hotelName: tenantName,
    logoUrl: tenantLogoUrl,
    bodyHtml,
    bodyText,
    customFooterHtml,
    customFooterText,
  });
}
