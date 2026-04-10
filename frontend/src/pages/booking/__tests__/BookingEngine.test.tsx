/**
 * Frontend unit tests for the Booking Engine components.
 *
 * Tests cover:
 * - BookingContext state management
 * - BookingSettingsTab embed snippet rendering
 * - BookingPage step rendering
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Mock the API module ──────────────────────────────────────────────────────

const mockGetConfig = jest.fn();
const mockGetAvailability = jest.fn();
const mockGetServices = jest.fn();

const mockGetSettings = jest.fn().mockResolvedValue({ data: { data: {} } });
const mockUpdateSettings = jest.fn().mockResolvedValue({ data: { data: {} } });

jest.mock('../../../services/api', () => ({
  bookingService: {
    getConfig: (...args: any[]) => mockGetConfig(...args),
    getAvailability: (...args: any[]) => mockGetAvailability(...args),
    getServices: (...args: any[]) => mockGetServices(...args),
    getServiceQuote: jest.fn(),
    getQuote: jest.fn(),
    sendVerification: jest.fn(),
    confirmVerification: jest.fn(),
    createReservation: jest.fn(),
    getLegalTerms: jest.fn(),
    getLegalPrivacy: jest.fn(),
  },
  settingsService: {
    getSettings: (...args: any[]) => mockGetSettings(...args),
    updateSettings: (...args: any[]) => mockUpdateSettings(...args),
  },
  resolveMediaUrl: (url: string) => url || '',
}));

// Mock react-router-dom
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/booking' }),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  NavLink: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  BrowserRouter: ({ children }: any) => <>{children}</>,
  Routes: ({ children }: any) => <>{children}</>,
  Route: () => null,
  Outlet: () => null,
}));

// Mock react-helmet-async
jest.mock('react-helmet-async', () => ({
  Helmet: ({ children }: any) => <div data-testid="helmet">{children}</div>,
  HelmetProvider: ({ children }: any) => <>{children}</>,
}));

// Mock i18n
jest.mock('../../../i18n', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
}));

import { BookingProvider, useBooking, BookingItem } from '../../../contexts/BookingContext';

// ── Test helpers ─────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  data: {
    data: {
      enabled: true,
      tenantName: 'Test Hotel',
      tenantSlug: 'test-hotel',
      logoUrl: '/logo.png',
      primaryColor: '#2D3748',
      currency: 'USD',
      timezone: 'UTC',
      language: 'en',
      heroImageUrl: '/hero.jpg',
      heroHeadline: 'Welcome to Test Hotel',
      heroSubtitle: 'Book your perfect getaway',
      contactPhone: '+1 555-1234',
      contactEmail: 'info@test.com',
      contactAddress: '123 Test St',
      minAdvanceHours: 24,
      maxAdvanceDays: 365,
      termsVersion: '1.0',
      privacyVersion: '1.0',
      checkoutTime: '11:00',
    },
  },
};

/**
 * Test component that exposes BookingContext values for assertions.
 */
