/**
 * The upgrade prompt: an API plan refusal (or a locked nav item) explains which plan unlocks it and
 * links to "Plan & billing" for whoever manages the subscription.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../i18n';

const mockNavigate = jest.fn();
let mockPath = '/accounting/journal-entries';
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate, useLocation: () => ({ pathname: mockPath }) }));
let mockUser: any = { isSuperAdmin: true };
jest.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, resolvedAppRoles: {} }) }));

/* eslint-disable import/first */
import UpgradePromptHost from '../UpgradePromptHost';
import { isPlanDenial, showPlanPrompt } from '../../../lib/planPrompt';
/* eslint-enable import/first */

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { jest.clearAllMocks(); mockPath = '/accounting/journal-entries'; mockUser = { isSuperAdmin: true }; });

it('recognises a plan denial body', () => {
  expect(isPlanDenial({ code: 'PLAN_FEATURE', plan: { product: 'accounting' } })).toBe(true);
  expect(isPlanDenial({ code: 'BILLING_STATE' })).toBe(false);
});

it('names the module and the plan that includes it, and goes to the Accounting plan page', () => {
  render(<UpgradePromptHost />);
  act(() => showPlanPrompt({ code: 'PLAN_FEATURE', plan: { product: 'accounting', feature: 'generalLedger', requiredPlan: 'essentials' } }));
  expect(screen.getByText(/General ledger & financial statements is not included/)).toBeInTheDocument();
  expect(screen.getByText(/from the Esencial plan/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'See plans' }));
  expect(mockNavigate).toHaveBeenCalledWith('/accounting/subscription');
});

it('explains a limit and, for a user who cannot change the plan, says who can', () => {
  mockPath = '/admin/rooms';
  mockUser = { isSuperAdmin: false };
  render(<UpgradePromptHost />);
  act(() => showPlanPrompt({ code: 'PLAN_LIMIT', plan: { product: 'pms', limit: 'rooms', max: 15, requiredPlan: 'pro' } }));
  expect(screen.getByText(/up to 15 active rooms/)).toBeInTheDocument();
  expect(screen.getByText(/Ask your account owner/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'See plans' })).not.toBeInTheDocument();
});
