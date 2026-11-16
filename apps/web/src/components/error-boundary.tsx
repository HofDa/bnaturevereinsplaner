import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../lib/i18n';
import { isChunkError, reportError } from '../lib/error-report';

/**
 * Last line of defence: a failure while rendering would otherwise leave an empty page. Shows a
 * way back instead and reports what happened. Uses no hooks or providers, because those may
 * be what failed.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (error instanceof Error && info.componentStack && !isChunkError(error))
      error.stack = `${error.stack ?? ''}\n${info.componentStack.split('\n').slice(0, 6).join('\n')}`;
    reportError(error, 'render');
  }
  render() {
    if (this.state.error === null) return this.props.children;
    const outdated = isChunkError(this.state.error);
    return (
      <main className="crash-screen" role="alert">
        <h1>{i18n.t(outdated ? 'crashOutdatedTitle' : 'crashTitle')}</h1>
        <p>{i18n.t(outdated ? 'crashOutdatedBody' : 'crashBody')}</p>
        <div className="crash-actions">
          <button className="button button-primary" onClick={() => window.location.reload()}>
            {i18n.t('crashReload')}
          </button>
          {!outdated && (
            <a className="button button-secondary" href={import.meta.env.BASE_URL}>
              {i18n.t('crashHome')}
            </a>
          )}
        </div>
      </main>
    );
  }
}
