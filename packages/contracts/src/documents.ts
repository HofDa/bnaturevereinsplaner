import { z } from 'zod';
import { idSchema } from './common';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const documentCategorySchema = z.enum([
  'receipt',
  'contract',
  'minutes',
  'statute',
  'correspondence',
  'other',
]);
export const documentMediaTypeSchema = z.enum(['application/pdf', 'image/png', 'image/jpeg']);
export type DocumentMediaType = z.infer<typeof documentMediaTypeSchema>;
const signatures: [DocumentMediaType, number[]][] = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
];
// Content is classified by its leading bytes, never by the file name or declared type alone.
export function detectMediaType(bytes: Uint8Array): DocumentMediaType | null {
  for (const [type, signature] of signatures)
    if (signature.every((byte, index) => bytes[index] === byte)) return type;
  return null;
}
export const filenameSchema = z
  .string()
  .transform((v) =>
    v
      .normalize('NFC')
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
      .slice(-200),
  )
  .refine((v) => v.length > 0 && v !== '.' && v !== '..', 'documentInvalidFilename');
const reference = idSchema.nullable().default(null);
export const documentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: documentCategorySchema,
    description: z.string().trim().max(2000).default(''),
    cashbookEntryId: reference,
    membershipId: reference,
    filename: filenameSchema,
  })
  .strict();
export type DocumentInput = z.infer<typeof documentInputSchema>;
export const documentVersionInputSchema = z.object({ filename: filenameSchema }).strict();
export const documentPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: documentCategorySchema,
    description: z.string().trim().max(2000),
    archived: z.boolean(),
    cashbookEntryId: idSchema.nullable(),
    membershipId: idSchema.nullable(),
  })
  .strict()
  .partial()
  .extend({ version: z.number().int().min(1) });
export type DocumentPatch = z.infer<typeof documentPatchSchema>;
// Metadata travels in a header so the request body can be the raw file.
export const documentUploadHeaders = z
  .object({
    'idempotency-key': idSchema,
    'x-document-metadata': z.string().max(8192),
  })
  .passthrough();
export function encodeDocumentMetadata(value: unknown): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(value)))
    binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decodeDocumentMetadata(value: string): unknown {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}
export const documentVersionResponseSchema = z.object({
  id: idSchema,
  versionNumber: z.number().int().positive(),
  filename: z.string(),
  mediaType: documentMediaTypeSchema,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string(),
});
export type DocumentVersion = z.infer<typeof documentVersionResponseSchema>;
export const documentResponseSchema = z.object({
  id: idSchema,
  title: z.string(),
  category: documentCategorySchema,
  description: z.string(),
  archived: z.boolean(),
  cashbookEntryId: idSchema.nullable(),
  cashbookEntryLabel: z.string().nullable(),
  membershipId: idSchema.nullable(),
  memberName: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  latestVersion: documentVersionResponseSchema.nullable(),
  versionCount: z.number().int(),
});
export type DocumentRecord = z.infer<typeof documentResponseSchema>;
export const documentDetailSchema = documentResponseSchema.extend({
  versions: z.array(documentVersionResponseSchema),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
export const documentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(''),
  category: documentCategorySchema.optional(),
  archived: z.enum(['true', 'false']).default('false'),
  cashbookEntryId: idSchema.optional(),
  membershipId: idSchema.optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export const documentVersionParams = z.object({ id: idSchema, versionId: idSchema });
