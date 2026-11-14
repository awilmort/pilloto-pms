/** PageErrorBoundary: a crashing page is replaced by a message; everything around it keeps working. */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import mockEn from '../../../locales/en/translation.json';

jest.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/x' }) }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// eslint-disable-next-line import/first
import { PageErrorBoundary } from '../PageErrorBoundary';

const title = mockEn.common.pageErrorTitle;
const tryAgain = mockEn.common.tryAgain;

let shouldThrow = true;
const Page: React.FC = () => {
  if (shouldThrow) throw new Error('boom: reading adults of undefined');
  return <p>page content</p>;
};

beforeEach(() => { shouldThrow = true; jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

describe('PageErrorBoundary', () => {
  it('renders the page untouched when nothing is wrong', () => {
    shouldThrow = false;
    render(<PageErrorBoundary><Page /></PageErrorBoundary>);
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces only the crashed page — the shell around it stays', () => {
    render(
      <div>
        <nav>sidebar</nav>
        <PageErrorBoundary><Page /></PageErrorBoundary>
      </div>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(title);
    expect(screen.getByText('sidebar')).toBeInTheDocument();
    expect(screen.queryByText('page content')).toBeNull();
  });

  it('logs the error for whoever debugs it', () => {
    render(<PageErrorBoundary><Page /></PageErrorBoundary>);
    expect(console.error).toHaveBeenCalledWith('Page crashed:', expect.objectContaining({ message: expect.stringContaining('boom') }), expect.any(String));
  });

  it('"Try again" renders the page again, and it recovers if the problem is gone', () => {
    render(<PageErrorBoundary><Page /></PageErrorBoundary>);
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: tryAgain }));
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('clears the error when the route changes, so leaving a broken page recovers', () => {
    const { rerender } = render(<PageErrorBoundary resetKey="/a"><Page /></PageErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    shouldThrow = false;
    rerender(<PageErrorBoundary resetKey="/b"><Page /></PageErrorBoundary>);
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('stays in the error state while the route does not change', () => {
    const { rerender } = render(<PageErrorBoundary resetKey="/a"><Page /></PageErrorBoundary>);
    shouldThrow = false;
    rerender(<PageErrorBoundary resetKey="/a"><Page /></PageErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
