import { describe, it, expect } from 'vitest';
import { communityInputSchema, pollResultsVisible, can } from '../../packages/contracts/src';
const poll = {
  kind: 'poll',
  titleI18n: { de: 'Wann?', it: 'Quando?' },
  bodyI18n: { de: '', it: '' },
  options: [
    { de: 'Samstag', it: 'Sabato' },
    { de: 'Sonntag', it: 'Domenica' },
  ],
};
describe('community publishing and result rules', () => {
  it('requires bilingual news and distinct bilingual choices for polls', () => {
    expect(communityInputSchema.safeParse(poll).success).toBe(true);
    expect(
      communityInputSchema.safeParse({ ...poll, options: poll.options.slice(0, 1) }).success,
    ).toBe(false);
    expect(
      communityInputSchema.safeParse({
        ...poll,
        options: [poll.options[0], { de: 'samstag', it: 'Altro' }],
      }).success,
    ).toBe(false);
    expect(
      communityInputSchema.safeParse({
        kind: 'news',
        titleI18n: poll.titleI18n,
        bodyI18n: { de: 'Hallo', it: '' },
      }).success,
    ).toBe(false);
    expect(communityInputSchema.safeParse({ ...poll, userId: crypto.randomUUID() }).success).toBe(
      false,
    );
  });
  it('hides results until the configured condition and releases them after closing', () => {
    expect(pollResultsVisible('after_vote', false, false)).toBe(false);
    expect(pollResultsVisible('after_vote', false, true)).toBe(true);
    expect(pollResultsVisible('after_close', false, true)).toBe(false);
    expect(pollResultsVisible('after_close', true, false)).toBe(true);
  });
  it('allows every account to read and vote while restricting publishing to admin and board', () => {
    for (const role of ['admin', 'board', 'treasurer', 'project_lead', 'member'] as const) {
      expect(can(role, 'community:read')).toBe(true);
      expect(can(role, 'community:vote')).toBe(true);
      expect(can(role, 'community:manage')).toBe(['admin', 'board'].includes(role));
    }
  });
});
