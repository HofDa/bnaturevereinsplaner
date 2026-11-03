import { z } from 'zod';

export const clubOverviewQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200),
});
const month = z.number().int().min(1).max(12);
export const clubOverviewSchema = z.object({
  year: z.number().int(),
  members: z.object({
    months: z.array(
      z.object({
        month,
        joined: z.number().int(),
        ended: z.number().int(),
        active: z.number().int(),
      }),
    ),
  }),
  /** Null when the account may not read events. */
  events: z
    .object({
      months: z.array(
        z.object({
          month,
          events: z.number().int(),
          registrations: z.number().int(),
          attended: z.number().int(),
        }),
      ),
    })
    .nullable(),
  /** Null when the account may not read volunteer data. Only confirmed hours count. */
  volunteers: z
    .object({
      months: z.array(z.object({ month, minutes: z.number().int() })),
      volunteers: z.number().int(),
      projects: z.array(z.object({ project: z.string(), minutes: z.number().int() })),
    })
    .nullable(),
});
export type ClubOverview = z.infer<typeof clubOverviewSchema>;
