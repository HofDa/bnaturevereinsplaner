import { z } from 'zod';

export const occasionSchema = z.object({
  memberId: z.uuid(),
  personId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  kind: z.enum(['birthday', 'anniversary']),
  /** Next occurrence as a club-local calendar date (YYYY-MM-DD). */
  date: z.string(),
  /** Age reached (birthday) or completed membership years (anniversary). */
  years: z.number().int(),
  daysAway: z.number().int(),
});
export type Occasion = z.infer<typeof occasionSchema>;
export const occasionsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export const occasionsSchema = z.object({ items: z.array(occasionSchema) });

/** Membership anniversaries worth mentioning: the first year, then every five years. */
export const isMilestone = (years: number) => years === 1 || (years > 0 && years % 5 === 0);

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
function onYear(source: string, year: number) {
  const [, month, dayOfMonth] = source.split('-');
  // 29 February is celebrated on 28 February in non-leap years.
  const d = month === '02' && dayOfMonth === '29' && !isLeap(year) ? '28' : dayOfMonth;
  return `${year}-${month}-${d}`;
}

/**
 * Birthdays and membership milestones within `days` days from `today` (inclusive), sorted by
 * date and name. Dates are plain calendar dates; `today` must already be club-local.
 */
export function upcomingOccasions(
  people: {
    memberId: string;
    personId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    joinedAt: string | null;
  }[],
  today: string,
  days: number,
): Occasion[] {
  const start = day(today);
  const year = Number(today.slice(0, 4));
  const result: Occasion[] = [];
  for (const person of people) {
    const sources = [
      ['birthday', person.dateOfBirth],
      ['anniversary', person.joinedAt],
    ] as const;
    for (const [kind, source] of sources) {
      if (!source) continue;
      for (const candidateYear of [year, year + 1]) {
        const date = onYear(source, candidateYear);
        const daysAway = Math.round((day(date) - start) / 86_400_000);
        if (daysAway < 0 || daysAway > days) continue;
        const years = candidateYear - Number(source.slice(0, 4));
        if (years < 1 || (kind === 'anniversary' && !isMilestone(years))) break;
        result.push({
          memberId: person.memberId,
          personId: person.personId,
          firstName: person.firstName,
          lastName: person.lastName,
          kind,
          date,
          years,
          daysAway,
        });
        break;
      }
    }
  }
  return result.sort(
    (a, b) =>
      a.daysAway - b.daysAway ||
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) ||
      a.kind.localeCompare(b.kind),
  );
}
