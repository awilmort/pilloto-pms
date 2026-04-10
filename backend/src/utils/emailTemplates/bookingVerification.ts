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
    <h1 style="margin:0 0 10px 0;font-size:22px;color:#2D3748;">Verification Code</h1>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#555555;">
      You're almost done! Use the code below to verify your email address
      and confirm your booking at <strong>${escapeHtml(tenantName)}</strong>.
    </p>
  </td>
</tr>
<tr>
  <td align="center" style="padding:10px 40px 10px 40px;">
    <div style="display:inline-block;background-color:#f0f4f8;border:2px dashed #2E7D32;border-radius:10px;padding:20px 40px;">
      <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#2E7D32;font-family:monospace;">${escapeHtml(code)}</span>
    </div>
  </td>
</tr>
<tr>
  <td style="padding:20px 40px 10px 40px;">
    <p style="margin:0 0 10px 0;font-size:14px;line-height:1.6;color:#777777;">
      This code is valid for <strong>15 minutes</strong>. Do not share it with anyone.
    </p>
    <p style="margin:0 0 10px 0;font-size:14px;line-height:1.6;color:#777777;">
      If you did not request this, you can safely ignore this email.
    </p>
  </td>
</tr>`;

  const bodyText = `Verification Code: ${code}

Use this code to verify your email and confirm your booking at ${tenantName}.

This code is valid for 15 minutes. Do not share it with anyone.

If you did not request this, you can safely ignore this email.`;

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
