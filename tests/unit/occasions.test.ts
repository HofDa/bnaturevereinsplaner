import { describe, it, expect } from 'vitest';
import { upcomingOccasions, isMilestone } from '../../packages/contracts/src';
const person = (patch: {
  dateOfBirth?: string | null;
  joinedAt?: string | null;
  lastName?: string;
}) => ({
  memberId: crypto.randomUUID(),
  personId: crypto.randomUUID(),
  firstName: 'Lena',
  lastName: patch.lastName ?? 'Muster',
  dateOfBirth: patch.dateOfBirth ?? null,
  joinedAt: patch.joinedAt ?? null,
});
describe('upcoming birthdays and anniversaries', () => {
  it('lists birthdays within the window, including today, with the age reached', () => {
    const items = upcomingOccasions(
      [
        person({ dateOfBirth: '1996-11-03' }),
        person({ dateOfBirth: '1990-12-03', lastName: 'Später' }),
        person({ dateOfBirth: '1990-12-04', lastName: 'Zu spät' }),
        person({ dateOfBirth: '1990-11-02', lastName: 'Gestern' }),
      ],
      '2026-11-03',
      30,
    );
    expect(items.map((i) => [i.lastName, i.date, i.years, i.daysAway])).toEqual([
      ['Muster', '2026-11-03', 30, 0],
      ['Später', '2026-12-03', 36, 30],
    ]);
  });
  it('wraps into the next year', () => {
    const [item] = upcomingOccasions([person({ dateOfBirth: '2000-01-05' })], '2026-12-20', 30);
    expect(item).toMatchObject({ date: '2027-01-05', years: 27, daysAway: 16 });
  });
  it('celebrates 29 February on 28 February in non-leap years', () => {
    const [item] = upcomingOccasions([person({ dateOfBirth: '2004-02-29' })], '2027-02-20', 30);
    expect(item).toMatchObject({ date: '2027-02-28', years: 23 });
    const [leap] = upcomingOccasions([person({ dateOfBirth: '2004-02-29' })], '2028-02-20', 30);
    expect(leap).toMatchObject({ date: '2028-02-29', years: 24 });
  });
  it('only reports membership milestones and skips the joining day itself', () => {
    expect([1, 5, 10, 25].every(isMilestone)).toBe(true);
    expect([0, 2, 3, 7, 11].some(isMilestone)).toBe(false);
    const items = upcomingOccasions(
      [
        person({ joinedAt: '2016-11-10' }),
        person({ joinedAt: '2023-11-10', lastName: 'Drei' }),
        person({ joinedAt: '2025-11-10', lastName: 'Eins' }),
        person({ joinedAt: '2026-11-10', lastName: 'Neu' }),
      ],
      '2026-11-03',
      30,
    );
    expect(items.map((i) => [i.lastName, i.kind, i.years])).toEqual([
      ['Eins', 'anniversary', 1],
      ['Muster', 'anniversary', 10],
    ]);
  });
});
