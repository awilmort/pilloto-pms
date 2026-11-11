import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from '../../../../i18n';
import IssuerSetupGuide from '../IssuerSetupGuide';
import type { BillingIssuer } from '../../../../types/billing';

const issuer = (over: Partial<BillingIssuer> = {}): BillingIssuer => ({
  configured: false, allowUncertified: false, state: 'inactive', linked: false, environment: null, certification: null, rnc: null,
  webhookRegistered: false, lastSyncedAt: null, appUrl: 'https://app.billingsoft.test', notifyEmail: '', ...over,
});

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('IssuerSetupGuide', () => {
  it('walks through BillingSoft, the server settings and what is needed to issue for real', () => {
    render(<IssuerSetupGuide issuer={issuer()} />);
    expect(screen.getByText('Setup guide: connect Pilloto to BillingSoft')).toBeInTheDocument();
    expect(screen.getByText('A. In BillingSoft: get Pilloto’s key')).toBeInTheDocument();
    expect(screen.getByText('B. In Pilloto’s server: add the key and link')).toBeInTheDocument();
    expect(screen.getByText('C. To issue for real')).toBeInTheDocument();
    expect(screen.getByText(/Convertir en socio/)).toBeInTheDocument();
    expect(screen.getByText(/Integraciones → Claves de API → Crear clave/)).toBeInTheDocument();
    expect(screen.getByText(/Producción \(ecf\)/)).toBeInTheDocument();
  });

  it('lists the backend variables and says which one is truly required', () => {
    render(<IssuerSetupGuide issuer={issuer()} />);
    const table = screen.getByRole('table', { name: 'Backend variables' });
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;
    expect(within(row('BILLINGSOFT_PARTNER_API_KEY')).getByText('Required')).toBeInTheDocument();
    expect(within(row('BACKEND_PUBLIC_URL')).getByText('Recommended')).toBeInTheDocument();
    expect(within(row('BILLINGSOFT_API_URL')).getByText('Optional')).toBeInTheDocument();
    // the link variable is only for people clicking, and the guide says Pilloto never calls it
    expect(within(row('BILLINGSOFT_APP_URL')).getByText(/Pilloto never calls it/)).toBeInTheDocument();
    // the webhook address is explained as BillingSoft calling Pilloto, with the polling fallback
    expect(within(row('BACKEND_PUBLIC_URL')).getByText(/BillingSoft calls it to tell Pilloto what DGII decided/)).toBeInTheDocument();
    expect(within(row('BACKEND_PUBLIC_URL')).getByText(/asks BillingSoft every minute/)).toBeInTheDocument();
  });

  it('links to BillingSoft’s own pages for what only a person can do there', () => {
    render(<IssuerSetupGuide issuer={issuer({ appUrl: 'https://app.billingsoft.test/' })} />);
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Certificado')).toBe('https://app.billingsoft.test/certificado');
    expect(href('Certificación')).toBe('https://app.billingsoft.test/certificacion');
    expect(href('Secuencias')).toBe('https://app.billingsoft.test/secuencias');
    expect(href('Open Integraciones')).toBe('https://app.billingsoft.test/integraciones');
  });

  it('marks each part done from what the server reports', () => {
    const { rerender } = render(<IssuerSetupGuide issuer={issuer()} />);
    expect(screen.getAllByText('To do')).toHaveLength(3);
    expect(screen.queryByText('Done')).not.toBeInTheDocument();

    rerender(<IssuerSetupGuide issuer={issuer({ configured: true })} />);
    expect(screen.getAllByText('Done')).toHaveLength(1);

    rerender(<IssuerSetupGuide issuer={issuer({ configured: true, linked: true, state: 'in_progress' })} />);
    expect(screen.getAllByText('Done')).toHaveLength(2);
    expect(screen.getAllByText('To do')).toHaveLength(1);

    rerender(<IssuerSetupGuide issuer={issuer({ configured: true, linked: true, state: 'ready' })} />);
    expect(screen.getAllByText('Done')).toHaveLength(3);
    expect(screen.getByText('Everything is set up. Keep this for reference.')).toBeInTheDocument();
  });

  it('is open while the setup is unfinished and closed once Pilloto is ready', () => {
    const { rerender } = render(<IssuerSetupGuide issuer={issuer()} />);
    expect(screen.getByRole('button', { name: /Setup guide/ })).toHaveAttribute('aria-expanded', 'true');
    rerender(<IssuerSetupGuide issuer={issuer({ configured: true, linked: true, state: 'ready' })} />);
    // `defaultExpanded` only applies on first render: a fresh mount in the ready state starts closed
    const { container } = render(<IssuerSetupGuide issuer={issuer({ configured: true, linked: true, state: 'ready' })} />);
    expect(within(container).getByRole('button', { name: /Setup guide/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
