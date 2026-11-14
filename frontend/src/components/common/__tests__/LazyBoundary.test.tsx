/** LazyBoundary: loader while a chunk loads, recovery UI for a stale chunk, real errors left alone. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LazyBoundary, { isChunkLoadError } from '../LazyBoundary';

const chunkError = () => Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' });

beforeEach(() => {
  // A recent reload is on record, so the boundary shows its message instead of reloading the jsdom window.
  sessionStorage.setItem('pilloto:chunk-reload-at', String(Date.now()));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); sessionStorage.clear(); });

describe('isChunkLoadError', () => {
  it('recognises webpack and native dynamic-import failures', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /x.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('LazyBoundary', () => {
  it('shows the page once its chunk has loaded', async () => {
    const Page = React.lazy(() => Promise.resolve({ default: () => <p>loaded page</p> }));
    render(<LazyBoundary><Page /></LazyBoundary>);
    expect(await screen.findByText('loaded page')).toBeInTheDocument();
  });

  it('offers a reload when the chunk is gone', async () => {
    const Page = React.lazy(() => Promise.reject(chunkError()));
    render(<LazyBoundary><Page /></LazyBoundary>);
    expect(await screen.findByRole('button')).toBeInTheDocument();
  });

  it('does not swallow other errors', () => {
    const Boom: React.FC = () => { throw new Error('real bug'); };
    class Outer extends React.Component<{ children: React.ReactNode }, { caught: string }> {
      state = { caught: '' };
      static getDerivedStateFromError(e: Error) { return { caught: e.message }; }
      render() { return this.state.caught ? <p>outer caught: {this.state.caught}</p> : this.props.children; }
    }
    render(<Outer><LazyBoundary><Boom /></LazyBoundary></Outer>);
    expect(screen.getByText('outer caught: real bug')).toBeInTheDocument();
  });
});
