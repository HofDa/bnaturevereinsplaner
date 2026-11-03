import { z } from 'zod';
import {
  memberInputSchema,
  organizationSchema,
  groupSchema,
  boardSchema,
  idSchema,
} from '@bnature/contracts';
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export const wire = <T>(v: T): Wire<T> => JSON.parse(JSON.stringify(v)) as Wire<T>;
export const memberResponse = memberInputSchema.safeExtend({
  id: idSchema,
  personId: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  photoConsent: z.enum(['granted', 'refused']).nullable().optional(),
  dataConsent: z.enum(['granted', 'refused']).nullable().optional(),
  customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export const pageOf = (item: z.ZodType) =>
  z.object({ items: z.array(item), total: z.number(), page: z.number(), pageSize: z.number() });
export const orgResponse = organizationSchema.extend({ id: idSchema, slug: z.string() }).strip();
export const groupResponse = groupSchema.extend({ id: idSchema, memberCount: z.number() }).strip();
export const boardResponse = boardSchema.safeExtend({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
});
