import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../../i18n';
import OverviewCards from '../OverviewCards';
import type { BillingOverview } from '../../../../types/billing';

const overview = (over: Partial<BillingOverview> = {}): BillingOverview => ({
  period: '2026-11',
  outstanding: { count: 2, balance: 25000 },
  overdue: { count: 1, balance: 8508.3 },
  collectedThisMonth: { count: 3, amount: 18508.3 },
  ecf: { notIssued: 0, needAttention: 0 },
  issuer: { state: 'ready', configured: true },
  ...over,
});

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('OverviewCards', () => {
  it('shows what is owed, what is overdue and what came in, in pesos', () => {
    render(<OverviewCards overview={overview()} onNavigate={jest.fn()} />);
    expect(screen.getByText('RD$25,000.00')).toBeInTheDocument();
    expect(screen.getByText('RD$8,508.30')).toBeInTheDocument();
    expect(screen.getByText('RD$18,508.30')).toBeInTheDocument();
    expect(screen.getByText('Open charges: 2')).toBeInTheDocument();
    expect(screen.getByText(/November 2026 · Payments: 3/)).toBeInTheDocument();
  });

  it('is quiet when Pilloto can issue and every e-CF is fine', () => {
    render(<OverviewCards overview={overview()} onNavigate={jest.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns that e-CF will wait when Pilloto’s own e-invoicing is not ready, and links to its setup', () => {
    const onNavigate = jest.fn();
    render(<OverviewCards overview={overview({ issuer: { state: 'in_progress', configured: true } })} onNavigate={onNavigate} />);
    expect(screen.getByText(/Pilloto’s own e-invoicing is not ready/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(onNavigate).toHaveBeenCalledWith('ecf');
  });

  it('counts payments without an e-CF and e-CF that need a person, each leading to the payments', () => {
    const onNavigate = jest.fn();
    render(<OverviewCards overview={overview({ ecf: { notIssued: 1, needAttention: 2 } })} onNavigate={onNavigate} />);
    expect(screen.getByText('Payments without an e-CF: 1')).toBeInTheDocument();
    expect(screen.getByText('e-CF rejected or never confirmed: 2')).toBeInTheDocument();
    screen.getAllByRole('button', { name: 'Review' }).forEach((b) => fireEvent.click(b));
    expect(onNavigate).toHaveBeenCalledWith('payments');
    expect(screen.getByText('3')).toBeInTheDocument(); // the e-CF-to-review card adds both
  });

  it('renders nothing until it has data', () => {
    const { container } = render(<OverviewCards overview={null} onNavigate={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
