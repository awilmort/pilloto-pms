import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, GlobalStyles, CircularProgress, Box } from '@mui/material';
import { ToastContainer } from 'react-toastify';
import { HelmetProvider, Helmet } from 'react-helmet-async';
import 'react-toastify/dist/ReactToastify.css';

import theme from './theme';
import accountingTheme from './accountingTheme';
import { AuthProvider } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { TenantProvider, useTenant } from './contexts/TenantContext';
import Layout from './components/layout/Layout';

// Platform portal pages (admin.pilloto.com)
import TenantsPage from './pages/platform/TenantsPage';
import OtaSyncPage from './pages/platform/OtaSyncPage';
import SuperAdminProfilePage from './pages/platform/SuperAdminProfilePage';
import TenantNotFoundPage from './pages/TenantNotFoundPage';

// Pages
import LoginPage from './pages/customer/LoginPage';
import RegistrationSuccessPage from './pages/customer/RegistrationSuccessPage';
import EmailVerificationPage from './pages/customer/EmailVerificationPage';
import ForgotPasswordPage from './pages/customer/ForgotPasswordPage';
import PasswordResetPage from './pages/customer/PasswordResetPage';
import ReservationsPage from './pages/customer/ReservationsPage';
import ReservationSummaryPage from './pages/customer/ReservationSummaryPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import RoomsManagement from './pages/admin/RoomsManagement';
import ReservationManagement from './pages/admin/ReservationManagement';
import UsersManagement from './pages/admin/UsersManagement';
import PriceManagement from './pages/admin/PriceManagement';
import ScheduleSummary from './pages/admin/ScheduleSummary';
import BookingCalendar from './pages/admin/BookingCalendar';
import Accommodations from './pages/admin/Accommodations';
import Revenue from './pages/admin/Revenue';
import Commissions from './pages/admin/Commissions';
import WristbandControl from './pages/admin/WristbandControl';
import Settings from './pages/admin/Settings';
import CompaniesManagement from './pages/admin/CompaniesManagement';
import GuestsManagement from './pages/admin/GuestsManagement';
import CreditAccountsManagement from './pages/admin/CreditAccountsManagement';
import CashierClosuresPage from './pages/admin/CashierClosuresPage';
import OtaConflictQueue from './pages/admin/OtaConflictQueue';
import EcfInvoicesPage from './pages/admin/EcfInvoicesPage';
import ReportsPage from './pages/admin/ReportsPage';
import CorporatePriceActionPage from './pages/admin/CorporatePriceActionPage';
import AdminProfilePage from './pages/admin/AdminProfilePage';
import AccountingDashboard from './pages/accounting/AccountingDashboard';
import AccountingProfilePage from './pages/accounting/AccountingProfilePage';
import AccountingSettingsPage from './pages/accounting/AccountingSettingsPage';
import InventoryProductsPage from './pages/accounting/InventoryProductsPage';
import InventoryWarehousesPage from './pages/accounting/InventoryWarehousesPage';
import InvoicesPage from './pages/accounting/InvoicesPage';
import QuotesPage from './pages/accounting/QuotesPage';
import CreditNotesPage from './pages/accounting/CreditNotesPage';
import DebitNotesPage from './pages/accounting/DebitNotesPage';
import JournalEntriesPage from './pages/accounting/JournalEntriesPage';
import AccountingReportsPage from './pages/accounting/ReportsPage';
import CustomersPage from './pages/accounting/CustomersPage';
import CityLedgerPage from './pages/accounting/CityLedgerPage';
import BillsPage from './pages/accounting/BillsPage';
import SuppliersPage from './pages/accounting/SuppliersPage';
import AccountingRoute from './components/accounting/AccountingRoute';
import ProtectedRoute from './components/common/ProtectedRoute';
import NotFoundPage from './pages/NotFoundPage';
import LandingPage from './pages/marketing/LandingPage';
import CrossTenantLoginPage from './pages/marketing/CrossTenantLoginPage';
import ContactPage from './pages/marketing/ContactPage';
import LegalCenterPage from './pages/marketing/LegalCenterPage';
import PrivacyPolicyPage from './pages/marketing/PrivacyPolicyPage';
import TermsOfServicePage from './pages/marketing/TermsOfServicePage';
import CookiePolicyPage from './pages/marketing/CookiePolicyPage';
import AcceptableUsePage from './pages/marketing/AcceptableUsePage';
import SecurityPage from './pages/marketing/SecurityPage';
import AccessibilityPage from './pages/marketing/AccessibilityPage';
import CookieConsent from './components/marketing/CookieConsent';

