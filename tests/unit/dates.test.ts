import { describe, expect, it } from 'vitest';
import { dateInTimeZone } from '../../packages/contracts/src/dates';
describe('organization business dates', () => {
  it.each([
    ['Europe/Rome', '2026-11-03T23:30:00Z', '2026-11-04'],
    ['Europe/Rome', '2026-07-03T22:30:00Z', '2026-07-04'],
    ['Europe/Rome', '2026-03-29T00:30:00Z', '2026-03-29'],
    ['Europe/Rome', '2026-10-25T01:30:00Z', '2026-10-25'],
    ['America/Los_Angeles', '2026-11-04T01:30:00Z', '2026-11-03'],
    ['Pacific/Auckland', '2026-11-03T12:30:00Z', '2026-11-04'],
  ])('uses %s at %s', (zone, instant, expected) => {
    expect(dateInTimeZone(zone, new Date(instant))).toBe(expected);
  });
});
