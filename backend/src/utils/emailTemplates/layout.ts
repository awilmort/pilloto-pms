/**
 * Email layout — tables-based, max-width 600px, all CSS inlined.
 * Compatible with Outlook, Gmail, Apple Mail, and major mobile clients.
 */

export interface LayoutParams {
  /** Hotel name shown in the header */
  hotelName: string;
  /** Absolute URL to the hotel logo (CDN/media URL). Optional. */
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
}

/** Brand primary colour used in the header bar. */
const BRAND_COLOR = '#2E7D32';
const CURRENT_YEAR = new Date().getFullYear();

/**
 * Wraps arbitrary body content with the Pilloto email shell:
 * top bar with logo + hotel name, body slot, Pilloto-branded footer,
 * and an optional tenant custom footer.
 *
 * Returns both HTML and plain-text versions.
 */
export function applyLayout(params: LayoutParams): { html: string; text: string } {
  const { hotelName, logoUrl, bodyHtml, bodyText, customFooterHtml, customFooterText } = params;

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${escapeHtml(hotelName)}" width="120" style="display:block;max-width:120px;height:auto;border:0;" />`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(hotelName)} - Pilloto</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#333333;">
  <!-- Outer wrapper -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!-- Email card — max 600px -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:6px;overflow:hidden;border:1px solid #e0e0e0;">

          <!-- Header bar -->
          <tr>
            <td align="center" style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    ${logoBlock}
                    <p style="margin:${logoUrl ? '12px' : '0'} 0 0;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${escapeHtml(hotelName)}</p>
                    <p style="margin:4px 0 0;font-size:12px;color:#c8e6c9;font-style:italic;">vía Pilloto</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body content -->
          <tr>
            <td style="padding:32px 40px;">
              ${bodyHtml}
            </td>
          </tr>

          ${customFooterHtml ? `
          <!-- Tenant custom footer -->
          <tr>
            <td style="padding:0 40px 16px;border-top:1px solid #f0f0f0;">
              <div style="font-size:13px;color:#666666;">
                ${customFooterHtml}
              </div>
            </td>
          </tr>` : ''}

          <!-- Pilloto branded footer -->
          <tr>
            <td align="center" style="background-color:#fafafa;border-top:1px solid #eeeeee;padding:20px 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 6px;font-size:12px;color:#999999;">&copy; ${CURRENT_YEAR} Pilloto &mdash; ${escapeHtml(hotelName)}. Todos los derechos reservados.</p>
                    <p style="margin:0 0 6px;font-size:11px;color:#bbbbbb;">Este es un correo transaccional enviado en respuesta a una acción en tu cuenta.</p>
                    <p style="margin:0;font-size:11px;color:#bbbbbb;">
                      ¿Preguntas? Contáctanos en
                      <a href="mailto:info@pilloto.com" style="color:#999999;text-decoration:underline;">info@pilloto.com</a>
                      &nbsp;|&nbsp;
                      <a href="mailto:noreply@pilloto.com?subject=unsubscribe" style="color:#999999;text-decoration:underline;">Cancelar suscripción</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `╔══════════════════════════════════════════╗`,
    `  ${hotelName} — vía Pilloto`,
    `╚══════════════════════════════════════════╝`,
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
