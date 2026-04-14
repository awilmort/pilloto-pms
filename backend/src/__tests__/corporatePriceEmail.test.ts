/**
 * Unit tests for sendCorporatePriceRequestEmail.
 * Verifies that the approve and decline URLs contain the tenant slug.
 *
 * Strategy: mock renderCorporatePriceRequest to capture the URLs it receives,
 * and mock sendEmail to prevent actual network calls.
 */

import { tenantLocalStorage } from '../middleware/tenantContext';

// ── Mock dependencies before importing the module under test ─────────────────

/** Captures every call to renderCorporatePriceRequest so we can inspect the URLs */
const mockRenderCorporatePriceRequest = jest.fn().mockReturnValue({ html: '<p>ok</p>', text: 'ok' });

jest.mock('../utils/emailTemplates/corporatePriceRequest', () => ({
  renderCorporatePriceRequest: (...args: any[]) => mockRenderCorporatePriceRequest(...args),
}));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
    },
  })),
}));

jest.mock('../models/EmailSuppression', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) },
}));

jest.mock('../models/AppSettings', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({}) }),
  },
}));

jest.mock('../models/Tenant', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock('../models/Folio', () => ({ __esModule: true, default: {} }));
jest.mock('../models/Charge', () => ({ __esModule: true, default: {} }));
jest.mock('../models/Payment', () => ({ __esModule: true, default: {} }));
jest.mock('../models/Reservation', () => ({ __esModule: true, default: {} }));

// ── Imports after mocks ──────────────────────────────────────────────────────

import Tenant from '../models/Tenant';
import { sendCorporatePriceRequestEmail } from '../utils/email';

// ── Test helpers ─────────────────────────────────────────────────────────────

const TENANT_ID = '507f1f77bcf86cd799439011';
const RES_ID = '507f1f77bcf86cd799439099';

const FAKE_RESERVATION = {
  _id: RES_ID,
  reservationCode: 'RES-001',
  type: 'room',
  checkInDate: '2026-06-01',
  checkOutDate: '2026-06-03',
  estimatedTotal: 5000,
  guestName: { firstName: 'Ana', lastName: 'García' },
  contactInfo: { email: 'ana@example.com' },
  discountAmount: 0,
  discountPercent: 0,
  requestedCompany: null,
};

function mockTenantWith(slug: string | undefined) {
  (Tenant.findById as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(
        slug !== undefined
          ? { _id: TENANT_ID, name: 'Hotel Banana Ranch', slug, settings: { currency: 'DOP', logoUrl: '' } }
          : { _id: TENANT_ID, name: 'Hotel Banana Ranch', settings: { currency: 'DOP', logoUrl: '' } },
      ),
    }),
  });
}

function getCapturedUrls(): { approveUrl: string; declineUrl: string } {
  expect(mockRenderCorporatePriceRequest).toHaveBeenCalled();
  const args = mockRenderCorporatePriceRequest.mock.calls[0][0];
  return { approveUrl: args.approveUrl, declineUrl: args.declineUrl };
}

async function runEmailInTenantContext() {
  await new Promise<void>((resolve, reject) => {
    tenantLocalStorage.run({ tenantId: TENANT_ID }, async () => {
      try {
        await sendCorporatePriceRequestEmail(FAKE_RESERVATION, ['admin@banana.com']);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRenderCorporatePriceRequest.mockClear();
  process.env.FRONTEND_URL = 'https://app.pilloto.com';
  process.env.RESEND_API_KEY = 'test_key';
  process.env.RESEND_FROM_ADDRESS = 'noreply@pilloto.com';
});

afterEach(() => {
  delete process.env.FRONTEND_URL;
});

describe('sendCorporatePriceRequestEmail — tenant slug in action URLs', () => {
  it('includes the tenant slug as a subdomain in the approve URL', async () => {
    mockTenantWith('banana-ranch');
    await runEmailInTenantContext();

    const { approveUrl } = getCapturedUrls();
    expect(approveUrl).toBe(`https://banana-ranch.app.pilloto.com/reservations/${RES_ID}/corporate-price/approve`);
  });

  it('includes the tenant slug as a subdomain in the decline URL', async () => {
    mockTenantWith('banana-ranch');
    await runEmailInTenantContext();

    const { declineUrl } = getCapturedUrls();
    expect(declineUrl).toBe(`https://banana-ranch.app.pilloto.com/reservations/${RES_ID}/corporate-price/decline`);
  });

  it('does not duplicate the slug when FRONTEND_URL already contains it', async () => {
    process.env.FRONTEND_URL = 'https://banana-ranch.app.pilloto.com';
    mockTenantWith('banana-ranch');
    await runEmailInTenantContext();

    const { approveUrl, declineUrl } = getCapturedUrls();
    expect(approveUrl).not.toContain('banana-ranch.banana-ranch');
    expect(approveUrl).toBe(`https://banana-ranch.app.pilloto.com/reservations/${RES_ID}/corporate-price/approve`);
    expect(declineUrl).toBe(`https://banana-ranch.app.pilloto.com/reservations/${RES_ID}/corporate-price/decline`);
  });

  it('falls back to plain FRONTEND_URL when tenant has no slug', async () => {
    mockTenantWith(undefined);
    await runEmailInTenantContext();

    const { approveUrl, declineUrl } = getCapturedUrls();
    expect(approveUrl).toBe(`https://app.pilloto.com/reservations/${RES_ID}/corporate-price/approve`);
    expect(declineUrl).toBe(`https://app.pilloto.com/reservations/${RES_ID}/corporate-price/decline`);
  });

  it('falls back to plain FRONTEND_URL when Tenant query fails', async () => {
    (Tenant.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('DB error')),
      }),
    });

    await runEmailInTenantContext();

    const { approveUrl, declineUrl } = getCapturedUrls();
    expect(approveUrl).toBe(`https://app.pilloto.com/reservations/${RES_ID}/corporate-price/approve`);
    expect(declineUrl).toBe(`https://app.pilloto.com/reservations/${RES_ID}/corporate-price/decline`);
  });

  it('preserves port in dev environment (e.g. banana-ranch.localhost:3000)', async () => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    mockTenantWith('banana-ranch');
    await runEmailInTenantContext();

    const { approveUrl, declineUrl } = getCapturedUrls();
    expect(approveUrl).toBe(`http://banana-ranch.localhost:3000/reservations/${RES_ID}/corporate-price/approve`);
    expect(declineUrl).toBe(`http://banana-ranch.localhost:3000/reservations/${RES_ID}/corporate-price/decline`);
  });
});
