import { z } from 'zod';
export const idSchema = z.uuid();
export const idParams = z.object({ id: idSchema });
export const languageSchema = z.enum(['de', 'it']);
export const statusSchema = z.enum(['active', 'pending', 'inactive', 'resigned']);
export const membershipTypeSchema = z.enum(['ordinary', 'supporting', 'honorary']);
export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.removeDefault() : field,
    ]),
  ) as T;
  return z.object(shape).strict().partial();
}
