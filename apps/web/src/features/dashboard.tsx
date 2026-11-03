import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Users,
  UserPlus,
  Layers,
  ShieldCheck,
  ArrowRight,
  Plus,
  ArrowUpRight,
  Sprout,
} from 'lucide-react';
import type { Dashboard as DashboardData } from '@bnature/contracts';
import { api } from '../lib/api';
import { useSession } from '../app/session';
import {
  Avatar,
  Badge,
  Empty,
  ErrorState,
  Loading,
  PageHeading,
  formatDate,
} from '../components/ui';
export function Dashboard() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const allowed = me.permissions.includes('members:read');
  const query = useQuery({
    queryKey: ['dashboard', me.activeOrganizationId],
    queryFn: () => api<DashboardData>('/dashboard'),
    enabled: allowed,
  });
  if (!allowed)
    return (
      <>
        <PageHeading title={t('welcomeMember')} description={t('memberHomeIntro')} />
        <div className="member-home">
          <Sprout size={40} />
          <h2>b*nature</h2>
          <p>{t('welcome')}</p>
          <div className="heading-actions">
            <Link className="button button-primary" to="/community">
              {t('commTitle')}
              <ArrowRight size={16} />
            </Link>
            <Link className="button button-primary" to="/profile">
              {t('profile')}
              <ArrowRight size={16} />
            </Link>
            <Link className="button button-secondary" to="/groups">
              {t('groups')}
            </Link>
          </div>
        </div>
      </>
    );
  return (
    <>
      <div className="date-line">
        <span className="eyebrow">B*NATURE · {t('overview').toUpperCase()}</span>
        <span>
          {new Intl.DateTimeFormat(i18n.language === 'it' ? 'it-IT' : 'de-IT', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Europe/Rome',
          }).format(new Date())}
        </span>
      </div>
      <PageHeading
        title={t('welcome')}
        description={t('dashboardIntro')}
        actions={
          me.permissions.includes('members:write') && (
            <Link to="/members?new=1" className="button button-primary">
              <Plus size={17} />
              {t('addMember')}
            </Link>
          )
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <section className="stats-grid" aria-label={t('overview')}>
            {[
              {
                title: 'activeMembers',
                value: query.data.activeMembers,
                hint: `${query.data.totalMembers} ${t('totalMembers').toLowerCase()}`,
                icon: Users,
              },
              {
                title: 'newMembers',
                value: query.data.newMembers,
                hint: t('thisMonth'),
                icon: UserPlus,
              },
              {
                title: 'activeGroups',
                value: query.data.activeGroups,
                hint: t('workingTogether'),
                icon: Layers,
              },
              {
                title: 'currentBoard',
                value: query.data.board.length,
                hint: t('currentMandates'),
                icon: ShieldCheck,
              },
            ].map((stat, i) => (
              <article className={`stat-card stat-${i}`} key={stat.title}>
                <div>
                  <span>{t(stat.title)}</span>
                  <stat.icon size={19} />
                </div>
                <strong>{stat.value.toLocaleString(i18n.language)}</strong>
                <small>
                  {i === 1 && <span className="mini-dot" />}
                  {stat.hint}
                </small>
              </article>
            ))}
          </section>
          <div className="dashboard-grid">
            <section className="panel recent-panel">
              <header className="panel-header">
                <div>
                  <h2>{t('recentMembers')}</h2>
                  <p>{t('recentIntro')}</p>
                </div>
                <Link className="text-link" to="/members">
                  {t('allMembers')}
                  <ArrowUpRight size={15} />
                </Link>
              </header>
              {query.data.recentMembers.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('name')}</th>
                        <th>{t('memberNumber')}</th>
                        <th>{t('status')}</th>
                        <th className="align-right">{t('joined')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.recentMembers.map((member) => (
                        <tr key={member.id}>
                          <td>
                            <Link to={`/members/${member.id}`} className="person-cell">
                              <Avatar firstName={member.firstName} lastName={member.lastName} />
                              <span>
                                <strong>
                                  {member.firstName} {member.lastName}
                                </strong>
                                <small>{member.email || t('noContact')}</small>
                              </span>
                            </Link>
                          </td>
                          <td className="mono">{member.membershipNumber}</td>
                          <td>
                            <Badge status={member.status} />
                          </td>
                          <td className="align-right muted">
                            {formatDate(member.joinedAt, i18n.language)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty description={t('emptyMembers')} />
              )}
            </section>
            <section className="panel status-panel">
              <header className="panel-header">
                <div>
                  <h2>{t('statusOverview')}</h2>
                  <p>{t('statusIntro')}</p>
                </div>
              </header>
              <div className="status-total">
                <strong>{query.data.totalMembers}</strong>
                <span>{t('totalMembers')}</span>
              </div>
              <div className="stacked-bar" aria-hidden="true">
                {Object.entries(query.data.statuses).map(([status, n]) => (
                  <span className={`segment-${status}`} key={status} style={{ flexGrow: n }} />
                ))}
              </div>
              <div className="status-legend">
                {Object.entries(query.data.statuses).map(([status, n]) => (
                  <div key={status}>
                    <span>
                      <i className={`dot-${status}`} />
                      {t(status)}
                    </span>
                    <strong>{n}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel quick-panel">
              <header className="panel-header">
                <div>
                  <h2>{t('quickActions')}</h2>
                  <p>{t('quickIntro')}</p>
                </div>
              </header>
              <div className="quick-links">
                {[
                  {
                    to: '/members?new=1',
                    label: 'addMember',
                    icon: UserPlus,
                    permission: 'members:write',
                  },
                  {
                    to: '/groups?new=1',
                    label: 'createGroup',
                    icon: Layers,
                    permission: 'groups:write',
                  },
                  {
                    to: '/board',
                    label: 'manageBoard',
                    icon: ShieldCheck,
                    permission: 'board:write',
                  },
                ]
                  .filter((item) => me.permissions.some((p) => p === item.permission))
                  .map((item) => (
                    <Link to={item.to} key={item.to}>
                      <span className="quick-icon">
                        <item.icon size={20} />
                      </span>
                      <strong>{t(item.label)}</strong>
                      <ArrowUpRight size={17} />
                    </Link>
                  ))}
              </div>
            </section>
            <section className="panel board-panel">
              <header className="panel-header">
                <div>
                  <h2>{t('currentBoard')}</h2>
                  <p>{t('currentMandates')}</p>
                </div>
                <Link to="/board" className="icon-button" aria-label={t('board')}>
                  <ArrowUpRight size={18} />
                </Link>
              </header>
              {query.data.board.length ? (
                <div className="board-preview">
                  {query.data.board.slice(0, 4).map((person) => (
                    <div key={person.id}>
                      <Avatar firstName={person.firstName} lastName={person.lastName} />
                      <span>
                        <strong>
                          {person.firstName} {person.lastName}
                        </strong>
                        <small>{person.position}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description={t('noBoard')} />
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