function BookingConsumer({ onRender }: { onRender: (ctx: ReturnType<typeof useBooking>) => void }) {
  const ctx = useBooking();
  React.useEffect(() => { onRender(ctx); });
  return <div data-testid="consumer">Step: {ctx.currentStep}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — BookingContext
// ─────────────────────────────────────────────────────────────────────────────

describe('BookingContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue(MOCK_CONFIG);
  });

  it('should load config on mount', async () => {
    let capturedCtx: any;
    render(
      <BookingProvider>
        <BookingConsumer onRender={ctx => { capturedCtx = ctx; }} />
      </BookingProvider>
    );

    await waitFor(() => {
      expect(capturedCtx.configLoading).toBe(false);
    });

    expect(capturedCtx.config).toBeTruthy();
    expect(capturedCtx.config.tenantName).toBe('Test Hotel');
    expect(capturedCtx.config.enabled).toBe(true);
  });

  it('should set configError when booking is disabled', async () => {
    mockGetConfig.mockResolvedValue({
      data: {
        data: { ...MOCK_CONFIG.data.data, enabled: false },
      },
    });

    let capturedCtx: any;
    render(
      <BookingProvider>
        <BookingConsumer onRender={ctx => { capturedCtx = ctx; }} />
      </BookingProvider>
    );

    await waitFor(() => expect(capturedCtx.configLoading).toBe(false));
    expect(capturedCtx.configError).toMatch(/not currently available/i);
  });

  it('should set configError on API failure', async () => {
    mockGetConfig.mockRejectedValue({ response: { data: { message: 'Plan not supported' } } });

    let capturedCtx: any;
    render(
      <BookingProvider>
        <BookingConsumer onRender={ctx => { capturedCtx = ctx; }} />
      </BookingProvider>
    );

    await waitFor(() => expect(capturedCtx.configLoading).toBe(false));
    expect(capturedCtx.configError).toBe('Plan not supported');
  });

  it('should manage cart items (add, remove, clear)', async () => {
    let capturedCtx: any;
    render(
      <BookingProvider>
        <BookingConsumer onRender={ctx => { capturedCtx = ctx; }} />
      </BookingProvider>
    );

    await waitFor(() => expect(capturedCtx.configLoading).toBe(false));

    const testItem: BookingItem = {
      kind: 'room',
      roomTypeId: 'rt1',
      ratePlanId: 'rp1',
      roomTypeName: 'Deluxe',
      checkIn: '2025-12-01',
      checkOut: '2025-12-03',
      adults: 2,
      children: 0,
      quantity: 1,
      pricing: { subtotal: 200, taxes: 20, total: 220, perNight: 100, nights: 2 },
    };

    // Add item
    act(() => { capturedCtx.addItem(testItem); });
    await waitFor(() => expect(capturedCtx.items).toHaveLength(1));
    expect(capturedCtx.totalPrice).toBe(220);

    // Add another
    const serviceItem: BookingItem = {
      kind: 'service',
      serviceId: 'svc1',
      serviceName: 'Spa',
      adults: 1,
      children: 0,
      quantity: 1,
      pricing: { subtotal: 50, taxes: 5, total: 55 },
    };
    act(() => { capturedCtx.addItem(serviceItem); });
    await waitFor(() => expect(capturedCtx.items).toHaveLength(2));
    expect(capturedCtx.totalPrice).toBe(275);

    // Remove first item
    act(() => { capturedCtx.removeItem(0); });
    await waitFor(() => expect(capturedCtx.items).toHaveLength(1));
    expect(capturedCtx.items[0].kind).toBe('service');

    // Clear all
    act(() => { capturedCtx.clearItems(); });
    await waitFor(() => expect(capturedCtx.items).toHaveLength(0));
    expect(capturedCtx.totalPrice).toBe(0);
  });

  it('should manage step navigation', async () => {
    let capturedCtx: any;
    render(
      <BookingProvider>
        <BookingConsumer onRender={ctx => { capturedCtx = ctx; }} />
      </BookingProvider>
    );

    await waitFor(() => expect(capturedCtx.configLoading).toBe(false));

    expect(capturedCtx.currentStep).toBe('search');

    act(() => { capturedCtx.setCurrentStep('results'); });
    await waitFor(() => expect(capturedCtx.currentStep).toBe('results'));

    act(() => { capturedCtx.setCurrentStep('details'); });
    await waitFor(() => expect(capturedCtx.currentStep).toBe('details'));
  });

  it('should manage guest info', async () => {
    let capturedCtx: any;
    render(
      <BookingProvider>
        <BookingConsumer onRender={ctx => { capturedCtx = ctx; }} />
      </BookingProvider>
    );

    await waitFor(() => expect(capturedCtx.configLoading).toBe(false));

    expect(capturedCtx.guestInfo.firstName).toBe('');
    expect(capturedCtx.guestInfo.email).toBe('');

    act(() => {
      capturedCtx.setGuestInfo({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '+1 555-1234',
        specialRequests: 'Late check-in',
      });
    });

    await waitFor(() => expect(capturedCtx.guestInfo.firstName).toBe('Jane'));
    expect(capturedCtx.guestInfo.email).toBe('jane@example.com');
  });

  it('should manage verification state', async () => {
    let capturedCtx: any;
    render(
      <BookingProvider>
        <BookingConsumer onRender={ctx => { capturedCtx = ctx; }} />
      </BookingProvider>
    );

    await waitFor(() => expect(capturedCtx.configLoading).toBe(false));

    expect(capturedCtx.verificationId).toBeNull();

    act(() => { capturedCtx.setVerificationId('ver-123'); });
    await waitFor(() => expect(capturedCtx.verificationId).toBe('ver-123'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — BookingSettingsTab
// ─────────────────────────────────────────────────────────────────────────────

describe('BookingSettingsTab', () => {
  // Import at top level — the jest.mock is already hoisted
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BookingSettingsTab = require('../../../components/admin/BookingSettingsTab').default;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({ data: { data: {} } });
  });

  it('should render with default settings', async () => {
    const showSnackbar = jest.fn();
    render(<BookingSettingsTab showSnackbar={showSnackbar} />);

    await waitFor(() => {
      expect(screen.getByText('admin.settings.booking.heading')).toBeInTheDocument();
    });
    expect(screen.getByText('admin.settings.booking.enabled')).toBeInTheDocument();
  });

  it('should display all embed snippet sections', async () => {
    const showSnackbar = jest.fn();
    render(<BookingSettingsTab showSnackbar={showSnackbar} />);

    await waitFor(() => {
      expect(screen.getByText('admin.settings.booking.widgets.heading')).toBeInTheDocument();
    });

    // Should show both widget snippets and the button link
    expect(screen.getByText('admin.settings.booking.widgets.searchWidget')).toBeInTheDocument();
    expect(screen.getByText('admin.settings.booking.widgets.resultsWidget')).toBeInTheDocument();
    expect(screen.getByText('admin.settings.booking.widgets.buttonLink')).toBeInTheDocument();
  });

  it('should display all configuration sections', async () => {
    const showSnackbar = jest.fn();
    render(<BookingSettingsTab showSnackbar={showSnackbar} />);

    await waitFor(() => {
      expect(screen.getByText('admin.settings.booking.appearance.heading')).toBeInTheDocument();
    });

    expect(screen.getByText('admin.settings.booking.contact.heading')).toBeInTheDocument();
    expect(screen.getByText('admin.settings.booking.rules.heading')).toBeInTheDocument();
    expect(screen.getByText('admin.settings.booking.widgets.heading')).toBeInTheDocument();
  });

  it('should show Save button', async () => {
    const showSnackbar = jest.fn();
    render(<BookingSettingsTab showSnackbar={showSnackbar} />);

    await waitFor(() => {
      expect(screen.getByText('admin.settings.booking.save')).toBeInTheDocument();
    });
  });
});
