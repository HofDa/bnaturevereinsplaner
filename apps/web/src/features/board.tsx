import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil } from 'lucide-react';
import { boardSchema, type BoardMandate, type Member, type Page } from '@bnature/contracts';
import { api, allPages, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import {
  Avatar,
  Button,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageHeading,
  Pagination,
  SearchInput,
  formatDate,
} from '../components/ui';
import { DataForm } from '../components/data-form';
import { useDebounced } from '../hooks/use-debounced';
export function Board() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const [editing, setEditing] = useState<BoardMandate | 'new' | null>(null),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const debounced = useDebounced(search),
    write = me.permissions.includes('board:write');
  const query = useQuery({
    queryKey: ['board', me.activeOrganizationId, page, debounced],
    queryFn: () =>
      api<Page<BoardMandate>>(
        `/board-mandates?direction=desc&page=${page}&search=${encodeURIComponent(debounced)}`,
      ),
  });
  const members = useQuery({
    queryKey: ['member-options', me.activeOrganizationId],
    queryFn: () => allPages<Member>('/members'),
    enabled: !!editing && write,
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeading
        title={t('board')}
        description={t('boardIntro')}
        actions={
          write && (
            <Button onClick={() => setEditing('new')}>
              <Plus size={17} />
              {t('addMandate')}
            </Button>
          )
        }
      />
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
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} />
        ) : (
          <>
            {query.data.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('name')}</th>
                      <th>{t('position')}</th>
                      <th>{t('startDate')}</th>
                      <th>{t('endDate')}</th>
                      <th>{t('status')}</th>
                      {write && <th>{t('actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((mandate) => (
                      <tr key={mandate.id}>
                        <td>
                          <div className="person-cell">
                            <Avatar firstName={mandate.firstName} lastName={mandate.lastName} />
                            <strong>
                              {mandate.firstName} {mandate.lastName}
                            </strong>
                          </div>
                        </td>
                        <td>{mandate.position}</td>
                        <td>{formatDate(mandate.startDate, i18n.language)}</td>
                        <td>
                          {mandate.endDate
                            ? formatDate(mandate.endDate, i18n.language)
                            : t('ongoing')}
                        </td>
                        <td>
                          <span className="subtle-tag">
                            {t(
                              mandate.startDate > today
                                ? 'future'
                                : mandate.endDate && mandate.endDate < today
                                  ? 'past'
                                  : 'current',
                            )}
                          </span>
                        </td>
                        {write && (
                          <td>
                            <Button
                              variant="ghost"
                              aria-label={`${t('edit')}: ${mandate.position}`}
                              onClick={() => setEditing(mandate)}
                            >
                              <Pencil size={16} />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty description={t('boardEmpty')} />
            )}
            <Pagination
              page={page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onChange={setPage}
            />
          </>
        )}
      </section>
      {editing && (
        <Modal
          title={t(editing === 'new' ? 'addMandate' : 'edit')}
          onClose={() => setEditing(null)}
        >
          {members.isPending ? (
            <Loading />
          ) : members.isError ? (
            <ErrorState error={members.error} />
          ) : (
            <DataForm
              schema={boardSchema}
              fields={[
                {
                  name: 'personId',
                  label: 'choosePerson',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '', label: t('choosePerson') },
                    ...members.data.map((member) => ({
                      value: member.personId,
                      label: `${member.firstName} ${member.lastName} · ${member.membershipNumber}`,
                    })),
                  ],
                },
                { name: 'position', required: true },
                { name: 'startDate', type: 'date', required: true },
                { name: 'endDate', type: 'date', nullable: true },
              ]}
              defaults={editing === 'new' ? { startDate: today } : editing}
              create={editing === 'new'}
              onCancel={() => setEditing(null)}
              onSubmit={async (data) => {
                await api(editing === 'new' ? '/board-mandates' : `/board-mandates/${editing.id}`, {
                  method: editing === 'new' ? 'POST' : 'PATCH',
                  body: JSON.stringify(data),
                });
                void queryClient.invalidateQueries();
                setEditing(null);
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
