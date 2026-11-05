import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AuditLog, Page } from '@bnature/contracts';
import { api } from '../lib/api';
import { useSession } from '../app/session';
import { useDebounced } from '../hooks/use-debounced';
import { Empty, PageHeading, Pagination, SearchInput, QueryView } from '../components/ui';
export function Audit() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ['audit', me.activeOrganizationId, page, debounced],
    // Keep the current rows on screen while the next page or filter result loads.
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<Page<AuditLog>>(
        `/audit-logs?page=${page}&direction=desc&search=${encodeURIComponent(debounced)}`,
      ),
  });
  return (
    <>
      <PageHeading title={t('audit')} description={t('auditIntro')} />
      <section className="panel">
        <div className="toolbar">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
        </div>
        <QueryView query={query}>
          {(data) => (
            <>
              {data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('timestamp')}</th>
                        <th>{t('action')}</th>
                        <th>{t('entity')}</th>
                        <th>{t('changedFields')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((log) => (
                        <tr key={log.id}>
                          <td className="nowrap">
                            {new Intl.DateTimeFormat(i18n.language === 'it' ? 'it-IT' : 'de-IT', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                              timeZone: 'Europe/Rome',
                            }).format(new Date(log.timestamp))}
                          </td>
                          <td>{t(log.action)}</td>
                          <td>{t(log.entityType)}</td>
                          <td className="audit-fields">
                            {log.changeMetadata.fields
                              .map((field) => t(field, { defaultValue: field }))
                              .join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty />
              )}
              <Pagination
                page={page}
                pageSize={data.pageSize}
                total={data.total}
                onChange={setPage}
              />
            </>
          )}
        </QueryView>
      </section>
    </>
  );
}
