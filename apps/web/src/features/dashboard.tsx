import { QueryView } from '../components/ui';
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
  Cake,
  Award,
  PartyPopper,
  CalendarDays,
  Wallet,
  Newspaper,
  Package,
  HandHeart,
  CreditCard,
} from 'lucide-react';
import {
  eventLocal,
  formatMoney,
  type Dashboard as DashboardData,
  type MemberDashboard,
  type Occasion,
} from '@bnature/contracts';
import { api } from '../lib/api';
import { useSession } from '../app/session';
import { Avatar, Badge, Empty, Notice, PageHeading, formatDate } from '../components/ui';

function MemberHome() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const language = i18n.language === 'it' ? 'it' : 'de';
  const query = useQuery({
    queryKey: ['member-dashboard', me.activeOrganizationId],
    queryFn: () => api<MemberDashboard>('/dashboard/member'),
  });

  return (
    <QueryView query={query}>
      {(data) => {
        const displayName = data.personName ?? me.user.name;
        const totalUnread =
          data.community.unreadNews + data.community.unreadPolls + data.community.unreadChat;
        const showEvents = me.permissions.includes('events:read');
        const showCommunity = me.permissions.includes('community:read');

        return (
          <div className="member-dashboard">
            <PageHeading
              title={t('memberDashboardWelcome', { name: displayName })}
              description={t('memberHomeIntro')}
              actions={
                <>
                  <Link className="button button-secondary" to="/profile">
                    <CreditCard size={16} />
                    {t('profile')}
                  </Link>
                  {showCommunity && (
                    <Link className="button button-primary" to="/community">
                      <Newspaper size={16} />
                      {t('commTitle')}
                    </Link>
                  )}
                </>
              }
            />

            {!data.linked && <Notice>{t('profileUnlinked')}</Notice>}

            <section className="panel member-home-banner">
              <div className="member-home-banner-main">
                <span className="member-home-emblem" aria-hidden="true">
                  <Sprout size={26} />
                </span>
                <div>
                  <small className="muted">{data.organization.name}</small>
                  <h2>
                    {data.membership
                      ? `${t('memberCardTitle')} · ${data.membership.membershipNumber}`
                      : displayName}
                  </h2>
                  {data.membership && (
                    <p className="muted">
                      {t(data.membership.membershipType)} · {t('memberSince')}{' '}
                      {formatDate(data.membership.joinedAt, language)}
                    </p>
                  )}
                </div>
              </div>
              {data.membership && <Badge status={data.membership.status} />}
            </section>

            <div className="member-summary-grid">
              {showCommunity && (
                <article className="panel member-summary-card">
                  <div className="member-summary-head">
                    <h2>{t('commTitle')}</h2>
                    <span className="quick-icon" aria-hidden="true">
                      <Newspaper size={17} />
                    </span>
                  </div>
                  <div className="member-summary-body">
                    {data.community.openUnansweredPolls > 0 ||
                    data.community.openUnansweredSchedules > 0 ||
                    totalUnread > 0 ? (
                      <ul className="member-summary-list">
                        {data.community.openUnansweredPolls > 0 && (
                          <li>
                            <Link to="/community?kind=poll">
                              {t('memberOpenPolls', {
                                count: data.community.openUnansweredPolls,
                              })}
                            </Link>
                          </li>
                        )}
                        {data.community.openUnansweredSchedules > 0 && (
                          <li>
                            <Link to="/community?kind=schedule">
                              {t('memberOpenSchedules', {
                                count: data.community.openUnansweredSchedules,
                              })}
                            </Link>
                          </li>
                        )}
                        {totalUnread > 0 && (
                          <li>
                            <Link to="/community">
                              {t('memberUnreadCommunity', { count: totalUnread })}
                            </Link>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="muted">{t('memberCommunityUpToDate')}</p>
                    )}
                  </div>
                  <Link className="text-link" to="/community">
                    {t('commTitle')}
                    <ArrowRight size={15} />
                  </Link>
                </article>
              )}

              {data.membership && (
                <article className="panel member-summary-card">
                  <div className="member-summary-head">
                    <h2>{t('memberFeesSummaryOpen')}</h2>
                    <span className="quick-icon" aria-hidden="true">
                      <Wallet size={17} />
                    </span>
                  </div>
                  <div className="member-summary-body">
                    {data.fees.openCount > 0 ? (
                      <>
                        <strong className="member-summary-metric">
                          {formatMoney(data.fees.openCents, i18n.language)}
                        </strong>
                        {data.fees.overdueCount > 0 && (
                          <p>
                            <span className="badge badge-resigned">
                              <span />
                              {t('memberFeesOverdueHint', { count: data.fees.overdueCount })}
                            </span>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="muted">{t('memberFeesUpToDate')}</p>
                    )}
                  </div>
                  <Link className="text-link" to="/profile">
                    {t('memberMyFeesTitle')}
                    <ArrowRight size={15} />
                  </Link>
                </article>
              )}

              <article className="panel member-summary-card">
                <div className="member-summary-head">
                  <h2>{t('memberMyGroups')}</h2>
                  <span className="quick-icon" aria-hidden="true">
                    <Layers size={17} />
                  </span>
                </div>
                <div className="member-summary-body">
                  {data.myGroupCount > 0 ? (
                    <strong className="member-summary-metric">{data.myGroupCount}</strong>
                  ) : (
                    <p className="muted">{t('memberGroupsNone')}</p>
                  )}
                </div>
                <Link className="text-link" to="/groups">
                  {t('groups')}
                  <ArrowRight size={15} />
                </Link>
              </article>

              {(data.activeLoanCount > 0 || data.nextAssignment) && (
                <article className="panel member-summary-card">
                  <div className="member-summary-head">
                    <h2>{data.nextAssignment ? t('memberNextShift') : t('memberLoansActive')}</h2>
                    <span className="quick-icon" aria-hidden="true">
                      {data.nextAssignment ? <HandHeart size={17} /> : <Package size={17} />}
                    </span>
                  </div>
                  <div className="member-summary-body">
                    {data.nextAssignment && (
                      <p>
                        <strong>
                          {data.nextAssignment.eventTitle
                            ? data.nextAssignment.eventTitle[language]
                            : data.nextAssignment.task}
                        </strong>
                        <small className="finance-cell-note">
                          {new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(data.nextAssignment.plannedStart))}
                        </small>
                      </p>
                    )}
                    {data.activeLoanCount > 0 && (
                      <p className="muted">
                        {t('memberLoansActive')}: {data.activeLoanCount}
                        {data.overdueLoanCount > 0 && (
                          <>
                            {' · '}
                            <span className="badge badge-resigned">
                              <span />
                              {t('memberLoansOverdue', { count: data.overdueLoanCount })}
                            </span>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <Link className="text-link" to="/profile">
                    {t('profile')}
                    <ArrowRight size={15} />
                  </Link>
                </article>
              )}
            </div>

            {showEvents && (
              <section className="panel member-events-panel">
                <div className="panel-header">
                  <div>
                    <h2>{t('memberUpcomingEvents')}</h2>
                    <p>{t('eventIntro')}</p>
                  </div>
                  <div className="heading-actions">
                    <Link className="button button-secondary" to="/events?view=mine">
                      {t('memberMyEvents')}
                    </Link>
                    <Link className="text-link" to="/events?view=list">
                      {t('memberAllEvents')}
                      <ArrowRight size={15} />
                    </Link>
                  </div>
                </div>
                {data.upcomingEvents.length ? (
                  <ul className="member-event-list">
                    {data.upcomingEvents.map((ev) => (
                      <li key={ev.id} className="member-event-row">
                        <div className="member-event-date">
                          <CalendarDays size={16} aria-hidden="true" />
                          <span>{eventLocal(ev.startAt, ev.timezone).replace('T', ' ')}</span>
                        </div>
                        <div className="member-event-info">
                          <Link className="member-event-title" to={`/events/${ev.id}`}>
                            {ev.titleI18n[language]}
                          </Link>
                          <p className="muted">
                            {ev.categoryNameI18n[language]}
                            {ev.location ? ` · ${ev.location}` : ''}
                          </p>
                        </div>
                        <div className="member-event-status">
                          {ev.myRegistrationStatus ? (
                            <span
                              className={`badge ${
                                ev.myRegistrationStatus === 'registered'
                                  ? 'badge-active'
                                  : 'badge-pending'
                              }`}
                            >
                              <span />
                              {t(`eventRegistration_${ev.myRegistrationStatus}`)}
                            </span>
                          ) : (
                            <Link className="button button-secondary" to={`/events/${ev.id}`}>
                              {t('details')}
                            </Link>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty description={t('memberNoUpcomingEvents')} />
                )}
              </section>
            )}
          </div>
        );
      }}
    </QueryView>
  );
}

export function Dashboard() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const allowed = me.permissions.includes('members:read');
  const query = useQuery({
    queryKey: ['dashboard', me.activeOrganizationId],
    queryFn: () => api<DashboardData>('/dashboard'),
    enabled: allowed,
  });
  if (!allowed) return <MemberHome />;
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
      {
        <QueryView query={query}>
          {(queryData) => (
            <>
              <section className="stats-grid" aria-label={t('overview')}>
                {[
                  {
                    title: 'activeMembers',
                    value: queryData.activeMembers,
                    hint: `${queryData.totalMembers} ${t('totalMembers').toLowerCase()}`,
                    icon: Users,
                  },
                  {
                    title: 'newMembers',
                    value: queryData.newMembers,
                    hint: t('thisMonth'),
                    icon: UserPlus,
                  },
                  {
                    title: 'activeGroups',
                    value: queryData.activeGroups,
                    hint: t('workingTogether'),
                    icon: Layers,
                  },
                  {
                    title: 'currentBoard',
                    value: queryData.board.length,
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
                  {queryData.recentMembers.length ? (
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
                          {queryData.recentMembers.map((member) => (
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
                    <strong>{queryData.totalMembers}</strong>
                    <span>{t('totalMembers')}</span>
                  </div>
                  <div className="stacked-bar" aria-hidden="true">
                    {Object.entries(queryData.statuses).map(([status, n]) => (
                      <span className={`segment-${status}`} key={status} style={{ flexGrow: n }} />
                    ))}
                  </div>
                  <div className="status-legend">
                    {Object.entries(queryData.statuses).map(([status, n]) => (
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
                  {queryData.board.length ? (
                    <div className="board-preview">
                      {queryData.board.slice(0, 4).map((person) => (
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
                <Occasions />
              </div>
            </>
          )}
        </QueryView>
      }
    </>
  );
}

function Occasions() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const query = useQuery({
    queryKey: ['dashboard', 'occasions', me.activeOrganizationId],
    queryFn: () => api<{ items: Occasion[] }>('/dashboard/occasions?days=30'),
  });
  const when = (item: Occasion) =>
    item.daysAway === 0
      ? t('occasionToday')
      : item.daysAway === 1
        ? t('occasionTomorrow')
        : t('occasionInDays', { count: item.daysAway });
  const draft = (item: Occasion) =>
    `/community?kind=chat&draft=${encodeURIComponent(
      t(item.kind === 'birthday' ? 'occasionDraftBirthday' : 'occasionDraftAnniversary', {
        name: item.firstName,
        years: item.years,
      }),
    )}`;
  return (
    <section className="panel occasions-panel">
      <header className="panel-header">
        <div>
          <h2>{t('occasionsTitle')}</h2>
          <p>{t('occasionsIntro')}</p>
        </div>
      </header>
      {
        <QueryView query={query}>
          {(queryData) =>
            !queryData.items.length ? (
              <Empty description={t('occasionsEmpty')} />
            ) : (
              <ul className="occasion-list">
                {queryData.items.map((item) => (
                  <li
                    key={`${item.personId}:${item.kind}`}
                    className={item.daysAway === 0 ? 'today' : ''}
                  >
                    <span className="occasion-icon" aria-hidden="true">
                      {item.kind === 'birthday' ? <Cake size={18} /> : <Award size={18} />}
                    </span>
                    <span className="occasion-text">
                      <Link to={`/members/${item.memberId}`}>
                        {item.firstName} {item.lastName}
                      </Link>
                      <small>
                        {t(item.kind === 'birthday' ? 'occasionBirthday' : 'occasionAnniversary', {
                          count: item.years,
                        })}{' '}
                        · {when(item)}, {formatDate(item.date, i18n.language)}
                      </small>
                    </span>
                    {me.permissions.includes('community:chat') && item.daysAway <= 1 && (
                      <Link
                        className="icon-button"
                        to={draft(item)}
                        aria-label={`${t('occasionCongratulate')}: ${item.firstName} ${item.lastName}`}
                        title={t('occasionCongratulate')}
                      >
                        <PartyPopper size={17} />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </QueryView>
      }
    </section>
  );
}
