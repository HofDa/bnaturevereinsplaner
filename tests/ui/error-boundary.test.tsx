// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '../../apps/web/src/lib/i18n';
import { ErrorBoundary } from '../../apps/web/src/components/error-boundary';
import { ignorable, isChunkError } from '../../apps/web/src/lib/error-report';
import { ApiError } from '../../apps/web/src/lib/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function Broken({ error }: { error: Error }): never {
  throw error;
}
describe('crash screen', () => {
  it('replaces a page that fails to render with a way back', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Broken error={new TypeError('x is undefined')} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Hier ist etwas schiefgelaufen.');
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Zur Übersicht' })).toBeVisible();
  });
  it('asks for a reload when a page of an older release is gone', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Broken
          error={new TypeError('Failed to fetch dynamically imported module: /assets/a.js')}
        />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Eine neue Version ist verfügbar.');
    expect(screen.queryByRole('link', { name: 'Zur Übersicht' })).toBeNull();
  });
  it('renders children untouched when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>alles gut</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('alles gut')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
describe('error reporting filter', () => {
  it('recognises missing chunks across browsers', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x/assets/a.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ])
      expect(isChunkError(new TypeError(message)), message).toBe(true);
    expect(isChunkError(new TypeError('x is undefined'))).toBe(false);
  });
  it('skips expected failures and reports real ones', () => {
    expect(ignorable(new ApiError(422, 'VALIDATION_ERROR'), '')).toBe(true);
    expect(ignorable(new DOMException('aborted', 'AbortError'), '')).toBe(true);
    expect(ignorable(new TypeError('Failed to fetch'), '')).toBe(true);
    expect(ignorable(new Error('ResizeObserver loop limit exceeded'), '')).toBe(true);
    expect(ignorable(new Error('x'), 'at f (chrome-extension://abc/content.js:1:1)')).toBe(true);
    expect(ignorable(new TypeError('x is undefined'), 'at f (/assets/a.js:1:1)')).toBe(false);
  });
});
