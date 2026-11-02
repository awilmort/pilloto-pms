/**
 * Invitations (services/invitations.ts, routes/auth.ts accept flow): new accounts choose their
 * own first password from an emailed single-use link that expires after 72 h; nobody can log in
 * before that, and no password is emailed.
 */
jest.mock('../utils/email', () => ({
  ...jest.requireActual('../utils/email'),
  sendInvitationEmail: jest.fn(),
  sendVerificationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));

import express, { NextFunction, Response } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { sendInvitationEmail } from '../utils/email';
import { invitationStatus, sendInvitation } from '../services/invitations';
import { tenantLocalStorage } from '../middleware/tenantContext';
import authRouter from '../routes/auth';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import User, { INVITATION_TTL_MS } from '../models/User';

const mockedSend = sendInvitationEmail as jest.Mock;

describe('invitationStatus', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  it('none, pending, expired, accepted', () => {
    expect(invitationStatus({}, now)).toBe('none');
    expect(invitationStatus({ invitedAt: now, invitationExpires: new Date(now.getTime() + 1000) }, now)).toBe('pending');
    expect(invitationStatus({ invitedAt: now, invitationExpires: new Date(now.getTime() - 1000) }, now)).toBe('expired');
    expect(invitationStatus({ invitedAt: now, invitationExpires: new Date(now.getTime() - 1000), invitationAcceptedAt: now }, now)).toBe('accepted');
  });
});

describe('invitation flow (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const tenant = { _id: tenantId, name: 'Hotel Mar', slug: 'hotel-mar', products: ['pms'] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.tenantId = String(tenantId);
    req.tenant = tenant;
    tenantLocalStorage.run({ tenantId: String(tenantId) }, () => next());
  });
  app.use('/api/auth', authRouter);

  const newUser = () => new User({ tenantId, firstName: 'Ana', lastName: 'Díaz', email: `ana${Date.now()}${Math.random()}@mar.do`, role: 'staff', emailVerified: false });
  const invite = async () => {
    let token = '';
    mockedSend.mockImplementationOnce(async (_u: unknown, t: string) => { token = t; });
    const user = newUser();
    expect(await sendInvitation(user)).toEqual({ sent: true });
    return { user, token };
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    ready = await connectTestDb('pilloto_invitations');
    if (!ready) console.warn('Mongo unreachable — skipping invitation DB tests');
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(() => mockedSend.mockReset());
  const run = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn(); });

  run('sending stores only a hash, a random password and a 72 h expiry; the email gets the raw token', async () => {
    const { user, token } = await invite();
    const saved = await User.findById(user._id).select('+invitationToken +password').lean();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(saved!.invitationToken).toBeDefined();
    expect(saved!.invitationToken).not.toBe(token);
    expect(saved!.password).toMatch(/^\$2/); // bcrypt hash of a random value
    expect(saved!.invitationExpires!.getTime() - saved!.invitedAt!.getTime()).toBe(INVITATION_TTL_MS);
    expect(mockedSend).toHaveBeenCalledWith(expect.anything(), token, expect.objectContaining({ expiresInHours: 72 }));
    expect(JSON.stringify(user.toJSON())).not.toMatch(/invitationToken|password/);
  });

  run('an email failure does not lose the account; the invitation can be resent', async () => {
    mockedSend.mockRejectedValueOnce(new Error('resend down'));
    const user = newUser();
    expect(await sendInvitation(user)).toEqual({ sent: false, error: 'resend down' });
    expect(invitationStatus(await User.findById(user._id))).toBe('pending');
  });

  run('before accepting, login is refused with a clear reason', async () => {
    const { user } = await invite();
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('invitation_pending');
  });

  run('the link shows who is invited, then accepting sets the password, verifies the email and logs in — once', async () => {
    const { user, token } = await invite();
    const info = await request(app).get('/api/auth/invitation').query({ token });
    expect(info.status).toBe(200);
    expect(info.body.data).toEqual({ firstName: 'Ana', email: user.email, tenantName: 'Hotel Mar' });

    expect((await request(app).post('/api/auth/accept-invitation').send({ token, password: 'weak' })).status).toBe(400);
    const ok = await request(app).post('/api/auth/accept-invitation').send({ token, password: 'Secreta123' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeDefined();

    const saved = await User.findById(user._id).select('+invitationToken').lean();
    expect(saved!.emailVerified).toBe(true);
    expect(saved!.invitationToken).toBeUndefined();
    expect(invitationStatus(saved as any)).toBe('accepted');

    expect((await request(app).post('/api/auth/accept-invitation').send({ token, password: 'Secreta123' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'Secreta123' })).status).toBe(200);
  });

  run('an expired link is refused with 410; a resend issues a new link and invalidates the old one', async () => {
    const { user, token } = await invite();
    await User.updateOne({ _id: user._id }, { $set: { invitationExpires: new Date(Date.now() - 1000) } });
    expect((await request(app).get('/api/auth/invitation').query({ token })).status).toBe(410);

    let fresh = '';
    mockedSend.mockImplementationOnce(async (_u: unknown, t: string) => { fresh = t; });
    await sendInvitation((await User.findById(user._id))!);
    expect((await request(app).get('/api/auth/invitation').query({ token })).status).toBe(400);
    expect((await request(app).post('/api/auth/accept-invitation').send({ token: fresh, password: 'Secreta123' })).status).toBe(200);
  });

  run('a token from another tenant is not found', async () => {
    const { token } = await invite();
    const other = express();
    other.use(express.json());
    other.use((req: any, _res: Response, next: NextFunction) => {
      const id = String(new mongoose.Types.ObjectId());
      req.tenantId = id; req.tenant = { _id: id, name: 'Other' };
      tenantLocalStorage.run({ tenantId: id }, () => next());
    });
    other.use('/api/auth', authRouter);
    expect((await request(other).get('/api/auth/invitation').query({ token })).status).toBe(400);
  });
});
