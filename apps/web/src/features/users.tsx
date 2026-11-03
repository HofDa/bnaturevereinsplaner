import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil } from 'lucide-react';
import { z } from 'zod';
import {
  roles,
  roleSchema,
  userProvisionSchema,
  type Role,
  type Page,
  type Member,
} from '@bnature/contracts';
import { api, allPages, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import { useDebounced } from '../hooks/use-debounced';
import {
  Avatar,
  Button,
  Empty,
  Modal,
  PageHeading,
  Pagination,
  SearchInput,
  QueryView,
} from '../components/ui';
import { DataForm } from '../components/data-form';
type UserRow = { id: string; name: string; email: string; role: Role };
export function UsersPage() {
  const { t } = useTranslation(),
    { me } = useSession();
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ['users', me.activeOrganizationId, page, debounced],
    queryFn: () =>
      api<Page<UserRow>>(`/users?page=${page}&search=${encodeURIComponent(debounced)}`),
  });
  const members = useQuery({
    queryKey: ['member-options', me.activeOrganizationId],
    queryFn: () => allPages<Member>('/members'),
    enabled: editing === 'new',
  });
  const roleOptions = roles.map((value) => ({ value, label: t(value) }));
  return (
    <>
      <PageHeading
        title={t('users')}
        description={t('usersIntro')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={17} />
            {t('addUser')}
          </Button>
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
        <QueryView query={query}>
          {(data) => (
            <>
              {data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('name')}</th>
                        <th>{t('email')}</th>
                        <th>{t('role')}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <div className="person-cell">
                              <Avatar firstName={user.name} lastName="" />
                              <strong>{user.name}</strong>
                            </div>
                          </td>
                          <td>{user.email}</td>
                          <td>
                            <span className="subtle-tag">{t(user.role)}</span>
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              aria-label={`${t('edit')}: ${user.name}`}
                              onClick={() => setEditing(user)}
                            >
                              <Pencil size={16} />
                            </Button>
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
      {editing && (
        <Modal title={t(editing === 'new' ? 'addUser' : 'role')} onClose={() => setEditing(null)}>
          {editing === 'new' ? (
            <QueryView query={members}>
              {(membersData) => (
                <DataForm
                  schema={userProvisionSchema.extend({
                    personId: z.union([z.uuid(), z.literal('')]).transform((v) => v || undefined),
                  })}
                  fields={[
                    { name: 'name', required: true },
                    { name: 'email', type: 'email', required: true },
                    {
                      name: 'password',
                      label: 'temporaryPassword',
                      type: 'password',
                      required: true,
                      minLength: 12,
                    },
                    { name: 'role', type: 'select', options: roleOptions },
                    {
                      name: 'personId',
                      label: 'linkedPerson',
                      type: 'select',
                      options: [
                        { value: '', label: t('noLink') },
                        ...membersData.map((member) => ({
                          value: member.personId,
                          label: `${member.firstName} ${member.lastName}`,
                        })),
                      ],
                    },
                  ]}
                  defaults={{ role: 'member' }}
                  create
                  onCancel={() => setEditing(null)}
                  onSubmit={async (data) => {
                    await api('/users', { method: 'POST', body: JSON.stringify(data) });
                    void queryClient.invalidateQueries();
                    setEditing(null);
                  }}
                />
              )}
            </QueryView>
          ) : (
            <DataForm
              schema={z.object({ role: roleSchema })}
              fields={[{ name: 'role', type: 'select', options: roleOptions }]}
              defaults={editing}
              onCancel={() => setEditing(null)}
              onSubmit={async (data) => {
                await api(`/users/${editing.id}/role`, {
                  method: 'PATCH',
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
