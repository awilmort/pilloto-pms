/**
 * Email layout — tables-based, max-width 600px, all CSS inlined.
 * Compatible with Outlook, Gmail, Apple Mail, and major mobile clients.
 * Visual language follows the Pilloto brand kit (ink / vermilion / paper / mist, Inter).
 */

import { platformBaseUrl } from '../appUrls';

export interface LayoutParams {
  /** Property name (header of property emails; sub-line of platform emails) */
  hotelName: string;
  /** Absolute URL to the property logo (CDN/media URL). Optional. */
  logoUrl?: string;
  /** Pre-rendered inner HTML body content */
  bodyHtml: string;
  /** Pre-rendered plain-text body content */
  bodyText: string;
  /** Tenant-customizable HTML footer block (already sanitized) */
  customFooterHtml?: string;
  /** Tenant-customizable plain-text footer block */
  customFooterText?: string;
  /** Locale for date/number formatting. Defaults to 'es-ES'. */
  locale?: string;
  /**
   * `platform` (default): a message from Pilloto itself (invitations, account, alerts) — the Pilloto
   * wordmark leads the header and the property name sits beneath it.
   * `property`: a message from the hotel to its guest — the hotel's logo/name leads, Pilloto is a quiet
   * "powered by" mark in the footer.
   */
  variant?: 'platform' | 'property';
}

/** Brand tokens (mirror frontend/src/brand.ts). */
export const EMAIL_BRAND = {
  ink: '#121A33',
  vermilion: '#E4572E',
  paper: '#F5F6F8',
  mist: '#E3E6EE',
  slate: '#5B6278',
} as const;

const FONT = `Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const CURRENT_YEAR = new Date().getFullYear();

/** Public URL of the wordmark PNG (served from the frontend's `public/email/`). */
function wordmarkUrl(tone: 'color' | 'white' = 'color'): string {
  return `${platformBaseUrl()}/email/pilloto-wordmark${tone === 'white' ? '-white' : ''}.png`;
}

/**
 * Wraps arbitrary body content with the Pilloto email shell: brand header, body slot,
 * optional tenant custom footer and the Pilloto footer.
 *
 * Returns both HTML and plain-text versions.
 */
export function applyLayout(params: LayoutParams): { html: string; text: string } {
  const { hotelName, logoUrl, bodyHtml, bodyText, customFooterHtml, customFooterText, variant = 'platform' } = params;
  const { ink, vermilion, paper, mist, slate } = EMAIL_BRAND;

  const pilloto = (w: number) =>
    `<img src="${wordmarkUrl()}" alt="Pilloto" width="${w}" style="display:block;border:0;outline:none;height:auto;width:${w}px;" />`;

  const headerInner = variant === 'property'
    ? `${logoUrl
        ? `<img src="${logoUrl}" alt="${escapeHtml(hotelName)}" width="120" style="display:block;margin:0 auto;max-width:120px;height:auto;border:0;" />`
        : ''}
                    <p style="margin:${logoUrl ? '12px' : '0'} 0 0;font-size:22px;line-height:1.3;font-weight:700;color:${ink};letter-spacing:-0.01em;">${escapeHtml(hotelName)}</p>`
    : `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center"><tr><td>${pilloto(132)}</td></tr></table>
                    <p style="margin:12px 0 0;font-size:13px;line-height:1.4;color:${slate};">${escapeHtml(hotelName)}</p>`;

  const footerBrand = variant === 'property'
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px;"><tr>
                      <td style="font-size:11px;color:${slate};padding-right:8px;vertical-align:middle;">Con tecnología de</td>
                      <td style="vertical-align:middle;">${pilloto(64)}</td>
                    </tr></table>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(hotelName)} - Pilloto</title>
</head>
<body style="margin:0;padding:0;background-color:${paper};font-family:${FONT};color:${ink};">
  <!-- Outer wrapper -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${paper};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <!-- Email card — max 600px -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${mist};">

          <!-- Brand accent -->
          <tr><td height="4" style="height:4px;line-height:4px;font-size:0;background-color:${vermilion};">&nbsp;</td></tr>

          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#ffffff;padding:28px 32px 24px;border-bottom:1px solid ${mist};">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="font-family:${FONT};">
                    ${headerInner}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body content -->
          <tr>
            <td style="padding:32px 40px;font-family:${FONT};">
              ${bodyHtml}
            </td>
          </tr>

          ${customFooterHtml ? `
          <!-- Tenant custom footer -->
          <tr>
            <td style="padding:0 40px 16px;border-top:1px solid ${mist};">
              <div style="font-size:13px;color:${slate};">
                ${customFooterHtml}
              </div>
            </td>
          </tr>` : ''}

          <!-- Pilloto footer -->
          <tr>
            <td align="center" style="background-color:${paper};border-top:1px solid ${mist};padding:20px 32px;font-family:${FONT};">
              ${footerBrand}
              <p style="margin:0 0 6px;font-size:12px;color:${slate};">&copy; ${CURRENT_YEAR} Pilloto &mdash; ${escapeHtml(hotelName)}. Todos los derechos reservados.</p>
              <p style="margin:0 0 6px;font-size:11px;color:#8A90A3;">Este es un correo transaccional enviado en respuesta a una acción en tu cuenta.</p>
              <p style="margin:0;font-size:11px;color:#8A90A3;">
                ¿Preguntas? Escríbenos a
                <a href="mailto:info@pilloto.com" style="color:${slate};text-decoration:underline;">info@pilloto.com</a>
                &nbsp;|&nbsp;
                <a href="mailto:noreply@pilloto.com?subject=unsubscribe" style="color:${slate};text-decoration:underline;">Cancelar suscripción</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    variant === 'property' ? `${hotelName}` : `Pilloto — ${hotelName}`,
    `──────────────────────────────────────────`,
    ``,
    bodyText,
    ``,
    customFooterText ? `${customFooterText}\n` : '',
    `──────────────────────────────────────────`,
    `© ${CURRENT_YEAR} Pilloto — ${hotelName}. Todos los derechos reservados.`,
    `Este es un correo transaccional.`,
    `¿Preguntas? info@pilloto.com`,
    `Cancelar suscripción: mailto:noreply@pilloto.com?subject=unsubscribe`,
  ].filter(Boolean).join('\n');

  return { html, text };
}

/** Minimal HTML entity escaping for safe text interpolation. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Format a monetary amount using the given locale and currency code. */
export function formatCurrency(amount: number, currency = 'DOP', locale = 'es-DO'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Format a date using the given locale. Uses UTC to avoid timezone-induced day shifts. */
export function formatDate(date: Date | string, locale = 'es-ES'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
