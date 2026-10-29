import { describe, it, expect } from 'vitest';
import {
  can,
  memberInputSchema,
  memberPatchSchema,
  boardSchema,
  listQuerySchema,
} from '../../packages/contracts/src';
import { splitMember, escapeLike } from '../../apps/api/src/modules/members';
const valid = {
  firstName: 'Anna',
  lastName: 'Test',
  membershipNumber: '001',
  joinedAt: '2026-01-01',
};
describe('membership invariants', () => {
  it('normalizes whitespace and keeps login independent', () => {
    const input = memberInputSchema.parse({ ...valid, firstName: ' Anna ' });
    expect(input.firstName).toBe('Anna');
    expect(input).not.toHaveProperty('userId');
    const split = splitMember(input);
    expect(split.person).not.toHaveProperty('status');
    expect(split.membership).not.toHaveProperty('firstName');
  });
  it.each([
    { status: 'resigned' },
    { status: 'active', endedAt: '2026-02-01' },
    { status: 'inactive', endedAt: '2025-01-01' },
    { dateOfBirth: '2026-02-01' },
    { joinedAt: '2026-02-30' },
    { membershipNumber: '' },
    { organizationId: 'injected' },
    { role: 'admin' },
  ])('rejects invalid membership %o', (patch) => {
    expect(memberInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it('accepts an ended resigned membership', () => {
    expect(
      memberInputSchema.parse({ ...valid, status: 'resigned', endedAt: '2026-02-01' }).status,
    ).toBe('resigned');
  });
  it('partial updates do not reset omitted fields', () => {
    expect(memberPatchSchema.parse({ phone: '123' })).toEqual({ phone: '123' });
  });
  it('mandates cannot end before beginning', () => {
    expect(
      boardSchema.safeParse({
        personId: crypto.randomUUID(),
        position: 'Präsident',
        startDate: '2026-01-02',
        endDate: '2026-01-01',
      }).success,
    ).toBe(false);
  });
});
describe('access policy', () => {
  it('limits membership writes and role administration', () => {
    expect(can('admin', 'users:manage')).toBe(true);
    expect(can('board', 'users:manage')).toBe(false);
    expect(can('board', 'members:write')).toBe(true);
    expect(can('treasurer', 'members:write')).toBe(false);
    expect(can('project_lead', 'members:read')).toBe(false);
    expect(can('member', 'members:read')).toBe(false);
    expect(can('member', 'groups:read')).toBe(true);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { pageSize: -1 },
    { sort: 'sql' },
    { search: 'a'.repeat(101) },
  ])('bounds list queries %o', (q) => {
    expect(listQuerySchema.safeParse(q).success).toBe(false);
  });
  it('escapes wildcard searches as literal data', () => {
    expect(escapeLike('a%_\\b')).toBe('a\\%\\_\\\\b');
  });
});
