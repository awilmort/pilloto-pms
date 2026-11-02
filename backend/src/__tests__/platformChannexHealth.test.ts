/**
 * GET /api/platform/channex/health — superadmin-only, never returns the API key
 * (CHANNEX_IMPLEMENTATION_PLAN.md Phase 2.1). Auth is mocked to a role switch;
 * the Channex HTTP call is faked at the client level.
 */

import express from 'express';
import request from 'supertest';

let mockRole = 'superadmin';
jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { role: mockRole }; next(); },
  authorize: (...roles: string[]) => (req: any, res: any, next: any) =>
    roles.includes(req.user?.role) ? next() : res.status(403).json({ success: false }),
}));

const mockGet = jest.fn();
jest.mock('../services/channex/channexClient', () => {
  const actual = jest.requireActual('../services/channex/channexClient');
  return { ...actual, createChannexClient: () => ({ get: mockGet }) };
});

import platformRoutes from '../routes/platform';
import { ChannexAuthError } from '../services/channex/channexClient';

const KEY = 'live-looking-key-0123456789abcdef';
const app = express();
app.use('/api/platform', platformRoutes);

describe('GET /api/platform/channex/health', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    mockRole = 'superadmin';
    mockGet.mockReset();
    process.env = { ...saved, CHANNEX_ENV: 'staging', CHANNEX_API_KEY: KEY };
    delete process.env.CHANNEX_BASE_URL;
  });
  afterAll(() => { process.env = saved; });

  it('reports success with environment and base URL', async () => {
    mockGet.mockResolvedValue({ data: [] });
    const res = await request(app).get('/api/platform/channex/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ environment: 'staging', baseUrl: 'https://staging.channex.io', configured: true, ok: true });
    expect(mockGet).toHaveBeenCalledWith('/properties', { 'pagination[limit]': 1 });
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it('reports a clear auth error for a wrong key', async () => {
    mockGet.mockRejectedValue(new ChannexAuthError('Channex rejected the API key (401)', { status: 401 }));
    const res = await request(app).get('/api/platform/channex/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: false, error: { kind: 'auth', status: 401 } });
  });

  it('is refused to non-superadmins', async () => {
    mockRole = 'admin';
    const res = await request(app).get('/api/platform/channex/health');
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
