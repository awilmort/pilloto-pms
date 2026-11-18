/**
 * /contabilidad: Pilloto Contabilidad's own page — the four tiers with live prices (falling back to
 * the configured ones), the suite discount, and no hotel-only framing in the hero.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../i18n';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/contabilidad', hash: '', search: '' }),
  Link: ({ children }: any) => children,
}));
const mockGet = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));

/* eslint-disable import/first */
import AccountingLandingPage from '../AccountingLandingPage';
/* eslint-enable import/first */

const plan = (slug: string, name: string, monthlyPrice: number, transactions: number, maxUsers: number | null) => ({
  slug, name, monthlyPrice, features: {}, limits: { maxUsers, maxWarehouses: 1 }, includedEcf: { plan: 'essential', transactions },
});

beforeAll(async () => { await i18n.changeLanguage('es'); });

it('shows the four accounting tiers with the live prices and the suite discount', async () => {
  mockGet.mockResolvedValue({ data: { data: {
    currency: 'DOP', taxPercent: 18, suiteDiscountPercent: 25, pms: [],
    accounting: [plan('invoicing', 'Facturación', 1690, 300, 2), plan('essentials', 'Esencial', 4190, 300, 3), plan('pro', 'Pro', 6990, 1000, 6), plan('plus', 'Plus', 10790, 3000, 15)],
  } } });
  render(<AccountingLandingPage />);
  expect(screen.getByText(/para empresas dominicanas/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('RD$1,690')).toBeInTheDocument());
  expect(screen.getByText('RD$10,790')).toBeInTheDocument();
  expect(screen.getByText('3,000 e-CF al mes incluidos')).toBeInTheDocument();
  expect(screen.getByText(/25% de descuento en Pilloto Contabilidad/)).toBeInTheDocument();
  expect(screen.getByText('¿Se te quedó corto el Facturador Gratuito?')).toBeInTheDocument();
});
