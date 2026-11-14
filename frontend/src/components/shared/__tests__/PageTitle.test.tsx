/**
 * Layout-route contract: the shell mounts once and survives navigation between pages, and each page's
 * `usePageTitle` swaps the header title without an intermediate blank render.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { PageTitleSetterContext, usePageTitle } from '../PageTitle';

// This repo's jest `moduleNameMapper` points `react-router` at a `dist/index.js` that react-router 7 doesn't
// ship (other tests mock the router instead), so load the CJS build directly — after polyfilling the
// TextEncoder it expects and jsdom lacks. The primitives under test are the real ones.
Object.assign(global, { TextEncoder, TextDecoder });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MemoryRouter, Routes, Route, Outlet, useNavigate } = require('react-router/dist/development/index.js') as typeof import('react-router');

let shellMounts = 0;
const renderedTitles: Array<string | undefined> = [];
let go: (path: string) => void = () => undefined;

const Shell: React.FC = () => {
  const [title, setTitle] = React.useState<string | undefined>(undefined);
  React.useEffect(() => { shellMounts += 1; }, []);
  renderedTitles.push(title);
  const navigate = useNavigate();
  go = navigate;
  return (
    <PageTitleSetterContext.Provider value={setTitle}>
      <h1 data-testid="title">{title ?? ''}</h1>
      <Outlet />
    </PageTitleSetterContext.Provider>
  );
};

const PageA: React.FC = () => { usePageTitle('Page A'); return <p>a</p>; };
const PageB: React.FC<{ name: string }> = ({ name }) => { usePageTitle(name); return <p>b</p>; };
const Untitled: React.FC = () => <p>untitled</p>;

const renderApp = () => render(
  <MemoryRouter initialEntries={['/a']}>
    <Routes>
      <Route element={<Shell />}>
        <Route path="/a" element={<PageA />} />
        <Route path="/b" element={<PageB name="Page B" />} />
        <Route path="/c" element={<Untitled />} />
      </Route>
    </Routes>
  </MemoryRouter>
);

beforeEach(() => { shellMounts = 0; renderedTitles.length = 0; });

describe('layout route + usePageTitle', () => {
  it('keeps the shell mounted across navigation', () => {
    renderApp();
    act(() => go('/b'));
    act(() => go('/a'));
    expect(shellMounts).toBe(1);
  });

  it('shows each page title and clears it for a page without one', () => {
    renderApp();
    expect(screen.getByTestId('title')).toHaveTextContent('Page A');
    act(() => go('/b'));
    expect(screen.getByTestId('title')).toHaveTextContent('Page B');
    act(() => go('/c'));
    expect(screen.getByTestId('title')).toHaveTextContent('');
  });

  // Guards the swap itself (old page's cleanup + new page's effect batch into one commit). It can't prove the
  // layout-effect timing — that is about paint, which jsdom doesn't model — so that part is covered by review.
  it('never commits a blank title when moving between two titled pages', () => {
    renderApp();
    renderedTitles.length = 0;
    act(() => go('/b'));
    expect(renderedTitles).not.toContain(undefined);
  });
});
