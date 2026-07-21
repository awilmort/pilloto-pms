/**
 * Email service — Resend
 *
 * Replaces the previous Amazon SES implementation.
 * Call signatures are backward-compatible.
 *
 * Key behaviours:
 * - Sends via Resend API
 * - Checks the EmailSuppression collection before every send
 * - Retries up to 3 times with exponential backoff on rate-limit errors (HTTP 429)
 * - Never retries permanent errors
 * - Logs only Resend email ID, email type, outcome, and internal IDs (no PII)
 */

import { Resend } from 'resend';
import mongoose from 'mongoose';
import EmailSuppression from '../models/EmailSuppression';
import Tenant from '../models/Tenant';
import AppSettings from '../models/AppSettings';
import Folio from '../models/Folio';
import Charge from '../models/Charge';
import Payment from '../models/Payment';
import Reservation from '../models/Reservation';
import { renderReservationConfirmation } from './emailTemplates/reservationConfirmation';
import { renderInvoice } from './emailTemplates/invoice';
import { renderCorporatePriceRequest } from './emailTemplates/corporatePriceRequest';
import { renderEmailVerification } from './emailTemplates/emailVerification';
import { getTenantId } from '../middleware/tenantContext';

// ── Resend client ─────────────────────────────────────────────────────────────
// Lazy initialization: dotenv.config() runs after module imports are hoisted,
// so we must not read process.env at module-load time.

let _resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!_resendClient) {
    _resendClient = new Resend(process.env.RESEND_API_KEY!);
  }
  return _resendClient;
}

function getFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS || 'noreply@pilloto.com';
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
  }>;
  /** Used only for structured logging. Not emitted in plain text. */
  _logMeta?: { emailType: string; referenceId?: string };
}

// ── Suppression check ────────────────────────────────────────────────────────

async function isSuppressed(email: string): Promise<boolean> {
  const lower = email.toLowerCase().trim();
  const record = await EmailSuppression.findOne({ email: lower }).lean();
  return !!record;
}

// ── From address builder ─────────────────────────────────────────────────────

async function buildFromAddress(fromAddress: string): Promise<string> {
  const tid = getTenantId()?.toString();
  if (!tid) return `"Pilloto" <${fromAddress}>`;
  try {
    const tenant = await Tenant.findById(tid).select('name').lean();
    const tenantName = (tenant as any)?.name ?? 'Pilloto';
    return `"${tenantName} via Pilloto" <${fromAddress}>`;
  } catch {
    return `"Pilloto" <${fromAddress}>`;
  }
}

// ── Core send wrapper ────────────────────────────────────────────────────────

export const sendEmail = async (options: EmailOptions): Promise<string> => {
  const emailType = options._logMeta?.emailType ?? 'unknown';
  const referenceId = options._logMeta?.referenceId ?? null;

  const suppressed = await isSuppressed(options.to);
  if (suppressed) {
    console.log(JSON.stringify({ emailEvent: 'suppressed', emailType, referenceId }));
    return '';
  }

  const FROM_ADDRESS = getFromAddress();
  const source = await buildFromAddress(FROM_ADDRESS);

  const payload = {
    from: source,
    to: [options.to],
    subject: options.subject,
    html: options.html,
    text: options.text || options.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    ...(options.replyTo && { reply_to: options.replyTo }),
    headers: {
      'List-Unsubscribe': `<mailto:${FROM_ADDRESS}?subject=unsubscribe>`,
    },
  };

  let attempt = 0;
  const maxRetries = 3;

  while (attempt <= maxRetries) {
    const { data, error } = await getResendClient().emails.send(payload);

    if (!error) {
      const messageId = data?.id ?? 'unknown';
      console.log(JSON.stringify({ emailEvent: 'sent', emailType, referenceId, resendId: messageId }));
      return messageId;
    }

    const isRateLimit = error.name === 'rate_limit_exceeded' || (error as any).statusCode === 429;
    if (isRateLimit && attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 500;
      attempt++;
      console.log(JSON.stringify({ emailEvent: 'retry', emailType, attempt, errorName: error.name, errorMessage: error.message }));
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      console.error(JSON.stringify({ emailEvent: 'failed', emailType, referenceId, errorName: error.name, errorMessage: error.message }));
      throw new Error(`Email send failed [${error.name}]: ${error.message}`);
    }
  }

  throw new Error('Email send: max retries exceeded');
};