// Public booking engine pages
import BookingPage from './pages/booking/BookingPage';
import BookingTermsPage from './pages/booking/BookingTermsPage';
import BookingPrivacyPage from './pages/booking/BookingPrivacyPage';
import BookingReservationPage from './pages/booking/BookingReservationPage';
import { BookingProvider } from './contexts/BookingContext';

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
        fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      },
      '#root': {
        height: '100%',
        width: '100%',
      },
      '.swiper-pagination-bullet': {
        backgroundColor: 'rgba(255, 255, 255, 0.5) !important',
      },
      '.swiper-pagination-bullet-active': {
        backgroundColor: '#F4A460 !important',
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
      <Routes>
        <Route path="*" element={<CrossTenantLoginPage />} />
      </Routes>
    </Router>
  );
}

// ─── Marketing site (pilloto.com — no subdomain) ──────────────────────────────
function MarketingApp() {
  return (
    <Router>
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
      <CookieConsent />
    </Router>
  );
}

// ─── Platform portal (admin.pilloto.com) ───────────────────────────────────────
function PlatformApp() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/platform/tenants" replace />} />
          <Route path="/login" element={
            <ProtectedRoute requireAuth={false}>
              <LoginPage />
            </ProtectedRoute>
          } />
          <Route path="/platform/tenants" element={
            <ProtectedRoute>
              <TenantsPage />
            </ProtectedRoute>
          } />
          <Route path="/platform/ota" element={
            <ProtectedRoute>
              <OtaSyncPage />
            </ProtectedRoute>
          } />
          <Route path="/platform/profile" element={
            <ProtectedRoute>
              <SuperAdminProfilePage />
            </ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/platform/tenants" replace />} />
        </Routes>
        {toastConfig}
      </Router>
    </AuthProvider>
  );
}

// Switches to the emerald accounting theme under `/accounting/*`, replacing (not
// merging with) the outer pms theme for that subtree — both themes are complete
// MUI theme objects, per Phase 2.1's "distinct theme accent" requirement.
function AppThemeSwitcher({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isAccounting = location.pathname.startsWith('/accounting');
  return (
    <ThemeProvider theme={isAccounting ? accountingTheme : theme}>
      {children}
    </ThemeProvider>
  );
}

// ─── Regular tenant app ────────────────────────────────────────────────────────
function TenantApp() {
  return (
    <AuthProvider>
      <Router>
        <AppThemeSwitcher>
        <SettingsProvider>
          <Routes>
            {/* Accounting routes — sibling app tree to /admin/*, gated by AccountingRoute */}
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

            {/* Admin routes without main layout (they use AdminLayout internally) */}
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

            <Route path="/admin/ota-conflicts" element={
              <ProtectedRoute requiredPermission="admin.ota.view">
                <OtaConflictQueue />
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

                  {/* 404 catch-all inside Layout */}
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Layout>
            } />
          </Routes>
          {toastConfig}
        </SettingsProvider>
        </AppThemeSwitcher>
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

  if (tenantNotFound) return <TenantNotFoundPage />;

  if (isLoginPortal) return <LoginPortalApp />;

  // No subdomain and not platform → marketing site
  if (!isPlatform && !tenantSlug) return <MarketingApp />;

  return isPlatform ? <PlatformApp /> : <TenantApp />;
}

function App() {
  return (
    <HelmetProvider>
      <Helmet>
        <link rel="icon" href="/favicon/favicon.ico" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-16x16-light.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-32x32-light.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon/favicon-180x180-light.png" />
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
