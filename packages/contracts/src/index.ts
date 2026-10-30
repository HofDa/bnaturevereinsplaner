import { z } from 'zod';
import {
  idSchema,
  languageSchema,
  membershipTypeSchema,
  statusSchema,
  patchSchema,
} from './common';
export * from './common';
export * from './finance';
export * from './ledger';
export * from './documents';
export * from './roles';
export * from './mail';
export * from './inventory';
import { roleSchema, type Role, type Permission } from './roles';

const date = z.iso.date();
const optionalText = (max = 200) => z.string().trim().max(max).default('');
export const personSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    dateOfBirth: date.nullable().default(null),
    fiscalCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(16)
      .refine((v) => !v || /^[A-Z0-9]{16}$/.test(v), 'invalidFiscalCode')
      .default(''),
    email: z.union([z.email().max(254), z.literal('')]).default(''),
    phone: optionalText(40),
    street: optionalText(),
    postalCode: optionalText(20),
    city: optionalText(100),
    country: z.string().trim().length(2).default('IT'),
    preferredLanguage: languageSchema.default('de'),
  })
  .strict();
export const memberInputSchema = personSchema
  .extend({
    membershipNumber: z.string().trim().min(1).max(40),
    membershipType: membershipTypeSchema.default('ordinary'),
    status: statusSchema.default('active'),
    joinedAt: date,
    endedAt: date.nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endedAt && value.endedAt < value.joinedAt)
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endBeforeStart' });
    if (value.status === 'active' && value.endedAt)
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'activeWithEnd' });
    if (value.status === 'resigned' && !value.endedAt)
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endRequired' });
    if (value.dateOfBirth && value.dateOfBirth > value.joinedAt)
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'birthAfterJoining' });
  });
export const memberPatchSchema = patchSchema(memberInputSchema);
export type MemberInput = z.infer<typeof memberInputSchema>;
export type Member = MemberInput & {
  id: string;
  personId: string;
  createdAt: string;
  updatedAt: string;
};
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(''),
  sort: z.enum(['name', 'createdAt', 'joinedAt']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  status: statusSchema.optional(),
  active: z.enum(['true', 'false']).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export const organizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    fiscalCode: z.string().trim().max(16).default(''),
    organizationType: z.enum(['ODV', 'APS', 'ETS', 'other']).default('other'),
    street: optionalText(),
    postalCode: optionalText(20),
    city: optionalText(100),
    country: z.string().length(2).default('IT'),
    locale: languageSchema.default('de'),
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('de', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      })
      .default('Europe/Rome'),
  })
  .strict();
export type Organization = z.infer<typeof organizationSchema> & { id: string; slug: string };
export const groupSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    active: z.boolean().default(true),
  })
  .strict();
export type Group = z.infer<typeof groupSchema> & { id: string; memberCount: number };
export const boardSchema = z
  .object({
    personId: idSchema,
    position: z.string().trim().min(1).max(120),
    startDate: date,
    endDate: date.nullable().default(null),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'endBeforeStart',
  });
export type BoardMandate = z.infer<typeof boardSchema> & {
  id: string;
  firstName: string;
  lastName: string;
};
export const userProvisionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email(),
    password: z.string().min(12).max(128),
    role: roleSchema,
    personId: idSchema.optional(),
  })
  .strict();
export type Me = {
  user: { id: string; name: string; email: string };
  organizations: { id: string; name: string; role: Role }[];
  activeOrganizationId: string;
  role: Role;
  permissions: Permission[];
};
export type Dashboard = {
  activeMembers: number;
  totalMembers: number;
  newMembers: number;
  activeGroups: number;
  statuses: Record<z.infer<typeof statusSchema>, number>;
  recentMembers: Member[];
  board: BoardMandate[];
};
export type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  timestamp: string;
  changeMetadata: { fields: string[] };
};
export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

export * from './ets';
export * from './events';
export * from './event-time';

export * from './volunteers';
export * from './compliance';
