import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ErrorReport } from '@bnature/contracts';
import { api, apiSend, errorMessage, queryClient } from '../lib/api';
import { Button, Empty, Notice, QueryView } from '../components/ui';

const key = ['error-reports'];

/** Unexpected failures of the app and the server, newest first, for whoever maintains it. */
export function ErrorReports() {
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<{ items: ErrorReport[] }>('/error-reports'),
  });
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  const when = (value: string) =>
    new Intl.DateTimeFormat(i18n.language === 'it' ? 'it-IT' : 'de-IT', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  async function dismiss(id: string) {
    setBusy(id);
    setFailure('');
    try {
      await apiSend(`/error-reports/${id}/dismiss`, { method: 'POST' });
      queryClient.setQueryData<{ items: ErrorReport[] }>(key, (data) =>
        data ? { items: data.items.filter((item) => item.id !== id) } : data,
      );
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="panel error-reports" aria-labelledby="error-reports-title">
      <header className="error-reports-head">
        <h2 id="error-reports-title">{t('errorReportsTitle')}</h2>
        <p className="muted">{t('errorReportsIntro')}</p>
      </header>
      {failure && <Notice error>{failure}</Notice>}
      <QueryView query={query}>
        {(data) =>
          data.items.length ? (
            <ul className="error-report-list">
              {data.items.map((report) => (
                <li key={report.id}>
                  <div className="error-report-summary">
                    <span className={`error-report-source source-${report.source}`}>
                      {t(report.source === 'web' ? 'errorReportWeb' : 'errorReportApi')}
                    </span>
                    <strong>{report.name}</strong>
                    <span className="error-report-count">
                      {t('errorReportCount', { count: report.occurrences })}
                    </span>
                  </div>
                  <p className="error-report-message">{report.message || '–'}</p>
                  <p className="muted error-report-meta">
                    {t('errorReportLastSeen', { when: when(report.lastSeenAt) })}
                    {report.location && ` · ${report.location}`}
                    {report.release && ` · ${t('errorReportRelease', { release: report.release })}`}
                  </p>
                  <details>
                    <summary>{t('errorReportDetails')}</summary>
                    <pre>{report.stack || t('errorReportNoStack')}</pre>
                    <p className="muted">
                      {t('errorReportFirstSeen', { when: when(report.firstSeenAt) })}
                      {report.userAgent && ` · ${report.userAgent}`}
                    </p>
                  </details>
                  <Button
                    variant="secondary"
                    disabled={busy === report.id}
                    onClick={() => void dismiss(report.id)}
                  >
                    {t('errorReportDismiss')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('errorReportsEmpty')} />
          )
        }
      </QueryView>
    </section>
  );
}
