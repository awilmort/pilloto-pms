/**
 * Invitations — every new account (a tenant's owner from the platform console, a staff member
 * from Users) gets an email with a link to choose their first password. Nobody types or
 * sees another person's password, and no password is ever emailed.
 *
 *   send      a fresh single-use token (72 h) replaces any previous one; the email is sent in
 *             the user's tenant context so the link and branding are the tenant's
 *   accept    `POST /api/auth/accept-invitation` sets the password, verifies the email, logs in
 *   resend    platform console (owner) or Users screen (staff), refused once accepted
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { IUser, INVITATION_TTL_MS } from '../models/User';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { sendInvitationEmail } from '../utils/email';

export type InvitationStatus = 'none' | 'pending' | 'expired' | 'accepted';

export const INVITATION_TTL_HOURS = Math.round(INVITATION_TTL_MS / 3_600_000);

export const hashInvitationToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Where an account stands: never invited (older accounts), waiting, link expired, or password chosen. */
export function invitationStatus(
  u: Pick<IUser, 'invitedAt' | 'invitationAcceptedAt' | 'invitationExpires'> | null | undefined,
  now: Date = new Date(),
): InvitationStatus {
  if (!u?.invitedAt) return 'none';
  if (u.invitationAcceptedAt) return 'accepted';
  return u.invitationExpires && u.invitationExpires.getTime() > now.getTime() ? 'pending' : 'expired';
}

/** Public view of a user's invitation, for lists. */
export const invitationView = (u: Pick<IUser, 'invitedAt' | 'invitationAcceptedAt' | 'invitationExpires'>, now: Date = new Date()) => ({
  status: invitationStatus(u, now),
  invitedAt: u.invitedAt,
  expiresAt: u.invitationExpires,
  acceptedAt: u.invitationAcceptedAt,
});

/**
 * Issue a new invitation for `user` (saved) and email it. Never throws for an email failure:
 * the account exists either way and the invitation can be resent.
 */
export async function sendInvitation(
  user: mongoose.HydratedDocument<IUser>,
  opts: { isOwner?: boolean } = {},
): Promise<{ sent: boolean; error?: string }> {
  const token = user.generateInvitationToken();
  await user.save();
  const tenantId = user.tenantId ? String(user.tenantId) : undefined;
  const send = () => sendInvitationEmail(user, token, { isOwner: opts.isOwner, expiresInHours: INVITATION_TTL_HOURS });
  try {
    if (tenantId) await tenantLocalStorage.run({ tenantId }, send);
    else await send();
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Invitations] email not sent:', message);
    return { sent: false, error: message };
  }
}
