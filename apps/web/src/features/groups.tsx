import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Layers,
  Plus,
  Users,
  ArrowUpRight,
  Newspaper,
  ChartColumn,
  MessagesSquare,
} from 'lucide-react';
import { groupSchema, type Group, type Member, type Page } from '@bnature/contracts';
import { api, allPages, queryClient, errorMessage } from '../lib/api';
import { useSession } from '../app/session';
import { useDebounced } from '../hooks/use-debounced';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  SearchInput,
  FormActions,
  QueryView,
} from '../components/ui';
import { DataForm } from '../components/data-form';
type GroupDetail = Group & { members: { personId: string; firstName: string; lastName: string }[] };
export function Groups() {
  const { t } = useTranslation(),
    { me } = useSession();
  const [params, setParams] = useSearchParams(),
    [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(''),
    [active, setActive] = useState(''),
    [page, setPage] = useState(1);
  const debounced = useDebounced(search),
    write = me.permissions.includes('groups:write');
  const query = useQuery({
    queryKey: ['groups', me.activeOrganizationId, debounced, active, page],
    queryFn: () =>
      api<Page<Group>>(
        `/groups?${new URLSearchParams({ search: debounced, page: String(page), ...(active ? { active } : {}) })}`,
      ),
  });
  const fields = [
    { name: 'name', label: 'groupName', required: true },
    { name: 'description', type: 'textarea' as const },
    { name: 'active', type: 'checkbox' as const },
  ];
  return (
    <>
      <PageHeading
        title={t('groups')}
        description={t('groupsIntro')}
        actions={
          write && (
            <Button onClick={() => setParams({ new: '1' })}>
              <Plus size={17} />
              {t('createGroup')}
            </Button>
          )
        }
      />
      <div className="toolbar standalone-toolbar">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <label>
          <span className="sr-only">{t('status')}</span>
          <select
            value={active}
            onChange={(event) => {
              setActive(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('allGroups')}</option>
            <option value="true">{t('activeOnly')}</option>
            <option value="false">{t('inactive')}</option>
          </select>
        </label>
      </div>
      <QueryView query={query}>
        {(data) =>
          data.items.length ? (
            <>
              <div className="groups-grid">
                {data.items.map((group) => (
                  <article className="panel group-card" key={group.id}>
                    <div className="group-card-top">
                      <span className="group-symbol">
                        <Layers size={24} />
                      </span>
                      <div className="group-card-badges">
                        {group.isMember && (
                          <span className="badge badge-active">
                            <span />
                            {t('groupMineBadge')}
                          </span>
                        )}
                        <Badge status={group.active ? 'active' : 'inactive'} />
                      </div>
                    </div>
                    <h2>{group.name}</h2>
                    <p>{group.description || '—'}</p>
                    <footer>
                      <span>
                        <Users size={16} />
                        {group.memberCount} {t('members')}
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() => setSelected(group.id)}
                        aria-label={`${t('details')}: ${group.name}`}
                      >
                        <ArrowUpRight size={19} />
                      </Button>
                    </footer>
                  </article>
                ))}
              </div>
              <Pagination
                page={page}
                pageSize={data.pageSize}
                total={data.total}
                onChange={setPage}
              />
            </>
          ) : (
            <section className="panel">
              <Empty description={t('groupEmpty')} />
            </section>
          )
        }
      </QueryView>
      {params.get('new') && write && (
        <Modal title={t('createGroup')} onClose={() => setParams({})}>
          <DataForm
            schema={groupSchema}
            fields={fields}
            defaults={{ active: true }}
            create
            onCancel={() => setParams({})}
            onSubmit={async (data) => {
              await api('/groups', { method: 'POST', body: JSON.stringify(data) });
              void queryClient.invalidateQueries();
              setParams({});
            }}
          />
        </Modal>
      )}
      {selected && (
        <Modal wide title={t('groups')} onClose={() => setSelected(null)}>
          <GroupEditor id={selected} onDone={() => setSelected(null)} />
        </Modal>
      )}
    </>
  );
}
function GroupEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useTranslation(),
    { me } = useSession();
  const canMembers = me.permissions.includes('members:read'),
    canCommunity = me.permissions.includes('community:read'),
    write = me.permissions.includes('groups:write');
  const query = useQuery({
    queryKey: ['group', me.activeOrganizationId, id],
    queryFn: () => api<GroupDetail>(`/groups/${id}`),
  });
  const audiences = useQuery({
    queryKey: ['community', 'audiences', me.activeOrganizationId],
    queryFn: () => api<{ groups: { id: string; name: string }[] }>('/community/audiences'),
    enabled: canCommunity,
  });
  const members = useQuery({
    queryKey: ['member-options', me.activeOrganizationId],
    queryFn: () => allPages<Member>('/members'),
    enabled: canMembers,
  });
  const mutation = useMutation({
    mutationFn: (personIds: string[]) =>
      api(`/groups/${id}/members`, { method: 'PUT', body: JSON.stringify({ personIds }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onDone();
    },
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  return (
    <>
      <h3>{query.data.name}</h3>
      {write ? (
        <DataForm
          schema={groupSchema}
          fields={[
            { name: 'name', label: 'groupName', required: true },
            { name: 'description', type: 'textarea' },
            { name: 'active', type: 'checkbox' },
          ]}
          defaults={query.data}
          onSubmit={async (data) => {
            await api(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
            void queryClient.invalidateQueries();
            onDone();
          }}
        />
      ) : (
        <p>{query.data.description}</p>
      )}
      <hr />
      <h3>{t('groupMembers')}</h3>
      {canMembers ? (
        <QueryView query={members}>
          {(membersData) => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                mutation.mutate(new FormData(event.currentTarget).getAll('personIds').map(String));
              }}
            >
              <div className="assignment-list">
                {membersData.map((member) => (
                  <label key={member.personId}>
                    <input
                      type="checkbox"
                      name="personIds"
                      value={member.personId}
                      disabled={!write}
                      defaultChecked={query.data.members.some(
                        (m) => m.personId === member.personId,
                      )}
                    />
                    <span>
                      {member.firstName} {member.lastName}
                      <small>{member.membershipNumber}</small>
                    </span>
                  </label>
                ))}
              </div>
              {mutation.isError && <Notice error>{errorMessage(mutation.error)}</Notice>}
              {write && <FormActions pending={mutation.isPending} />}
            </form>
          )}
        </QueryView>
      ) : (
        <div className="group-member-access">
          {canCommunity &&
            (query.data.isMember || audiences.data?.groups.some((g) => g.id === query.data.id)) && (
              <div className="heading-actions">
                <Link
                  className="button button-primary"
                  to={`/community?kind=chat&groupId=${query.data.id}`}
                  onClick={onDone}
                >
                  <MessagesSquare size={15} />
                  {t('groupOpenChat')}
                </Link>
                <Link
                  className="button button-secondary"
                  to={`/community?kind=news&groupId=${query.data.id}`}
                  onClick={onDone}
                >
                  <Newspaper size={15} />
                  {t('groupOpenNews')}
                </Link>
                <Link
                  className="button button-secondary"
                  to={`/community?kind=poll&groupId=${query.data.id}`}
                  onClick={onDone}
                >
                  <ChartColumn size={15} />
                  {t('groupOpenPolls')}
                </Link>
              </div>
            )}
          <p className="muted">{t('groupMemberAccessNote')}</p>
        </div>
      )}
    </>
  );
}
