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
  chatReactionInputSchema,
  unreadSchema,
  markReadSchema,
  notificationSettingsSchema,
  notificationSettingsInputSchema,
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
} from './community';
import {
  listCommunityChat,
  sendCommunityChat,
  removeCommunityChat,
  reactCommunityChat,
} from './community-chat';
import {
  communityUnread,
  markCommunityRead,
  getNotificationSettings,
  updateNotificationSettings,
} from './community-notify';
export function registerCommunityRoutes({ server, db, access, config }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
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
      const r = await sendCommunityChat(
        db,
        await access(req, 'community:chat'),
        req.headers['idempotency-key'],
        req.body,
      );
      return reply.code(201).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
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
      const r = await removeCommunityChat(
        db,
        await access(req, 'community:chat'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body.version,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
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
      const r = await reactCommunityChat(
        db,
        await access(req, 'community:chat'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.get(
    '/api/v1/community/unread',
    { schema: { tags, response: { 200: unreadSchema } } },
    async (req) => communityUnread(db, await access(req, 'community:read')),
  );
  app.put(
    '/api/v1/community/read',
    {
      schema: { tags, body: markReadSchema },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await markCommunityRead(db, await access(req, 'community:read'), req.body);
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
      return reply.code(201).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
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
      const r = await editCommunityPost(
        db,
        await access(req, 'community:manage'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body.version,
        req.body.content,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
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
        const r = await transitionCommunityPost(
          db,
          await access(req, 'community:manage'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body.version,
          action,
        );
        return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
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
      const r = await voteCommunityPoll(
        db,
        await access(req, 'community:vote'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body.version,
        req.body.optionId,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
}
