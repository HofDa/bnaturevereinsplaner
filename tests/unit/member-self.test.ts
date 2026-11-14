import { describe, it, expect } from 'vitest';
import {
  memberDashboardSchema,
  ownFeesSchema,
  ownMembershipDetailSchema,
} from '../../packages/contracts/src';
import { parseLinkSegments } from '../../apps/web/src/components/safe-links';

describe('safe-links parseLinkSegments', () => {
  it('returns empty array for empty input and literal text when no URL exists', () => {
    expect(parseLinkSegments('')).toEqual([]);
    expect(parseLinkSegments('Hallo Verein, Treffen um 18 Uhr.')).toEqual([
      { type: 'text', value: 'Hallo Verein, Treffen um 18 Uhr.' },
    ]);
  });

  it('extracts http and https links and trims trailing sentence punctuation', () => {
    expect(
      parseLinkSegments('Infos unter https://example.org/treffen, oder http://verein.test/a!'),
    ).toEqual([
      { type: 'text', value: 'Infos unter ' },
      { type: 'link', href: 'https://example.org/treffen', label: 'https://example.org/treffen' },
      { type: 'text', value: ', oder ' },
      { type: 'link', href: 'http://verein.test/a', label: 'http://verein.test/a' },
      { type: 'text', value: '!' },
    ]);
  });

  it('preserves balanced parentheses while stripping enclosing wrappers', () => {
    expect(parseLinkSegments('Siehe (https://example.org/wiki/Trockenrasen_(Südtirol)).')).toEqual([
      { type: 'text', value: 'Siehe (' },
      {
        type: 'link',
        href: 'https://example.org/wiki/Trockenrasen_(S%C3%BCdtirol)',
        label: 'https://example.org/wiki/Trockenrasen_(Südtirol)',
      },
      { type: 'text', value: ').' },
    ]);
  });

  it('does not linkify unsafe schemes and leaves HTML payloads as plain text', () => {
    const xss = '<script>window.communityXss=true</script> javascript:alert(1) https://ok.test/x';
    expect(parseLinkSegments(xss)).toEqual([
      { type: 'text', value: '<script>window.communityXss=true</script> javascript:alert(1) ' },
      { type: 'link', href: 'https://ok.test/x', label: 'https://ok.test/x' },
    ]);
  });

  it('preserves multiline whitespace around links', () => {
    expect(parseLinkSegments('Zeile 1\nhttps://example.org/a\nZeile 2')).toEqual([
      { type: 'text', value: 'Zeile 1\n' },
      { type: 'link', href: 'https://example.org/a', label: 'https://example.org/a' },
      { type: 'text', value: '\nZeile 2' },
    ]);
  });
});

describe('member-self contract schemas', () => {
  it('validates linked and unlinked member dashboards and rejects negative counts', () => {
    const valid = {
      organization: {
        id: crypto.randomUUID(),
        name: 'b*nature',
        organizationType: 'APS' as const,
      },
      linked: false,
      personName: null,
      membership: null,
      fees: { openCount: 0, overdueCount: 0, openCents: 0 },
      community: {
        unreadNews: 0,
        unreadPolls: 0,
        unreadChat: 0,
        openUnansweredPolls: 0,
        openUnansweredSchedules: 0,
      },
      upcomingEvents: [],
      myGroupCount: 0,
      activeLoanCount: 0,
      overdueLoanCount: 0,
      nextAssignment: null,
    };
    expect(memberDashboardSchema.parse(valid)).toEqual(valid);
    expect(
      memberDashboardSchema.safeParse({
        ...valid,
        community: { ...valid.community, openUnansweredSchedules: -1 },
      }).success,
    ).toBe(false);
  });

  it('validates ownMembershipDetailSchema and ownFeesSchema bounds', () => {
    const membershipDetail = {
      organization: {
        id: crypto.randomUUID(),
        name: 'b*nature',
        organizationType: 'ODV' as const,
      },
      linked: true,
      person: {
        id: crypto.randomUUID(),
        firstName: 'Léna',
        lastName: 'Mair',
        email: 'lena@example.test',
        preferredLanguage: 'de' as const,
      },
      membership: {
        id: crypto.randomUUID(),
        membershipNumber: 'A-001',
        membershipType: 'ordinary' as const,
        status: 'active' as const,
        joinedAt: '2024-01-15',
        endedAt: null,
      },
      groups: [],
      consents: { data_processing: { granted: true, decidedOn: '2024-01-15' }, photos: null },
      extraFields: [],
    };
    expect(ownMembershipDetailSchema.parse(membershipDetail)).toEqual(membershipDetail);
    expect(
      ownFeesSchema.safeParse({
        linked: true,
        hasMembership: true,
        openCount: 0,
        overdueCount: 0,
        openCents: 0,
        assessments: [
          {
            id: crypto.randomUUID(),
            fiscalYear: 2026,
            dueDate: '2026-05-01',
            planName: 'Normal',
            interval: 'annual',
            amountCents: 4000,
            paidCents: 0,
            openCents: 4000,
            status: 'open',
            overdue: false,
            exempt: false,
            currency: 'USD',
          },
        ],
        payments: [],
      }).success,
    ).toBe(false);
  });
});
