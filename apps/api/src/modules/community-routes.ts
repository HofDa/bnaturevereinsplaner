import { replay } from './http';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  idParams,
  financeWriteHeaders,
  communityInputSchema,
  communityEditSchema,
  communityVersionSchema,
  communityVoteSchema,
  communityQuerySchema,
  communityPostSchema,
  communityAudienceSchema,
  chatInputSchema,
  chatQuerySchema,
  chatPageSchema,
  chatMemberSchema,
  scheduleInputSchema,
  scheduleAnswersInputSchema,
  scheduleCloseSchema,
  scheduleQuerySchema,
  scheduleSummarySchema,
  scheduleDetailSchema,
  scheduleEventInputSchema,
  chatReactionInputSchema,
  unreadSchema,
  markReadSchema,
  notificationSettingsSchema,
  notificationSettingsInputSchema,
  pushSubscriptionInputSchema,
  pushSubscriptionRemoveSchema,
} from '@bnature/contracts';
import type { ModuleContext } from './context';
import { pageOf } from './responses';
import {
  listCommunityPosts,
  getCommunityPost,
  communityAudiences,
  createCommunityPost,
  editCommunityPost,
  transitionCommunityPost,
  voteCommunityPoll,
  currentAccess,
  groupAccess,
} from './community';
import {
  listCommunityChat,
  sendCommunityChat,
  removeCommunityChat,
  reactCommunityChat,
} from './community-chat';
import { chatMembers } from './community-chat-extras';
import {
  listSchedules,
  getSchedule,
  createSchedule,
  answerSchedule,
  closeSchedule,
  createEventFromSchedule,
} from './community-schedules';
import { readSnapshot } from './finance/operations';
import { can } from '@bnature/contracts';
import { schema as s } from '@bnature/db';
import { and, eq } from 'drizzle-orm';
import {
  communityUnread,
  markCommunityRead,
  memberGroups,
  getNotificationSettings,
  updateNotificationSettings,
} from './community-notify';
import {
  savePushSubscription,
  removePushSubscription,
  notifyPostPublished,
  notifyChatMessage,
} from './community-push';
export function registerCommunityRoutes({ server, db, access, config, push, live }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  // A post changed (published, edited, closed, archived, voted on): tell its audience.
  const postChanged = async (organizationId: string, postId: string) => {
    const [post] = await db
      .select({ groupId: s.communityPosts.groupId })
      .from(s.communityPosts)
      .where(
        and(eq(s.communityPosts.organizationId, organizationId), eq(s.communityPosts.id, postId)),
      );
    if (post)
      live.publish(
        { type: 'posts', groupId: post.groupId },
        { organizationId, groupId: post.groupId },
      );
  };
  const chatChanged = async (organizationId: string, messageId: string) => {
    const m = s.communityChatMessages;
    const [message] = await db
      .select({ groupId: m.groupId })
      .from(m)
      .where(and(eq(m.organizationId, organizationId), eq(m.id, messageId)));
    if (message)
      live.publish(
        { type: 'chat', groupId: message.groupId },
        { organizationId, groupId: message.groupId, needsChat: true },
      );
  };
  // Pushes go out after the write is committed and never delay or fail the request.
  const afterCommit = (work: Promise<unknown>) =>
    void work.catch((error: unknown) =>
      server.log.error(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'Notification after a community change failed.',
      ),
    );
  const tags = ['Community'];
  const result = z.object({ id: z.uuid() });
  app.get(
    '/api/v1/community/chat',
    { schema: { tags, querystring: chatQuerySchema, response: { 200: chatPageSchema } } },
    async (req) =>
      listCommunityChat(
        db,
        await access(req, 'community:chat'),
        req.query.groupId ?? null,
        req.query.before,
      ),
  );
  app.get(
    '/api/v1/community/chat/members',
    {
      schema: {
        tags,
        querystring: z.object({ groupId: z.uuid().optional() }),
        response: { 200: z.object({ items: z.array(chatMemberSchema) }) },
      },
    },
    async (req) => {
      const access0 = await access(req, 'community:chat');
      return readSnapshot(db, async (tx) => {
        const a = await currentAccess(tx, access0);
        if (req.query.groupId) await groupAccess(tx, a, req.query.groupId);
        return { items: await chatMembers(tx, a, req.query.groupId ?? null) };
      });
    },
  );
  app.post(
    '/api/v1/community/chat',
    {
      schema: {
        tags,
        body: chatInputSchema,
        headers: financeWriteHeaders,
        response: { 201: result },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const a = await access(req, 'community:chat');
      const r = await sendCommunityChat(db, a, req.headers['idempotency-key'], req.body);
      if (push && !r.replayed) afterCommit(notifyChatMessage(db, push, a, r.data.id));
      if (!r.replayed)
        live.publish(
          { type: 'chat', groupId: req.body.groupId ?? null },
          { organizationId: a.organizationId, groupId: req.body.groupId ?? null, needsChat: true },
        );
      return replay(reply, r, 201);
    },
  );
  app.post(
    '/api/v1/community/chat/:id/remove',
    {
      schema: {
        tags,
        params: idParams,
        body: communityVersionSchema,
        headers: financeWriteHeaders,
        response: { 200: result },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'community:chat');
      const r = await removeCommunityChat(
        db,
        a,
        req.headers['idempotency-key'],
        req.params.id,
        req.body.version,
      );
      if (!r.replayed) afterCommit(chatChanged(a.organizationId, req.params.id));
      return replay(reply, r);
    },
  );
  app.put(
    '/api/v1/community/chat/:id/reactions',
    {
      schema: {
        tags,
        params: idParams,
        body: chatReactionInputSchema,
        headers: financeWriteHeaders,
        response: { 200: result },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const a = await access(req, 'community:chat');
      const r = await reactCommunityChat(
        db,
        a,
        req.headers['idempotency-key'],
        req.params.id,
        req.body,
      );
      if (!r.replayed) afterCommit(chatChanged(a.organizationId, req.params.id));
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.get(
    '/api/v1/community/unread',
    {
      schema: { tags, response: { 200: unreadSchema } },
      // Background badge polling runs on every page; its own budget keeps it from using up
      // the general per-IP limit that protects user actions.
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req) => communityUnread(db, await access(req, 'community:read')),
  );
  app.put(
    '/api/v1/community/read',
    {
      schema: { tags, body: markReadSchema },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const a = await access(req, 'community:read');
      await markCommunityRead(db, a, req.body);
      // The account's other tabs and devices drop their badge too.
      live.publish({ type: 'read' }, { organizationId: a.organizationId, onlyUserId: a.userId });
      return reply.code(204).send();
    },
  );
  app.get(
    '/api/v1/community/notifications',
    { schema: { tags, response: { 200: notificationSettingsSchema } } },
    async (req) => getNotificationSettings(db, await access(req, 'community:read'), config),
  );
  app.put(
    '/api/v1/community/notifications',
    {
      schema: {
        tags,
        body: notificationSettingsInputSchema,
        response: { 200: notificationSettingsSchema },
      },
    },
    async (req) =>
      updateNotificationSettings(db, await access(req, 'community:read'), config, req.body.digest),
  );
  app.get(
    '/api/v1/community/stream',
    {
      schema: { tags, hide: true },
      // Reconnects after sleep or network changes come in bursts.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const a = await access(req, 'community:read');
      const groups = await memberGroups(db, a);
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      const opened = live.open(response, {
        organizationId: a.organizationId,
        userId: a.userId,
        groups: new Set(groups.map((g) => g.id)),
        moderator: can(a.role, 'community:manage'),
        chat: can(a.role, 'community:chat'),
      });
      // Too many streams: end cleanly; the browser falls back to polling and retries later.
      if (!opened) response.end('event: busy\ndata: {}\n\n');
    },
  );
  app.put(
    '/api/v1/community/push-subscriptions',
    {
      schema: { tags, body: pushSubscriptionInputSchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await savePushSubscription(db, await access(req, 'community:read'), push !== null, req.body);
      return reply.code(204).send();
    },
  );
  app.post(
    '/api/v1/community/push-subscriptions/remove',
    {
      schema: { tags, body: pushSubscriptionRemoveSchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await removePushSubscription(db, await access(req, 'community:read'), req.body.endpoint);
      return reply.code(204).send();
    },
  );
  app.get(
    '/api/v1/community/schedules',
    {
      schema: {
        tags,
        querystring: scheduleQuerySchema,
        response: { 200: pageOf(scheduleSummarySchema) },
      },
    },
    async (req) =>
      listSchedules(
        db,
        await access(req, 'community:read'),
        req.query.state,
        req.query.page,
        req.query.pageSize,
        req.query.groupId,
      ),
  );
  app.get(
    '/api/v1/community/schedules/:id',
    { schema: { tags, params: idParams, response: { 200: scheduleDetailSchema } } },
    async (req) => getSchedule(db, await access(req, 'community:read'), req.params.id),
  );
  app.post(
    '/api/v1/community/schedules',
    {
      schema: {
        tags,
        body: scheduleInputSchema,
        headers: financeWriteHeaders,
        response: { 201: result },
      },
    },
    async (req, reply) => {
      const r = await createSchedule(
        db,
        await access(req, 'community:read'),
        req.headers['idempotency-key'],
        req.body,
      );
      return reply.code(201).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.put(
    '/api/v1/community/schedules/:id/answers',
    {
      schema: {
        tags,
        params: idParams,
        body: scheduleAnswersInputSchema,
        headers: financeWriteHeaders,
        response: { 200: result },
      },
    },
    async (req, reply) => {
      const r = await answerSchedule(
        db,
        await access(req, 'community:vote'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.post(
    '/api/v1/community/schedules/:id/close',
    {
      schema: {
        tags,
        params: idParams,
        body: scheduleCloseSchema,
        headers: financeWriteHeaders,
        response: { 200: result },
      },
    },
    async (req, reply) => {
      const r = await closeSchedule(
        db,
        await access(req, 'community:read'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.post(
    '/api/v1/community/schedules/:id/event',
    {
      schema: {
        tags,
        params: idParams,
        body: scheduleEventInputSchema,
        headers: financeWriteHeaders,
        response: { 201: result },
      },
    },
    async (req, reply) => {
      const r = await createEventFromSchedule(
        db,
        await access(req, 'events:write'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body,
      );
      return reply.code(201).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.get(
    '/api/v1/community/audiences',
    { schema: { tags, response: { 200: communityAudienceSchema } } },
    async (req) => communityAudiences(db, await access(req, 'community:read')),
  );
  app.get(
    '/api/v1/community/posts',
    {
      schema: {
        tags,
        querystring: communityQuerySchema,
        response: { 200: pageOf(communityPostSchema) },
      },
    },
    async (req) => listCommunityPosts(db, await access(req, 'community:read'), req.query),
  );
  app.get(
    '/api/v1/community/posts/:id',
    { schema: { tags, params: idParams, response: { 200: communityPostSchema } } },
    async (req) => getCommunityPost(db, await access(req, 'community:read'), req.params.id),
  );
  app.post(
    '/api/v1/community/posts',
    {
      schema: {
        tags,
        body: communityInputSchema,
        headers: financeWriteHeaders,
        response: { 201: result },
      },
    },
    async (req, reply) => {
      const r = await createCommunityPost(
        db,
        await access(req, 'community:manage'),
        req.headers['idempotency-key'],
        req.body,
      );
      return replay(reply, r, 201);
    },
  );
  app.patch(
    '/api/v1/community/posts/:id',
    {
      schema: {
        tags,
        params: idParams,
        body: communityEditSchema,
        headers: financeWriteHeaders,
        response: { 200: result },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'community:manage');
      const r = await editCommunityPost(
        db,
        a,
        req.headers['idempotency-key'],
        req.params.id,
        req.body.version,
        req.body.content,
      );
      if (!r.replayed) afterCommit(postChanged(a.organizationId, req.params.id));
      return replay(reply, r);
    },
  );
  for (const action of ['publish', 'archive', 'close'] as const)
    app.post(
      `/api/v1/community/posts/:id/${action}`,
      {
        schema: {
          tags,
          params: idParams,
          body: communityVersionSchema,
          headers: financeWriteHeaders,
          response: { 200: result },
        },
      },
      async (req, reply) => {
        const a = await access(req, 'community:manage');
        const r = await transitionCommunityPost(
          db,
          a,
          req.headers['idempotency-key'],
          req.params.id,
          req.body.version,
          action,
        );
        if (push && action === 'publish' && !r.replayed)
          afterCommit(notifyPostPublished(db, push, a, req.params.id));
        if (!r.replayed) afterCommit(postChanged(a.organizationId, req.params.id));
        return replay(reply, r);
      },
    );
  app.put(
    '/api/v1/community/posts/:id/vote',
    {
      schema: {
        tags,
        params: idParams,
        body: communityVoteSchema,
        headers: financeWriteHeaders,
        response: { 200: result },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'community:vote');
      const r = await voteCommunityPoll(
        db,
        a,
        req.headers['idempotency-key'],
        req.params.id,
        req.body.version,
        req.body.optionId,
      );
      if (!r.replayed) afterCommit(postChanged(a.organizationId, req.params.id));
      return replay(reply, r);
    },
  );
}
