import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, GlobalStyles } from '@mui/material';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import theme from './theme';
import { AuthProvider } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';
import Layout from './components/layout/Layout';

// Pages
import LoginPage from './pages/customer/LoginPage';
import RegistrationSuccessPage from './pages/customer/RegistrationSuccessPage';
import EmailVerificationPage from './pages/customer/EmailVerificationPage';
import ForgotPasswordPage from './pages/customer/ForgotPasswordPage';
import PasswordResetPage from './pages/customer/PasswordResetPage';
import ReservationsPage from './pages/customer/ReservationsPage';
import ProfilePage from './pages/customer/ProfilePage';
import ReservationSummaryPage from './pages/customer/ReservationSummaryPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import RoomsManagement from './pages/admin/RoomsManagement';
import AmenitiesManagement from './pages/admin/AmenitiesManagement';
import ReservationManagement from './pages/admin/ReservationManagement';
import UsersManagement from './pages/admin/UsersManagement';
import EventTypesManagement from './pages/admin/EventTypesManagement';
import PriceManagement from './pages/admin/PriceManagement';
import ScheduleSummary from './pages/admin/ScheduleSummary';
import Accommodations from './pages/admin/Accommodations';
import MediaManagement from './pages/admin/MediaManagement';
import RolesManagement from './pages/admin/RolesManagement';
import Revenue from './pages/admin/Revenue';
import Commissions from './pages/admin/Commissions';
import WristbandControl from './pages/admin/WristbandControl';
import Settings from './pages/admin/Settings';
import CompaniesManagement from './pages/admin/CompaniesManagement';
import GuestsManagement from './pages/admin/GuestsManagement';
import CreditAccountsManagement from './pages/admin/CreditAccountsManagement';
import CashierClosuresPage from './pages/admin/CashierClosuresPage';
import ProtectedRoute from './components/common/ProtectedRoute';
import NotFoundPage from './pages/NotFoundPage';

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

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {globalStyles}
      <AuthProvider>
        <Router>
          <SettingsProvider>
          <Routes>
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
            <Route path="/admin/amenities" element={
              <ProtectedRoute requiredPermission="admin.amenities" requiredSection="amenities">
                <AmenitiesManagement />
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
            <Route path="/admin/media" element={
              <ProtectedRoute requiredPermission="admin.media" requiredSection="media">
                <MediaManagement />
              </ProtectedRoute>
            } />
            <Route path="/admin/schedule" element={
              <ProtectedRoute requiredPermission="admin.schedule" requiredSection="schedule">
                <ScheduleSummary />
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
            <Route path="/admin/roles" element={
              <ProtectedRoute requiredPermission="admin.roles" requiredSection="roles">
                <RolesManagement />
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute requiredPermission="admin.users" requiredSection="users">
                <UsersManagement />
              </ProtectedRoute>
            } />
            <Route path="/admin/event-types" element={
              <ProtectedRoute requiredPermission="admin.eventTypes" requiredSection="event-types">
                <EventTypesManagement />
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

                  {/* Protected routes that require authentication */}
                  <Route path="/reservations" element={
                    <ProtectedRoute>
                      <ReservationsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/profile" element={
                    <ProtectedRoute>
                      <ProfilePage />
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
          </SettingsProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
