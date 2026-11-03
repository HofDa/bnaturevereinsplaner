import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  unique,
  primaryKey,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations, groups, organizationUserRoles } from './core';
import { user } from './auth';
type Text = { de: string; it: string };
export const communityPosts = pgTable(
  'community_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').$type<'news' | 'poll'>().notNull(),
    titleI18n: jsonb('title_i18n').$type<Text>().notNull(),
    bodyI18n: jsonb('body_i18n').$type<Text>().notNull(),
    groupId: uuid('group_id'),
    pinned: boolean('pinned').notNull().default(false),
    state: text('state').$type<'draft' | 'published' | 'archived'>().notNull().default('draft'),
    version: integer('version').notNull().default(1),
    resultsVisibility: text('results_visibility')
      .$type<'after_vote' | 'after_close'>()
      .notNull()
      .default('after_vote'),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    unique('community_posts_org_id').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [groups.organizationId, groups.id],
    }),
    index('community_posts_feed').on(t.organizationId, t.kind, t.state, t.publishedAt),
    check('community_post_kind', sql`${t.kind} in ('news','poll')`),
    check('community_post_state', sql`${t.state} in ('draft','published','archived')`),
    check(
      'community_results_visibility',
      sql`${t.resultsVisibility} in ('after_vote','after_close')`,
    ),
    check('community_post_version', sql`${t.version}>0`),
    check('community_post_published', sql`${t.state}<>'published' or ${t.publishedAt} is not null`),
    check(
      'community_post_titles',
      sql`length(trim(${t.titleI18n}->>'de'))>0 and length(trim(${t.titleI18n}->>'it'))>0`,
    ),
    check(
      'community_news_body',
      sql`${t.kind}<>'news' or (length(trim(${t.bodyI18n}->>'de'))>0 and length(trim(${t.bodyI18n}->>'it'))>0)`,
    ),
    check(
      'community_news_no_deadline',
      sql`${t.kind}='poll' or (${t.closesAt} is null and ${t.closedAt} is null)`,
    ),
  ],
);
export const communityOptions = pgTable(
  'community_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    postId: uuid('post_id').notNull(),
    labelI18n: jsonb('label_i18n').$type<Text>().notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    unique('community_options_org_post_id').on(t.organizationId, t.postId, t.id),
    unique('community_options_position').on(t.postId, t.position),
    foreignKey({
      columns: [t.organizationId, t.postId],
      foreignColumns: [communityPosts.organizationId, communityPosts.id],
    }),
    check('community_option_position', sql`${t.position} between 0 and 9`),
    check(
      'community_option_labels',
      sql`length(trim(${t.labelI18n}->>'de'))>0 and length(trim(${t.labelI18n}->>'it'))>0`,
    ),
  ],
);
export const communityVotes = pgTable(
  'community_votes',
  {
    organizationId: uuid('organization_id').notNull(),
    postId: uuid('post_id').notNull(),
    userId: uuid('user_id').notNull(),
    optionId: uuid('option_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.postId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.postId, t.optionId],
      foreignColumns: [
        communityOptions.organizationId,
        communityOptions.postId,
        communityOptions.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationUserRoles.organizationId, organizationUserRoles.userId],
    }),
    index('community_votes_results').on(t.organizationId, t.postId, t.optionId),
  ],
);

export const communityChatMessages = pgTable(
  'community_chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    groupId: uuid('group_id'),
    createdBy: uuid('created_by').notNull(),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: uuid('removed_by').references(() => user.id),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [groups.organizationId, groups.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.createdBy],
      foreignColumns: [organizationUserRoles.organizationId, organizationUserRoles.userId],
    }),
    index('community_chat_channel').on(t.organizationId, t.groupId, t.createdAt, t.id),
    unique('community_chat_messages_tenant').on(t.organizationId, t.id),
    check(
      'community_chat_body',
      sql`(${t.removedAt} is null and ${t.removedBy} is null and length(trim(${t.body})) between 1 and 2000) or (${t.removedAt} is not null and ${t.removedBy} is not null and ${t.body}='')`,
    ),
    check('community_chat_version', sql`${t.version}>0`),
  ],
);

// Keep the emoji list in sync with `chatReactionEmojis` in @bnature/contracts.
export const communityChatReactions = pgTable(
  'community_chat_reactions',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    foreignKey({
      columns: [t.organizationId, t.messageId],
      foreignColumns: [communityChatMessages.organizationId, communityChatMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationUserRoles.organizationId, organizationUserRoles.userId],
    }),
    check('community_chat_reaction_emoji', sql`${t.emoji} in ('👍', '❤️', '😂', '😮', '🎉', '🙏')`),
  ],
);
