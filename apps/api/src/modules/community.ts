import { and, or, eq, isNull, sql, asc, desc, count, inArray } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  can,
  communityPostSchema,
  pollResultsVisible,
  type CommunityInput,
  type CommunityQuery,
} from '@bnature/contracts';
import { HttpError, currentAccess, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import { financialOperation, readSnapshot } from './finance/operations';
import { wire } from './responses';
const p = s.communityPosts;
const manager = (a: Access) => can(a.role, 'community:manage');
export { currentAccess } from '../middleware/access';
function audienceCondition(a: Access) {
  return or(
    isNull(p.groupId),
    sql`exists(select 1 from groups g join group_members gm on gm.organization_id=g.organization_id and gm.group_id=g.id join person_user_links pl on pl.organization_id=gm.organization_id and pl.person_id=gm.person_id where g.organization_id=${a.organizationId} and g.id=${p.groupId} and g.active=true and pl.user_id=${a.userId})`,
  );
}
function visible(a: Access) {
  return and(
    eq(p.organizationId, a.organizationId),
    manager(a) ? undefined : and(eq(p.state, 'published'), audienceCondition(a)),
  );
}
export async function groupAccess(db: Executor, a: Access, id: string, writing = false) {
  const [group] = await db
    .select()
    .from(s.groups)
    .where(
      and(
        eq(s.groups.organizationId, a.organizationId),
        eq(s.groups.id, id),
        eq(s.groups.active, true),
      ),
    );
  if (!group) throw new HttpError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.');
  if (manager(a)) return group;
  if (writing) throw new HttpError(403, 'FORBIDDEN', 'Keine Veröffentlichungsrechte.');
  const [membership] = await db
    .select({ id: s.groupMembers.groupId })
    .from(s.groupMembers)
    .innerJoin(
      s.personUserLinks,
      and(
        eq(s.personUserLinks.organizationId, s.groupMembers.organizationId),
        eq(s.personUserLinks.personId, s.groupMembers.personId),
      ),
    )
    .where(
      and(
        eq(s.groupMembers.organizationId, a.organizationId),
        eq(s.groupMembers.groupId, id),
        eq(s.personUserLinks.userId, a.userId),
      ),
    );
  if (!membership) throw new HttpError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.');
  return group;
}
export async function communityAudiences(db: Database, access: Access) {
  return readSnapshot(db, async (tx) => {
    const a = await currentAccess(tx, access);
    const groups = await tx
      .select({ id: s.groups.id, name: s.groups.name })
      .from(s.groups)
      .where(
        and(
          eq(s.groups.organizationId, a.organizationId),
          eq(s.groups.active, true),
          manager(a)
            ? undefined
            : sql`exists(select 1 from group_members gm join person_user_links pl on pl.organization_id=gm.organization_id and pl.person_id=gm.person_id where gm.organization_id=${a.organizationId} and gm.group_id=${s.groups.id} and pl.user_id=${a.userId})`,
        ),
      )
      .orderBy(asc(s.groups.name), asc(s.groups.id));
    return { groups };
  });
}
type Row = typeof p.$inferSelect & { authorName: string; groupName: string | null };
function projection(db: Executor) {
  return db
    .select({ post: p, authorName: s.user.name, groupName: s.groups.name })
    .from(p)
    .innerJoin(s.user, eq(s.user.id, p.createdBy))
    .leftJoin(
      s.groups,
      and(eq(s.groups.organizationId, p.organizationId), eq(s.groups.id, p.groupId)),
    );
}
async function postRow(db: Executor, a: Access, id: string): Promise<Row> {
  const [row] = await projection(db).where(and(visible(a), eq(p.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Beitrag nicht gefunden.');
  return { ...row.post, authorName: row.authorName, groupName: row.groupName };
}
async function responses(db: Executor, a: Access, rows: Row[]) {
  const ids = rows.filter((row) => row.kind === 'poll').map((row) => row.id);
  const ownRows = ids.length
    ? await db
        .select({ postId: s.communityVotes.postId, optionId: s.communityVotes.optionId })
        .from(s.communityVotes)
        .where(
          and(
            eq(s.communityVotes.organizationId, a.organizationId),
            inArray(s.communityVotes.postId, ids),
            eq(s.communityVotes.userId, a.userId),
          ),
        )
    : [];
  const own = new Map(ownRows.map((row) => [row.postId, row.optionId]));
  const closed = (row: Row) =>
    row.kind === 'poll' &&
    (row.state === 'archived' ||
      !!row.closedAt ||
      (!!row.closesAt && row.closesAt.getTime() <= Date.now()));
  const resultsVisible = (row: Row) =>
    row.kind === 'poll' &&
    row.state !== 'draft' &&
    pollResultsVisible(row.resultsVisibility, closed(row), own.has(row.id));
  const visibleIds = rows.filter(resultsVisible).map((row) => row.id);
  const options = ids.length
    ? await db
        .select()
        .from(s.communityOptions)
        .where(
          and(
            eq(s.communityOptions.organizationId, a.organizationId),
            inArray(s.communityOptions.postId, ids),
          ),
        )
        .orderBy(asc(s.communityOptions.position))
    : [];
  const totals = visibleIds.length
    ? await db
        .select({
          postId: s.communityVotes.postId,
          optionId: s.communityVotes.optionId,
          votes: count(),
        })
        .from(s.communityVotes)
        .where(
          and(
            eq(s.communityVotes.organizationId, a.organizationId),
            inArray(s.communityVotes.postId, visibleIds),
          ),
        )
        .groupBy(s.communityVotes.postId, s.communityVotes.optionId)
    : [];
  const votes = new Map(totals.map((total) => [total.optionId, total.votes]));
  return rows.map((row) => {
    const isClosed = closed(row),
      showResults = resultsVisible(row);
    return communityPostSchema.parse(
      wire({
        ...row,
        isClosed,
        myOptionId: own.get(row.id) ?? null,
        resultsVisible: showResults,
        canManage: manager(a),
        canVote:
          row.kind === 'poll' &&
          row.state === 'published' &&
          !isClosed &&
          can(a.role, 'community:vote'),
        totalVotes: showResults
          ? totals
              .filter((total) => total.postId === row.id)
              .reduce((sum, total) => sum + total.votes, 0)
          : null,
        options: options
          .filter((option) => option.postId === row.id)
          .map((option) => ({
            id: option.id,
            labelI18n: option.labelI18n,
            votes: showResults ? (votes.get(option.id) ?? 0) : null,
          })),
      }),
    );
  });
}
async function response(db: Executor, a: Access, row: Row) {
  return (await responses(db, a, [row]))[0]!;
}
export function getCommunityPost(db: Database, access: Access, id: string) {
  return readSnapshot(db, async (tx) => {
    const a = await currentAccess(tx, access);
    return response(tx, a, await postRow(tx, a, id));
  });
}
export function listCommunityPosts(db: Database, access: Access, query: CommunityQuery) {
  return readSnapshot(db, async (tx) => {
    const a = await currentAccess(tx, access);
    if (query.state !== 'published' && !manager(a))
      throw new HttpError(403, 'FORBIDDEN', 'Keine Verwaltungsrechte.');
    if (query.groupId) await groupAccess(tx, a, query.groupId);
    const where = and(
      visible(a),
      eq(p.kind, query.kind),
      eq(p.state, query.state),
      query.groupId ? eq(p.groupId, query.groupId) : undefined,
    );
    const rows = await projection(tx)
      .where(where)
      .orderBy(desc(p.pinned), sql`${p.publishedAt} desc nulls last`, desc(p.createdAt), asc(p.id))
      .limit(12)
      .offset((query.page - 1) * 12);
    const [total] = await tx.select({ n: count() }).from(p).where(where);
    const items = await responses(
      tx,
      a,
      rows.map((row) => ({ ...row.post, authorName: row.authorName, groupName: row.groupName })),
    );
    return { items, total: total?.n ?? 0, page: query.page, pageSize: 12 };
  });
}
async function saveOptions(db: Executor, org: string, id: string, input: CommunityInput) {
  if (input.kind !== 'poll') return;
  await db.insert(s.communityOptions).values(
    input.options.map((labelI18n, position) => ({
      organizationId: org,
      postId: id,
      labelI18n,
      position,
    })),
  );
}
const fields = (input: CommunityInput) => ({
  kind: input.kind,
  titleI18n: input.titleI18n,
  bodyI18n: input.bodyI18n,
  groupId: input.groupId,
  pinned: input.pinned,
  closesAt: input.kind === 'poll' && input.closesAt ? new Date(input.closesAt) : null,
  resultsVisibility: input.kind === 'poll' ? input.resultsVisibility : ('after_vote' as const),
});
function version(row: typeof p.$inferSelect, expected: number) {
  if (row.version !== expected)
    throw new HttpError(409, 'CONFLICT', 'Der Beitrag wurde inzwischen geändert.');
}
export function createCommunityPost(db: Database, a: Access, key: string, input: CommunityInput) {
  return financialOperation(
    db,
    a,
    key,
    'community:create',
    input,
    'community:manage',
    async (tx) => {
      if (input.groupId) await groupAccess(tx, await currentAccess(tx, a), input.groupId, true);
      const [row] = await tx
        .insert(p)
        .values({ organizationId: a.organizationId, createdBy: a.userId, ...fields(input) })
        .returning();
      await saveOptions(tx, a.organizationId, row!.id, input);
      await audit(tx, a, 'create', 'community_post', row!.id, [
        'kind',
        'title',
        'body',
        'audience',
      ]);
      return { id: row!.id };
    },
  );
}
export function editCommunityPost(
  db: Database,
  a: Access,
  key: string,
  id: string,
  expected: number,
  input: CommunityInput,
) {
  return financialOperation(
    db,
    a,
    key,
    `community:edit:${id}`,
    { expected, input },
    'community:manage',
    async (tx) => {
      const row = await postRow(tx, await currentAccess(tx, a), id);
      version(row, expected);
      if (
        row.state === 'archived' ||
        row.kind !== input.kind ||
        (row.kind === 'poll' && row.state !== 'draft')
      )
        throw new HttpError(
          409,
          'COMMUNITY_FROZEN',
          'Diese Inhalte können nicht mehr geändert werden.',
        );
      if (row.state === 'published' && row.groupId !== input.groupId)
        throw new HttpError(
          409,
          'COMMUNITY_FROZEN',
          'Der Empfängerkreis ist nach Veröffentlichung fest.',
        );
      if (input.groupId) await groupAccess(tx, a, input.groupId, true);
      await tx
        .update(p)
        .set({ ...fields(input), version: row.version + 1, updatedAt: new Date() })
        .where(and(eq(p.organizationId, a.organizationId), eq(p.id, id)));
      if (input.kind === 'poll') {
        await tx
          .delete(s.communityOptions)
          .where(
            and(
              eq(s.communityOptions.organizationId, a.organizationId),
              eq(s.communityOptions.postId, id),
            ),
          );
        await saveOptions(tx, a.organizationId, id, input);
      }
      await audit(tx, a, 'update', 'community_post', id, ['content', 'version']);
      return { id };
    },
  );
}
export function transitionCommunityPost(
  db: Database,
  a: Access,
  key: string,
  id: string,
  expected: number,
  action: 'publish' | 'archive' | 'close',
) {
  return financialOperation(
    db,
    a,
    key,
    `community:${action}:${id}`,
    { expected },
    'community:manage',
    async (tx) => {
      const row = await postRow(tx, await currentAccess(tx, a), id);
      version(row, expected);
      const now = new Date();
      if (action === 'publish') {
        if (row.state !== 'draft')
          throw new HttpError(
            409,
            'COMMUNITY_FROZEN',
            'Nur Entwürfe können veröffentlicht werden.',
          );
        if (row.groupId) await groupAccess(tx, a, row.groupId, true);
        if (row.kind === 'poll' && row.closesAt && row.closesAt <= now)
          throw new HttpError(
            409,
            'COMMUNITY_DEADLINE',
            'Das Ende der Umfrage muss in der Zukunft liegen.',
          );
      } else if (action === 'close') {
        if (row.kind !== 'poll' || row.state !== 'published' || row.closedAt)
          throw new HttpError(409, 'COMMUNITY_CLOSED', 'Diese Umfrage ist nicht offen.');
      } else if (row.state === 'archived')
        throw new HttpError(409, 'COMMUNITY_FROZEN', 'Der Beitrag ist bereits archiviert.');
      await tx
        .update(p)
        .set({
          version: row.version + 1,
          updatedAt: now,
          ...(action === 'publish'
            ? { state: 'published' as const, publishedAt: now }
            : action === 'archive'
              ? { state: 'archived' as const }
              : { closedAt: now }),
        })
        .where(and(eq(p.organizationId, a.organizationId), eq(p.id, id)));
      await audit(tx, a, action, 'community_post', id, ['state', 'version']);
      return { id };
    },
  );
}
export function voteCommunityPoll(
  db: Database,
  access: Access,
  key: string,
  id: string,
  expected: number,
  optionId: string,
) {
  return financialOperation(
    db,
    access,
    key,
    `community:vote:${id}`,
    { expected, optionId },
    'community:vote',
    async (tx) => {
      const a = await currentAccess(tx, access);
      const row = await postRow(tx, a, id);
      version(row, expected);
      if (row.groupId) {
        await tx
          .select()
          .from(s.groups)
          .where(and(eq(s.groups.organizationId, a.organizationId), eq(s.groups.id, row.groupId)))
          .for('share');
        await groupAccess(tx, a, row.groupId);
      }
      if (
        row.kind !== 'poll' ||
        row.state !== 'published' ||
        row.closedAt ||
        (row.closesAt && row.closesAt <= new Date())
      )
        throw new HttpError(409, 'COMMUNITY_CLOSED', 'Die Umfrage ist nicht offen.');
      const [option] = await tx
        .select()
        .from(s.communityOptions)
        .where(
          and(
            eq(s.communityOptions.organizationId, a.organizationId),
            eq(s.communityOptions.postId, id),
            eq(s.communityOptions.id, optionId),
          ),
        );
      if (!option) throw new HttpError(404, 'NOT_FOUND', 'Antwort nicht gefunden.');
      await tx
        .insert(s.communityVotes)
        .values({ organizationId: a.organizationId, postId: id, userId: a.userId, optionId })
        .onConflictDoUpdate({
          target: [
            s.communityVotes.organizationId,
            s.communityVotes.postId,
            s.communityVotes.userId,
          ],
          set: { optionId, updatedAt: new Date() },
        });
      // A vote audit records the operation, not the chosen answer or a public voter list.
      await audit(tx, a, 'vote', 'community_poll', id, ['vote']);
      return { id };
    },
  );
}
