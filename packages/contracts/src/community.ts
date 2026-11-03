import { z } from 'zod';
const text = (max: number, min = 0) =>
  z
    .object({ de: z.string().trim().min(min).max(max), it: z.string().trim().min(min).max(max) })
    .strict();
const common = {
  titleI18n: text(200, 1),
  groupId: z.uuid().nullable().default(null),
  pinned: z.boolean().default(false),
};
export const communityInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('news'), bodyI18n: text(10_000, 1) }).strict(),
  z
    .object({
      ...common,
      kind: z.literal('poll'),
      bodyI18n: text(10_000),
      options: z
        .array(text(200, 1))
        .min(2)
        .max(10)
        .refine(
          (values) =>
            ['de', 'it'].every(
              (lang) =>
                new Set(
                  values.map((value) => value[lang as 'de' | 'it'].toLocaleLowerCase().trim()),
                ).size === values.length,
            ),
          'communityDuplicateOptions',
        ),
      closesAt: z.iso.datetime({ offset: true }).nullable().default(null),
      resultsVisibility: z.enum(['after_vote', 'after_close']).default('after_vote'),
    })
    .strict(),
]);
export type CommunityInput = z.infer<typeof communityInputSchema>;
export const communityEditSchema = z
  .object({ version: z.number().int().positive(), content: communityInputSchema })
  .strict();
export const communityVersionSchema = z.object({ version: z.number().int().positive() }).strict();
export const communityVoteSchema = z
  .object({ version: z.number().int().positive(), optionId: z.uuid() })
  .strict();
export const communityQuerySchema = z.object({
  kind: z.enum(['news', 'poll']).default('news'),
  state: z.enum(['draft', 'published', 'archived']).default('published'),
  groupId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type CommunityQuery = z.infer<typeof communityQuerySchema>;
export const communityPostSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['news', 'poll']),
  titleI18n: text(200),
  bodyI18n: text(10_000),
  groupId: z.uuid().nullable(),
  groupName: z.string().nullable(),
  pinned: z.boolean(),
  state: z.enum(['draft', 'published', 'archived']),
  version: z.number().int(),
  authorName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  isClosed: z.boolean(),
  resultsVisibility: z.enum(['after_vote', 'after_close']),
  resultsVisible: z.boolean(),
  totalVotes: z.number().int().nullable(),
  myOptionId: z.uuid().nullable(),
  canManage: z.boolean(),
  canVote: z.boolean(),
  options: z.array(
    z.object({ id: z.uuid(), labelI18n: text(200), votes: z.number().int().nullable() }),
  ),
});
export type CommunityPost = z.infer<typeof communityPostSchema>;
export const communityAudienceSchema = z.object({
  groups: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export function pollResultsVisible(
  policy: 'after_vote' | 'after_close',
  closed: boolean,
  voted: boolean,
) {
  return closed || (policy === 'after_vote' && voted);
}

export const chatInputSchema = z
  .object({ groupId: z.uuid().nullable().default(null), body: z.string().trim().min(1).max(2000) })
  .strict();
export const chatQuerySchema = z.object({
  groupId: z.uuid().optional(),
  before: z.uuid().optional(),
});
/** Fixed reaction set; mirrored by the `community_chat_reaction_emoji` check constraint. */
export const chatReactionEmojis = ['👍', '❤️', '😂', '😮', '🎉', '🙏'] as const;
export type ChatReactionEmoji = (typeof chatReactionEmojis)[number];
export const chatReactionInputSchema = z
  .object({ emoji: z.enum(chatReactionEmojis), active: z.boolean() })
  .strict();
export const chatReactionSchema = z.object({
  emoji: z.enum(chatReactionEmojis),
  count: z.number().int(),
  mine: z.boolean(),
  names: z.array(z.string()),
});
export type ChatReaction = z.infer<typeof chatReactionSchema>;
export const chatMessageSchema = z.object({
  id: z.uuid(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string(),
  removedAt: z.string().nullable(),
  version: z.number().int(),
  isOwn: z.boolean(),
  canRemove: z.boolean(),
  reactions: z.array(chatReactionSchema),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatPageSchema = z.object({
  items: z.array(chatMessageSchema),
  nextBefore: z.uuid().nullable(),
});

export const unreadSchema = z.object({
  news: z.number().int(),
  polls: z.number().int(),
  chat: z.array(z.object({ groupId: z.uuid().nullable(), count: z.number().int() })),
  total: z.number().int(),
});
export type Unread = z.infer<typeof unreadSchema>;
export const markReadSchema = z
  .object({
    channel: z.enum(['news', 'poll', 'chat']),
    groupId: z.uuid().nullable().default(null),
    until: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((v) => v.channel === 'chat' || v.groupId === null, {
    message: 'Only chat markers belong to a group.',
    path: ['groupId'],
  });
export const digestModeSchema = z.enum(['off', 'daily', 'weekly']);
export const notificationSettingsSchema = z.object({
  digest: digestModeSchema,
  email: z.string(),
  emailEnabled: z.boolean(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export const notificationSettingsInputSchema = z.object({ digest: digestModeSchema }).strict();
