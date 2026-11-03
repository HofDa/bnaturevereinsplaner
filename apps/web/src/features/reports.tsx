import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClubOverview } from '@bnature/contracts';
import { api } from '../lib/api';
import { useSession } from '../app/session';
import { ErrorState, Field, Loading, PageHeading } from '../components/ui';

type Series = { key: string; label: string; values: number[]; slot: 1 | 2 };

const monthNames = (language: string) =>
  Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, i, 15)),
    ),
  );

/**
 * Monthly bars in inline SVG: one or two series (grouped), thin rounded bars on a recessive
 * grid, a per-month hover tooltip, a legend for two series and a table view for every chart.
 */
function MonthlyBars({
  title,
  description,
  series,
  format = (n: number) => n.toLocaleString(),
  lastMonth = 11,
}: {
  title: string;
  description?: string;
  series: Series[];
  format?: (n: number) => string;
  /** Index of the last month that has happened; later months stay empty. */
  lastMonth?: number;
}) {
  const { t, i18n } = useTranslation();
  const names = monthNames(i18n.language);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const width = 520,
    height = 230,
    left = 40,
    bottom = 28,
    top = 10;
  const plotW = width - left - 8,
    plotH = height - top - bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values.slice(0, lastMonth + 1)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = Math.max(1, Math.ceil(max / step) * step);
  // Counts get whole-number ticks only.
  const ticks = Number.isInteger(nice / 2) || nice < 1 ? [0, nice / 2, nice] : [0, nice];
  const column = plotW / 12;
  const barW = Math.min(18, (column - 10) / series.length);
  const y = (v: number) => top + plotH - (v / nice) * plotH;
  return (
    <section className="panel report-chart" aria-labelledby={`${id}-title`}>
      <header className="report-chart-header">
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p>{description}</p>}
        {series.length > 1 && (
          <ul className="report-legend">
            {series.map((s) => (
              <li key={s.key}>
                <span className={`report-swatch viz-${s.slot}`} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </header>
      <div className="report-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="report-gridline"
                x1={left}
                x2={width - 8}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="report-axis" x={left - 6} y={y(tick) + 4} textAnchor="end">
                {format(tick)}
              </text>
            </g>
          ))}
          {names.map((name, m) => {
            const x0 = left + m * column;
            const groupW = barW * series.length + 2 * (series.length - 1);
            return (
              <g key={name} className={hover === m ? 'report-col active' : 'report-col'}>
                {series.map((s, i) => {
                  if (m > lastMonth) return null;
                  const v = s.values[m] ?? 0;
                  const h = Math.max(0, (v / nice) * plotH);
                  const x = x0 + (column - groupW) / 2 + i * (barW + 2);
                  const r = Math.min(4, barW / 2, h);
                  // Rounded data end, square at the baseline.
                  const path = h
                    ? `M${x},${top + plotH} V${top + plotH - h + r} Q${x},${top + plotH - h} ${x + r},${top + plotH - h} H${x + barW - r} Q${x + barW},${top + plotH - h} ${x + barW},${top + plotH - h + r} V${top + plotH} Z`
                    : '';
                  return path ? <path key={s.key} className={`viz-${s.slot}`} d={path} /> : null;
                })}
                <text
                  className="report-axis"
                  x={x0 + column / 2}
                  y={height - 6}
                  textAnchor="middle"
                >
                  {name}
                </text>
                {m <= lastMonth && (
                  <rect
                    className="report-hit"
                    x={x0}
                    y={top}
                    width={column}
                    height={plotH}
                    onMouseEnter={() => setHover(m)}
                    onTouchStart={() => setHover(m)}
                  />
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div
            className="report-tooltip"
            style={{ left: `${((left + (hover + 0.5) * column) / width) * 100}%` }}
            role="status"
          >
            <strong>{names[hover]}</strong>
            {series.map((s) => (
              <span key={s.key}>
                {series.length > 1 && (
                  <i className={`report-swatch viz-${s.slot}`} aria-hidden="true" />
                )}
                {s.label}: <b>{format(s.values[hover] ?? 0)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <details className="report-table">
        <summary>{t('reportShowTable')}</summary>
        <div className="table-scroll" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>{t('reportMonth')}</th>
                {series.map((s) => (
                  <th key={s.key} className="align-right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((name, m) => (
                <tr key={name}>
                  <td>{name}</td>
                  {series.map((s) => (
                    <td key={s.key} className="align-right">
                      {m > lastMonth ? '—' : format(s.values[m] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function Reports() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const current = new Date().getFullYear();
  const [year, setYear] = useState(current);
  const query = useQuery({
    queryKey: ['reports', me.activeOrganizationId, year],
    queryFn: () => api<ClubOverview>(`/reports/annual-overview?year=${year}`),
  });
  const num = (n: number) => n.toLocaleString(i18n.language);
  const hours = (minutes: number) =>
    (minutes / 60).toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const data = query.data;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const lastMonth = year === current ? new Date().getMonth() : 11;
  const kpis = data
    ? [
        {
          label: 'reportActive',
          value: num(data.members.months[lastMonth]?.active ?? 0),
          hint: t(year === current ? 'reportActiveNow' : 'reportActiveYearEnd'),
        },
        { label: 'reportJoined', value: num(sum(data.members.months.map((m) => m.joined))) },
        { label: 'reportEnded', value: num(sum(data.members.months.map((m) => m.ended))) },
        ...(data.events
          ? [
              { label: 'reportEvents', value: num(sum(data.events.months.map((m) => m.events))) },
              {
                label: 'reportAttendanceRate',
                value: (() => {
                  const reg = sum(data.events.months.map((m) => m.registrations));
                  return reg
                    ? `${Math.round((sum(data.events.months.map((m) => m.attended)) / reg) * 100)} %`
                    : '—';
                })(),
                hint: t('reportAttendanceHint'),
              },
            ]
          : []),
        ...(data.volunteers
          ? [
              {
                label: 'reportHours',
                value: hours(sum(data.volunteers.months.map((m) => m.minutes))),
                hint: t('reportVolunteers', { count: data.volunteers.volunteers }),
              },
            ]
          : []),
      ]
    : [];
  return (
    <>
      <PageHeading title={t('reportsTitle')} description={t('reportsIntro')} />
      <div className="report-filters">
        <Field label={t('reportYear')}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => current - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        data && (
          <>
            <section className="report-kpis" aria-label={t('reportsSummary')}>
              {kpis.map((k) => (
                <article key={k.label} className="stat-card">
                  <span>{t(k.label)}</span>
                  <strong>{k.value}</strong>
                  {k.hint && <small>{k.hint}</small>}
                </article>
              ))}
            </section>
            <div className="report-grid">
              <MonthlyBars
                title={t('reportMembersTitle')}
                description={t('reportMembersHint')}
                series={[
                  {
                    key: 'active',
                    label: t('reportActive'),
                    values: data.members.months.map((m) => m.active),
                    slot: 1,
                  },
                ]}
                format={num}
                lastMonth={lastMonth}
              />
              <MonthlyBars
                title={t('reportFlowTitle')}
                series={[
                  {
                    key: 'joined',
                    label: t('reportJoined'),
                    values: data.members.months.map((m) => m.joined),
                    slot: 1,
                  },
                  {
                    key: 'ended',
                    label: t('reportEnded'),
                    values: data.members.months.map((m) => m.ended),
                    slot: 2,
                  },
                ]}
                format={num}
                lastMonth={lastMonth}
              />
              {data.events && (
                <MonthlyBars
                  title={t('reportEventsTitle')}
                  description={t('reportEventsHint')}
                  series={[
                    {
                      key: 'registrations',
                      label: t('reportRegistrations'),
                      values: data.events.months.map((m) => m.registrations),
                      slot: 1,
                    },
                    {
                      key: 'attended',
                      label: t('reportAttended'),
                      values: data.events.months.map((m) => m.attended),
                      slot: 2,
                    },
                  ]}
                  format={num}
                  lastMonth={lastMonth}
                />
              )}
              {data.volunteers && (
                <MonthlyBars
                  title={t('reportHoursTitle')}
                  description={t('reportHoursHint')}
                  series={[
                    {
                      key: 'hours',
                      label: t('reportHours'),
                      values: data.volunteers.months.map((m) => m.minutes / 60),
                      slot: 1,
                    },
                  ]}
                  format={(n) => n.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}
                  lastMonth={lastMonth}
                />
              )}
            </div>
            {data.volunteers && data.volunteers.projects.length > 0 && (
              <section className="panel report-projects">
                <h2>{t('reportProjectsTitle')}</h2>
                <ul>
                  {data.volunteers.projects.map((p) => {
                    const top = data.volunteers!.projects[0]!.minutes || 1;
                    return (
                      <li key={p.project}>
                        <span>{p.project || t('reportNoProject')}</span>
                        <span className="report-project-bar" aria-hidden="true">
                          <i className="viz-1" style={{ width: `${(p.minutes / top) * 100}%` }} />
                        </span>
                        <b>{hours(p.minutes)} h</b>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )
      )}
    </>
  );
}
