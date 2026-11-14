import React, { lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, GlobalStyles, CircularProgress, Box } from '@mui/material';
import { ToastContainer } from 'react-toastify';
import { HelmetProvider, Helmet } from 'react-helmet-async';
import 'react-toastify/dist/ReactToastify.css';

import theme from './theme';
import { BRAND, FONT_UI } from './brand';
import { AuthProvider } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { TenantProvider, useTenant } from './contexts/TenantContext';
import Layout from './components/layout/Layout';

import AccountingRoute from './components/accounting/AccountingRoute';
import ProtectedRoute from './components/common/ProtectedRoute';
import CookieConsent from './components/marketing/CookieConsent';

import { BookingProvider } from './contexts/BookingContext';
import LazyBoundary from './components/common/LazyBoundary';
import RoutedErrorBoundary from './components/common/PageErrorBoundary';

// Every page and app shell is its own chunk: a visitor downloads only what the route they open needs.
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const AccountingLayout = lazy(() => import('./components/accounting/AccountingLayout'));
const PlatformLayout = lazy(() => import('./pages/platform/PlatformLayout'));
const TenantsPage = lazy(() => import('./pages/platform/TenantsPage'));
const SuperAdminProfilePage = lazy(() => import('./pages/platform/SuperAdminProfilePage'));
const ChannelManagerPage = lazy(() => import('./pages/platform/ChannelManagerPage'));
const BillingPage = lazy(() => import('./pages/platform/BillingPage'));
const TenantNotFoundPage = lazy(() => import('./pages/TenantNotFoundPage'));
const LoginPage = lazy(() => import('./pages/customer/LoginPage'));
const RegistrationSuccessPage = lazy(() => import('./pages/customer/RegistrationSuccessPage'));
const EmailVerificationPage = lazy(() => import('./pages/customer/EmailVerificationPage'));
const ForgotPasswordPage = lazy(() => import('./pages/customer/ForgotPasswordPage'));
const PasswordResetPage = lazy(() => import('./pages/customer/PasswordResetPage'));
const SetPasswordPage = lazy(() => import('./pages/customer/SetPasswordPage'));
const ReservationsPage = lazy(() => import('./pages/customer/ReservationsPage'));
const ReservationSummaryPage = lazy(() => import('./pages/customer/ReservationSummaryPage'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const RoomsManagement = lazy(() => import('./pages/admin/RoomsManagement'));
const ReservationManagement = lazy(() => import('./pages/admin/ReservationManagement'));
const ReservationDetailPage = lazy(() => import('./pages/admin/ReservationDetailPage'));
const UsersManagement = lazy(() => import('./pages/admin/UsersManagement'));
const PriceManagement = lazy(() => import('./pages/admin/PriceManagement'));
const ChannelAlertsPage = lazy(() => import('./pages/admin/ChannelAlertsPage'));
const ScheduleSummary = lazy(() => import('./pages/admin/ScheduleSummary'));
const BookingCalendar = lazy(() => import('./pages/admin/BookingCalendar'));
const Accommodations = lazy(() => import('./pages/admin/Accommodations'));
const Revenue = lazy(() => import('./pages/admin/Revenue'));
const Commissions = lazy(() => import('./pages/admin/Commissions'));
const WristbandControl = lazy(() => import('./pages/admin/WristbandControl'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const CompaniesManagement = lazy(() => import('./pages/admin/CompaniesManagement'));
const GuestsManagement = lazy(() => import('./pages/admin/GuestsManagement'));
const CreditAccountsManagement = lazy(() => import('./pages/admin/CreditAccountsManagement'));
const CashierClosuresPage = lazy(() => import('./pages/admin/CashierClosuresPage'));
const EcfInvoicesPage = lazy(() => import('./pages/admin/EcfInvoicesPage'));
const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'));
const CorporatePriceActionPage = lazy(() => import('./pages/admin/CorporatePriceActionPage'));
const AdminProfilePage = lazy(() => import('./pages/admin/AdminProfilePage'));
const AccountingDashboard = lazy(() => import('./pages/accounting/AccountingDashboard'));
const AccountingProfilePage = lazy(() => import('./pages/accounting/AccountingProfilePage'));
const AccountingSettingsPage = lazy(() => import('./pages/accounting/AccountingSettingsPage'));
const FiscalPage = lazy(() => import('./pages/accounting/FiscalPage'));
const InventoryProductsPage = lazy(() => import('./pages/accounting/InventoryProductsPage'));
const InventoryWarehousesPage = lazy(() => import('./pages/accounting/InventoryWarehousesPage'));
const InvoicesPage = lazy(() => import('./pages/accounting/InvoicesPage'));
const InvoiceEditorPage = lazy(() => import('./pages/accounting/InvoiceEditorPage'));
const InvoiceDetailPage = lazy(() => import('./pages/accounting/InvoiceDetailPage'));
const QuotesPage = lazy(() => import('./pages/accounting/QuotesPage'));
const CreditNotesPage = lazy(() => import('./pages/accounting/CreditNotesPage'));
const DebitNotesPage = lazy(() => import('./pages/accounting/DebitNotesPage'));
const JournalEntriesPage = lazy(() => import('./pages/accounting/JournalEntriesPage'));
const AccountingReportsPage = lazy(() => import('./pages/accounting/ReportsPage'));
const CustomersPage = lazy(() => import('./pages/accounting/CustomersPage'));
const CityLedgerPage = lazy(() => import('./pages/accounting/CityLedgerPage'));
const BillsPage = lazy(() => import('./pages/accounting/BillsPage'));
const SuppliersPage = lazy(() => import('./pages/accounting/SuppliersPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const LandingPage = lazy(() => import('./pages/marketing/LandingPage'));
const CrossTenantLoginPage = lazy(() => import('./pages/marketing/CrossTenantLoginPage'));
const ContactPage = lazy(() => import('./pages/marketing/ContactPage'));
const LegalCenterPage = lazy(() => import('./pages/marketing/LegalCenterPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/marketing/PrivacyPolicyPage'));
const TermsOfServicePage = lazy(() => import('./pages/marketing/TermsOfServicePage'));
const CookiePolicyPage = lazy(() => import('./pages/marketing/CookiePolicyPage'));
const AcceptableUsePage = lazy(() => import('./pages/marketing/AcceptableUsePage'));
const SecurityPage = lazy(() => import('./pages/marketing/SecurityPage'));
const AccessibilityPage = lazy(() => import('./pages/marketing/AccessibilityPage'));
const BookingPage = lazy(() => import('./pages/booking/BookingPage'));
const BookingTermsPage = lazy(() => import('./pages/booking/BookingTermsPage'));
const BookingPrivacyPage = lazy(() => import('./pages/booking/BookingPrivacyPage'));
const BookingReservationPage = lazy(() => import('./pages/booking/BookingReservationPage'));
const ScapeRoomPage = lazy(() => import('./pages/playground/ScapeRoomPage')); // TEMPORARY

const globalStyles = (
  <GlobalStyles
    styles={{
      '*': {
        boxSizing: 'border-box',
        margin: 0,
        padding: 0,
      },
      html: {
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        height: '100%',
        width: '100%',
      },
      body: {
        height: '100%',
        width: '100%',
        fontFamily: FONT_UI,
      },
      '#root': {
        height: '100%',
        width: '100%',
      },
      '.swiper-pagination-bullet': {
        backgroundColor: 'rgba(255, 255, 255, 0.5) !important',
      },
      '.swiper-pagination-bullet-active': {
        backgroundColor: `${BRAND.vermilion} !important`,
      },
    }}
  />
);

const toastConfig = (
  <ToastContainer
    position="top-right"
    autoClose={5000}
    hideProgressBar={false}
    newestOnTop={false}
    closeOnClick
    rtl={false}
    pauseOnFocusLoss
    draggable
    pauseOnHover
    theme="light"
  />
);

// ─── Login portal (login.pilloto.com) ──────────────────────────────────────────
function LoginPortalApp() {
  return (
    <Router>
      <RoutedErrorBoundary fullPage>
        <LazyBoundary fullPage>
          <Routes>
            <Route path="*" element={<CrossTenantLoginPage />} />
          </Routes>
        </LazyBoundary>
      </RoutedErrorBoundary>
    </Router>
  );
}

// ─── Marketing site (pilloto.com — no subdomain) ──────────────────────────────
function MarketingApp() {
  return (
    <Router>
      <RoutedErrorBoundary fullPage>
        <LazyBoundary fullPage>
          <Routes>
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/legal" element={<LegalCenterPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/cookies" element={<CookiePolicyPage />} />
            <Route path="/acceptable-use" element={<AcceptableUsePage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/accessibility" element={<AccessibilityPage />} />
            <Route path="*" element={<LandingPage />} />
          </Routes>
        </LazyBoundary>
      </RoutedErrorBoundary>
      <CookieConsent />
    </Router>
  );
}

// ─── Platform portal (admin.pilloto.com) ───────────────────────────────────────
function PlatformApp() {
  return (
    <AuthProvider>
      <Router>
        <RoutedErrorBoundary fullPage>
          <LazyBoundary fullPage>
            <Routes>
              <Route path="/" element={<Navigate to="/platform/tenants" replace />} />
              <Route path="/login" element={
                <ProtectedRoute requireAuth={false}>
                  <LoginPage />
                </ProtectedRoute>
              } />
              <Route element={<ProtectedRoute><PlatformLayout /></ProtectedRoute>}>
              <Route path="/platform/tenants" element={
                <ProtectedRoute>
                  <TenantsPage />
                </ProtectedRoute>
              } />
              <Route path="/platform/profile" element={
                <ProtectedRoute>
                  <SuperAdminProfilePage />
                </ProtectedRoute>
              } />
              <Route path="/platform/channel-manager" element={
                <ProtectedRoute>
                  <ChannelManagerPage />
                </ProtectedRoute>
              } />
              <Route path="/platform/billing" element={
                <ProtectedRoute>
                  <BillingPage />
                </ProtectedRoute>
              } />
              </Route>
              <Route path="*" element={<Navigate to="/platform/tenants" replace />} />
            </Routes>
          </LazyBoundary>
        </RoutedErrorBoundary>
        {toastConfig}
      </Router>
    </AuthProvider>
  );
}

// ─── Regular tenant app ────────────────────────────────────────────────────────
function TenantApp() {
  return (
    <AuthProvider>
      <Router>
        <SettingsProvider>
          <RoutedErrorBoundary fullPage>
            <LazyBoundary fullPage>
              <Routes>
                {/* Accounting routes — sibling app tree to /admin/*, gated by AccountingRoute.
                    The layout route keeps the shell mounted across pages; pages set their title with usePageTitle. */}
                <Route element={<AccountingRoute><AccountingLayout /></AccountingRoute>}>
                <Route path="/accounting" element={
                  <AccountingRoute>
                    <AccountingDashboard />
                  </AccountingRoute>
                } />
                <Route path="/accounting/profile" element={
                  <AccountingRoute>
                    <AccountingProfilePage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/settings" element={
                  <AccountingRoute requiredPermission="accounting.settings.manage">
                    <AccountingSettingsPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/fiscal" element={
                  <AccountingRoute requiredPermission={['accounting.invoices.view', 'accounting.invoices.manage', 'accounting.creditNotes.view', 'accounting.debitNotes.view', 'accounting.settings.manage']}>
                    <FiscalPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/products" element={
                  <AccountingRoute requiredPermission={['accounting.inventory.view', 'accounting.inventory.manage']}>
                    <InventoryProductsPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/warehouses" element={
                  <AccountingRoute requiredPermission={['accounting.inventory.view', 'accounting.inventory.manage']}>
                    <InventoryWarehousesPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/invoices" element={
                  <AccountingRoute requiredPermission={['accounting.invoices.view', 'accounting.invoices.manage']}>
                    <InvoicesPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/invoices/new" element={
                  <AccountingRoute requiredPermission="accounting.invoices.manage">
                    <InvoiceEditorPage mode="create" />
                  </AccountingRoute>
                } />
                <Route path="/accounting/invoices/:id/edit" element={
                  <AccountingRoute requiredPermission="accounting.invoices.manage">
                    <InvoiceEditorPage mode="edit" />
                  </AccountingRoute>
                } />
                <Route path="/accounting/invoices/:id" element={
                  <AccountingRoute requiredPermission={['accounting.invoices.view', 'accounting.invoices.manage']}>
                    <InvoiceDetailPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/quotes" element={
                  <AccountingRoute requiredPermission={['accounting.quotes.view', 'accounting.quotes.manage']}>
                    <QuotesPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/credit-notes" element={
                  <AccountingRoute requiredPermission={['accounting.creditNotes.view', 'accounting.creditNotes.manage']}>
                    <CreditNotesPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/debit-notes" element={
                  <AccountingRoute requiredPermission={['accounting.debitNotes.view', 'accounting.debitNotes.manage']}>
                    <DebitNotesPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/customers" element={
                  <AccountingRoute requiredPermission="accounting.customers.manage">
                    <CustomersPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/city-ledger" element={
                  <AccountingRoute requiredPermission={['accounting.cityLedger.view', 'accounting.cityLedger.authorize']}>
                    <CityLedgerPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/bills" element={
                  <AccountingRoute requiredPermission={['accounting.bills.view', 'accounting.bills.manage']}>
                    <BillsPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/suppliers" element={
                  <AccountingRoute requiredPermission="accounting.suppliers.manage">
                    <SuppliersPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/journal-entries" element={
                  <AccountingRoute requiredPermission={['accounting.journal.view', 'accounting.journal.manage']}>
                    <JournalEntriesPage />
                  </AccountingRoute>
                } />
                <Route path="/accounting/reports" element={
                  <AccountingRoute requiredPermission="accounting.reports.view">
                    <AccountingReportsPage />
                  </AccountingRoute>
                } />

                </Route>

                {/* Admin routes without main layout — AdminLayout is a layout route, so the shell stays mounted across pages */}
                <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
                <Route path="/admin" element={
                  <ProtectedRoute>
                    <AdminDashboard />
                  </ProtectedRoute>
                } />
                <Route path="/admin/rooms" element={
                  <ProtectedRoute requiredPermission={["admin.rooms", "admin.accommodations"]} requiredSection="rooms">
                    <RoomsManagement />
                  </ProtectedRoute>
                } />
                <Route path="/admin/reservations" element={
                  <ProtectedRoute requiredPermission="admin.reservations" requiredSection="reservations">
                    <ReservationManagement />
                  </ProtectedRoute>
                } />
                <Route path="/admin/reservations/:id" element={
                  <ProtectedRoute requiredPermission="admin.reservations" requiredSection="reservations">
                    <ReservationDetailPage />
                  </ProtectedRoute>
                } />
                <Route path="/admin/channel-alerts" element={
                  <ProtectedRoute requiredPermission="admin.ota.view">
                    <ChannelAlertsPage />
                  </ProtectedRoute>
                } />
                <Route path="/admin/pricing" element={
                  <ProtectedRoute requiredPermission="admin.pricing" requiredSection="pricing">
                    <PriceManagement />
                  </ProtectedRoute>
                } />
                <Route path="/admin/schedule" element={
                  <ProtectedRoute requiredPermission="admin.schedule" requiredSection="schedule">
                    <ScheduleSummary />
                  </ProtectedRoute>
                } />
                <Route path="/admin/booking-calendar" element={
                  <ProtectedRoute requiredPermission="admin.schedule" requiredSection="booking-calendar">
                    <BookingCalendar />
                  </ProtectedRoute>
                } />
                <Route path="/admin/revenue" element={
                  <ProtectedRoute requiredPermission="admin.revenue" requiredSection="revenue">
                    <Revenue />
                  </ProtectedRoute>
                } />
                <Route path="/admin/wristbands" element={
                  <ProtectedRoute requiredSection="wristbands">
                    <WristbandControl />
                  </ProtectedRoute>
                } />
                <Route path="/admin/commissions" element={
                  <ProtectedRoute requiredPermission="admin.commissions" requiredSection="commissions">
                    <Commissions />
                  </ProtectedRoute>
                } />
                <Route path="/admin/accommodations" element={
                  <ProtectedRoute requiredPermission="admin.accommodations" requiredSection="accommodations">
                    <Accommodations />
                  </ProtectedRoute>
                } />
                <Route path="/admin/users" element={
                  <ProtectedRoute requiredPermission="admin.users" requiredSection="users">
                    <UsersManagement />
                  </ProtectedRoute>
                } />
                <Route path="/admin/settings" element={
                  <ProtectedRoute requiredPermission="admin.settings">
                    <Settings />
                  </ProtectedRoute>
                } />
                <Route path="/admin/settings/:section" element={
                  <ProtectedRoute requiredPermission="admin.settings">
                    <Settings />
                  </ProtectedRoute>
                } />
                <Route path="/admin/companies" element={
                  <ProtectedRoute requiredPermission="admin.companies" requiredSection="companies">
                    <CompaniesManagement />
                  </ProtectedRoute>
                } />
                <Route path="/admin/guests" element={
                  <ProtectedRoute requiredPermission="admin.guests" requiredSection="guests">
                    <GuestsManagement />
                  </ProtectedRoute>
                } />
                <Route path="/admin/credit-accounts" element={
                  <ProtectedRoute requiredPermission="admin.creditAccounts" requiredSection="credit-accounts">
                    <CreditAccountsManagement />
                  </ProtectedRoute>
                } />
                <Route path="/admin/cashier-closures" element={
                  <ProtectedRoute requiredPermission="cashier" requiredSection="cashier-closures">
                    <CashierClosuresPage />
                  </ProtectedRoute>
                } />

                <Route path="/admin/invoices/ecf" element={
                  <ProtectedRoute requiredPermission="admin.ecf.view">
                    <EcfInvoicesPage />
                  </ProtectedRoute>
                } />

                <Route path="/admin/reports" element={
                  <ProtectedRoute requiredPermission="admin.ecf.view">
                    <ReportsPage />
                  </ProtectedRoute>
                } />

                <Route path="/admin/reports/:reportId" element={
                  <ProtectedRoute requiredPermission="admin.ecf.view">
                    <ReportsPage />
                  </ProtectedRoute>
                } />

                <Route path="/admin/profile" element={
                  <ProtectedRoute>
                    <AdminProfilePage />
                  </ProtectedRoute>
                } />
                </Route>

                {/* Public booking engine routes (no auth required, own layout) */}
                <Route path="/booking" element={
                  <BookingProvider>
                    <BookingPage />
                  </BookingProvider>
                } />
                <Route path="/booking/terms" element={
                  <BookingProvider>
                    <BookingTermsPage />
                  </BookingProvider>
                } />
                <Route path="/booking/privacy" element={
                  <BookingProvider>
                    <BookingPrivacyPage />
                  </BookingProvider>
                } />
                <Route path="/booking/reservation/:code" element={
                  <BookingProvider>
                    <BookingReservationPage />
                  </BookingProvider>
                } />

                {/* All other routes use the main layout */}
                <Route path="/*" element={
                  <Layout>
                    <Routes>
                      <Route path="/" element={
                        <ProtectedRoute>
                          <Navigate to="/admin" replace />
                        </ProtectedRoute>
                      } />

                      {/* Public reservation summary pages */}
                      <Route path="/reservation/:confirmationToken" element={<ReservationSummaryPage />} />
                      <Route path="/reservation/code/:reservationCode" element={<ReservationSummaryPage />} />

                      {/* Public corporate price action pages (approve / decline from email link) */}
                      <Route path="/reservations/:id/corporate-price/:action" element={<CorporatePriceActionPage />} />

                      {/* Protected routes that require authentication */}
                      <Route path="/reservations" element={
                        <ProtectedRoute>
                          <ReservationsPage />
                        </ProtectedRoute>
                      } />
                      {/* Auth pages (redirect if already logged in) */}
                      <Route path="/login" element={
                        <ProtectedRoute requireAuth={false}>
                          <LoginPage />
                        </ProtectedRoute>
                      } />
                      <Route path="/register" element={
                        <ProtectedRoute requireAuth={false}>
                          <Navigate to="/login" replace />
                        </ProtectedRoute>
                      } />

                      {/* Public auth-related pages */}
                      <Route path="/registration-success" element={<RegistrationSuccessPage />} />
                      <Route path="/verify-email" element={<EmailVerificationPage />} />
                      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                      <Route path="/reset-password" element={<PasswordResetPage />} />
                      <Route path="/set-password" element={<SetPasswordPage />} />

                      {/* 404 catch-all inside Layout */}
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </Layout>
                } />
              </Routes>
            </LazyBoundary>
          </RoutedErrorBoundary>
          {toastConfig}
        </SettingsProvider>
      </Router>
    </AuthProvider>
  );
}

// ─── Root: picks platform vs tenant app ───────────────────────────────────────
function AppContent() {
  const { isPlatform, loading, tenantNotFound, tenantSlug, isLoginPortal } = useTenant();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (tenantNotFound) return <LazyBoundary fullPage><TenantNotFoundPage /></LazyBoundary>;

  if (isLoginPortal) return <LoginPortalApp />;

  // No subdomain and not platform → marketing site
  if (!isPlatform && !tenantSlug) return <MarketingApp />;

  return isPlatform ? <PlatformApp /> : <TenantApp />;
}

function App() {
  // TEMPORARY — youth group escape room (2026-10-17). Remove with pages/playground/.
  if (window.location.pathname.replace(/\/$/, '') === '/playground/scaperoom') return <LazyBoundary fullPage><ScapeRoomPage /></LazyBoundary>;

  return (
    <HelmetProvider>
      <Helmet>
        <link rel="icon" href="/favicon/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/favicon/apple-touch-icon.png" />
      </Helmet>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {globalStyles}
        <TenantProvider>
          <AppContent />
        </TenantProvider>
      </ThemeProvider>
    </HelmetProvider>
  );
}

export default App;