// ── Tenant helpers ────────────────────────────────────────────────────────────

interface TenantEmailConfig {
  fromDisplayName?: string;
  replyTo?: string;
  footerHtml?: string;
  footerText?: string;
}

async function getTenantEmailConfig(): Promise<TenantEmailConfig> {
  try {
    const settings = await AppSettings.findOne({ key: 'global' }).lean<any>();
    return settings?.emailSettings ?? {};
  } catch {
    return {};
  }
}

async function getTenantInfo(): Promise<{ name: string; slug?: string; logoUrl?: string; currency?: string }> {
  const tid = getTenantId()?.toString();
  if (!tid) return { name: 'Pilloto' };
  try {
    const tenant = await Tenant.findById(tid).select('name slug settings').lean();
    return {
      name: (tenant as any)?.name ?? 'Pilloto',
      slug: (tenant as any)?.slug,
      logoUrl: (tenant as any)?.settings?.logoUrl,
      currency: (tenant as any)?.settings?.currency,
    };
  } catch {
    return { name: 'Pilloto' };
  }
}

// ── Public email functions ────────────────────────────────────────────────────

export const sendVerificationEmail = async (user: any, token: string): Promise<void> => {
  const [tenantInfo, emailCfg] = await Promise.all([getTenantInfo(), getTenantEmailConfig()]);

  const rawBase = process.env.FRONTEND_URL || 'http://localhost:3000';
  let tenantBase = rawBase;
  if (tenantInfo.slug) {
    try {
      const parsed = new URL(rawBase);
      const hostname = parsed.hostname;
      if (!hostname.startsWith(`${tenantInfo.slug}.`)) {
        parsed.hostname = `${tenantInfo.slug}.${hostname}`;
        // Preserve port for dev (e.g. banana-ranch.localhost:3000)
        tenantBase = `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // fallback: use rawBase unchanged
    }
  }

  const verifyUrl = `${tenantBase}/verify-email?token=${token}`;

  const { html, text } = renderEmailVerification({
    firstName: user.firstName,
    verifyUrl,
    tenantName: emailCfg.fromDisplayName || tenantInfo.name,
    tenantLogoUrl: tenantInfo.logoUrl,
    customFooterHtml: emailCfg.footerHtml,
    customFooterText: emailCfg.footerText,
  });

  await sendEmail({
    to: user.pendingEmail || user.email,
    subject: 'Verifica tu correo electrónico — ' + (emailCfg.fromDisplayName || tenantInfo.name),
    html,
    text,
    _logMeta: { emailType: 'email_verification' },
  });
};

export const sendPasswordResetEmail = async (user: any, token: string): Promise<void> => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
  const year = new Date().getFullYear();

  const html = '<!DOCTYPE html>'
    + '<html lang="es"><head><meta charset="UTF-8" /><title>Restablecer contraseña - Pilloto</title></head>'
    + '<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;">'
    + '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f4;">'
    + '<tr><td align="center" style="padding:24px 12px;">'
    + '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:6px;border:1px solid #e0e0e0;">'
    + '<tr><td style="background:#c62828;padding:24px;text-align:center;border-radius:6px 6px 0 0;">'
    + '<p style="margin:0;font-size:22px;font-weight:bold;color:#ffffff;">Pilloto</p>'
    + '<p style="margin:6px 0 0;font-size:13px;color:#ffcdd2;">Restablecimiento de contraseña</p>'
    + '</td></tr>'
    + '<tr><td style="padding:32px 40px;">'
    + '<p style="font-size:15px;margin:0 0 12px;">Hola <strong>' + user.firstName + '</strong>,</p>'
    + '<p style="font-size:14px;color:#555;margin:0 0 24px;">Recibimos una solicitud para restablecer tu contraseña.</p>'
    + '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">'
    + '<tr><td align="center">'
    + '<a href="' + resetUrl + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 32px;background:#c62828;color:#ffffff;text-decoration:none;border-radius:4px;font-size:15px;font-weight:bold;">Restablecer contraseña</a>'
    + '</td></tr></table>'
    + '<p style="font-size:13px;color:#777;margin:24px 0 6px;">Si el botón no funciona, copia este enlace:</p>'
    + '<p style="font-size:12px;background:#f5f5f5;padding:10px;border-radius:4px;word-break:break-all;">' + resetUrl + '</p>'
    + '<p style="font-size:13px;color:#777;margin:16px 0 0;">Este enlace expira en <strong>1 hora</strong>. Si no solicitaste esto, ignora este correo.</p>'
    + '</td></tr>'
    + '<tr><td style="background:#fafafa;border-top:1px solid #eee;padding:16px;text-align:center;">'
    + '<p style="margin:0;font-size:11px;color:#aaa;">&copy; ' + year + ' Pilloto. Todos los derechos reservados.</p>'
    + '<p style="margin:4px 0 0;font-size:11px;color:#aaa;">Correo transaccional. <a href="mailto:noreply@pilloto.com?subject=unsubscribe" style="color:#aaa;">Cancelar suscripción</a></p>'
    + '</td></tr>'
    + '</table>'
    + '</td></tr></table>'
    + '</body></html>';

  const text = 'Restablecimiento de contraseña - Pilloto\n\nHola ' + user.firstName + ',\n\nRestablece tu contraseña visitando:\n' + resetUrl + '\n\nEste enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.';

  await sendEmail({
    to: user.email,
    subject: 'Restablecimiento de contraseña - Pilloto',
    html,
    text,
    _logMeta: { emailType: 'password_reset' },
  });
};

export const sendReservationConfirmationEmail = async (reservation: any): Promise<void> => {
  const contactEmail = reservation.contactInfo?.email;
  if (!contactEmail) return;

  const [tenantInfo, emailCfg] = await Promise.all([getTenantInfo(), getTenantEmailConfig()]);

  const { html, text } = renderReservationConfirmation({
    reservation,
    tenantName: emailCfg.fromDisplayName || tenantInfo.name,
    tenantLogoUrl: tenantInfo.logoUrl,
    currency: tenantInfo.currency,
    customFooterHtml: emailCfg.footerHtml,
    customFooterText: emailCfg.footerText,
  });

  await sendEmail({
    to: contactEmail,
    subject: 'Reserva confirmada - ' + (emailCfg.fromDisplayName || tenantInfo.name) + ' (' + (reservation.reservationCode || '') + ')',
    html,
    text,
    replyTo: emailCfg.replyTo,
    _logMeta: { emailType: 'reservation_confirmation', referenceId: String(reservation._id) },
  });
};

export const sendInvoiceEmail = async (folioId: string | mongoose.Types.ObjectId): Promise<void> => {
  const folio = await Folio.findById(folioId).lean();
  if (!folio) throw new Error('Folio not found: ' + folioId);

  const reservation = await Reservation.findById(folio.reservationId)
    .populate('user', 'firstName lastName email')
    .populate('rooms', 'name')
    .populate('room', 'name')
    .lean<any>();

  if (!reservation) throw new Error('Reservation not found for folio ' + folioId);

  const contactEmail = reservation.contactInfo?.email;
  if (!contactEmail) return;

  const [chargesRaw, paymentsRaw, tenantInfo, emailCfg] = await Promise.all([
    Charge.find({ folioId }).lean(),
    Payment.find({ folioId }).lean(),
    getTenantInfo(),
    getTenantEmailConfig(),
  ]);

  const charges = (chargesRaw as any[]).map(c => ({
    description: c.description,
    amount: c.amount,
    category: c.category,
  }));
  const payments = (paymentsRaw as any[]).map(p => ({
    amount: p.amount,
    method: p.method,
    status: p.status,
    reference: p.reference,
    createdAt: p.createdAt,
  }));

  const activePayments = payments.filter(p => p.status !== 'reversed');
  const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);
  const totalPayments = activePayments.reduce((sum, p) => sum + p.amount, 0);
  const balance = Math.max(0, totalCharges - totalPayments);

  const guestName =
    reservation.guestName?.firstName && reservation.guestName?.lastName
      ? reservation.guestName.firstName + ' ' + reservation.guestName.lastName
      : reservation.user
        ? reservation.user.firstName + ' ' + reservation.user.lastName
        : 'Huesped';

  const typeLabels: Record<string, string> = {
    room: 'Reserva de habitacion',
    daypass: 'Day Pass',
    PasaTarde: 'Pasa Tarde',
    event: 'Reserva de evento',
  };

  const { html, text } = renderInvoice({
    reservationCode: reservation.reservationCode ?? String(reservation._id),
    guestName,
    checkInDate: reservation.checkInDate,
    checkOutDate: reservation.checkOutDate,
    reservationType: typeLabels[reservation.type] ?? reservation.type,
    charges,
    payments,
    totalCharges,
    totalPayments,
    balance,
    tenantName: emailCfg.fromDisplayName || tenantInfo.name,
    tenantLogoUrl: tenantInfo.logoUrl,
    currency: tenantInfo.currency,
    customFooterHtml: emailCfg.footerHtml,
    customFooterText: emailCfg.footerText,
  });

  await sendEmail({
    to: contactEmail,
    subject: 'Factura - ' + (emailCfg.fromDisplayName || tenantInfo.name) + ' (' + (reservation.reservationCode || '') + ')',
    html,
    text,
    replyTo: emailCfg.replyTo,
    _logMeta: { emailType: 'invoice', referenceId: String(folio._id) },
  });
};

/**
 * Send corporate price request notification to users with 'admin.reservations.assignCorporatePrice'
 * permission (or to all admins if no one has that permission).
 */
export const sendCorporatePriceRequestEmail = async (
  reservation: any,
  recipientEmails: string[],
): Promise<void> => {
  if (!recipientEmails.length) return;

  const [tenantInfo, emailCfg] = await Promise.all([getTenantInfo(), getTenantEmailConfig()]);

  const guestName = reservation.guestName
    ? `${reservation.guestName.firstName || ''} ${reservation.guestName.lastName || ''}`.trim()
    : 'Guest';
  const guestEmail = reservation.contactInfo?.email || '';
  const resId = String(reservation._id);

  const rawBase = process.env.FRONTEND_URL || 'http://localhost:3000';
  let tenantBase = rawBase;
  if (tenantInfo.slug) {
    try {
      const parsed = new URL(rawBase);
      const hostname = parsed.hostname;
      if (!hostname.startsWith(`${tenantInfo.slug}.`)) {
        parsed.hostname = `${tenantInfo.slug}.${hostname}`;
        tenantBase = `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // fallback: use rawBase unchanged
    }
  }
  const approveUrl = `${tenantBase}/reservations/${resId}/corporate-price/approve`;
  const declineUrl = `${tenantBase}/reservations/${resId}/corporate-price/decline`;

  // Resolve requested company name (populated or plain ObjectId reference)
  const requestedCompanyName: string | undefined = reservation.requestedCompany
    ? (typeof reservation.requestedCompany === 'object' && reservation.requestedCompany.name)
      ? reservation.requestedCompany.name
      : undefined
    : undefined;

  const { html, text } = renderCorporatePriceRequest({
    reservation,
    guestName,
    guestEmail,
    requestedCompanyName,
    tenantName: emailCfg.fromDisplayName || tenantInfo.name,
    tenantLogoUrl: tenantInfo.logoUrl,
    currency: tenantInfo.currency,
    approveUrl,
    declineUrl,
    customFooterHtml: emailCfg.footerHtml,
    customFooterText: emailCfg.footerText,
  });

  const subject = `Solicitud de Precio Corporativo - ${guestName} (${reservation.reservationCode || resId})`;

  for (const to of recipientEmails) {
    sendEmail({
      to,
      subject,
      html,
      text,
      replyTo: emailCfg.replyTo,
      _logMeta: { emailType: 'corporate_price_request', referenceId: resId },
    }).catch(err => console.error('Failed to send corporate price request email:', err));
  }
};
