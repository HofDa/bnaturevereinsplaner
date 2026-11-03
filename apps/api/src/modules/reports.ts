import { sql } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema as s } from '@bnature/db';
import { eq } from 'drizzle-orm';
import {
  can,
  clubOverviewQuerySchema,
  clubOverviewSchema,
  type ClubOverview,
} from '@bnature/contracts';
import type { ModuleContext } from './context';
import { readSnapshot } from './finance/operations';

const months = Array.from({ length: 12 }, (_, i) => i + 1);
const byMonth = <T extends { month: number }>(rows: T[], empty: Omit<T, 'month'>) =>
  months.map((month) => rows.find((r) => r.month === month) ?? ({ month, ...empty } as T));

/**
 * Annual overview per calendar month in club time: memberships (joined, ended, active at the
 * month's end), published or completed events with registrations and recorded presence, and
 * confirmed volunteer hours. Sections the account may not read are null.
 */
export function registerReportRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/api/v1/reports/annual-overview',
    {
      schema: {
        tags: ['Reports'],
        querystring: clubOverviewQuerySchema,
        response: { 200: clubOverviewSchema },
      },
    },
    async (req): Promise<ClubOverview> => {
      const a = await access(req, 'members:read');
      const year = req.query.year;
      const org = a.organizationId;
      return readSnapshot(db, async (tx) => {
        const [o] = await tx
          .select({ timezone: s.organizations.timezone })
          .from(s.organizations)
          .where(eq(s.organizations.id, org));
        const tz = o!.timezone;
        const members = await tx.execute<{
          month: number;
          joined: number;
          ended: number;
          active: number;
        }>(sql`
          with b as (
            select m as month, make_date(${year}::int, m, 1) as first,
                   (make_date(${year}::int, m, 1) + interval '1 month - 1 day')::date as last
            from generate_series(1, 12) m
          )
          select b.month::int,
            (select count(*) from memberships x where x.organization_id=${org} and x.joined_at between b.first and b.last)::int as joined,
            (select count(*) from memberships x where x.organization_id=${org} and x.ended_at between b.first and b.last)::int as ended,
            (select count(*) from memberships x where x.organization_id=${org} and x.status<>'pending'
               and x.joined_at<=b.last and (x.ended_at is null or x.ended_at>b.last))::int as active
          from b order by b.month`);
        let events: ClubOverview['events'] = null;
        if (can(a.role, 'events:read')) {
          const rows = await tx.execute<{
            month: number;
            events: number;
            registrations: number;
            attended: number;
          }>(sql`
            select extract(month from (o.start_at at time zone ${tz}))::int as month,
              count(distinct o.id)::int as events,
              count(r.id) filter (where r.status='registered')::int as registrations,
              count(at.id) filter (where at.status='present' and r.status='registered')::int as attended
            from event_occurrences o
            left join event_registrations r on r.organization_id=o.organization_id and r.event_occurrence_id=o.id
            left join event_attendances at on at.organization_id=r.organization_id and at.registration_id=r.id
            where o.organization_id=${org} and o.status in ('published','completed')
              and extract(year from (o.start_at at time zone ${tz}))=${year}
            group by 1`);
          events = { months: byMonth(rows.rows, { events: 0, registrations: 0, attended: 0 }) };
        }
        let volunteers: ClubOverview['volunteers'] = null;
        if (can(a.role, 'volunteers:read')) {
          const confirmed = sql`t.organization_id=${org} and t.status='confirmed'
            and extract(year from (t.actual_start at time zone ${tz}))=${year}`;
          const perMonth = await tx.execute<{ month: number; minutes: number }>(sql`
            select extract(month from (t.actual_start at time zone ${tz}))::int as month, sum(t.minutes)::int as minutes
            from volunteer_time_entries t where ${confirmed} group by 1`);
          const [people] = (
            await tx.execute<{ n: number }>(
              sql`select count(distinct t.engagement_id)::int as n from volunteer_time_entries t where ${confirmed}`,
            )
          ).rows;
          const projects = await tx.execute<{ project: string; minutes: number }>(sql`
            select t.project, sum(t.minutes)::int as minutes from volunteer_time_entries t
            where ${confirmed} group by t.project order by 2 desc, 1 limit 8`);
          volunteers = {
            months: byMonth(perMonth.rows, { minutes: 0 }),
            volunteers: people?.n ?? 0,
            projects: projects.rows,
          };
        }
        return { year, members: { months: members.rows }, events, volunteers };
      });
    },
  );
}
