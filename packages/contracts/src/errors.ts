import { z } from 'zod';

/** What the browser app sends when something breaks unexpectedly. No user input, no ids. */
export const clientErrorSchema = z
  .object({
    kind: z.enum(['error', 'rejection', 'render', 'chunk']),
    name: z.string().max(100).default('Error'),
    message: z.string().max(500).default(''),
    stack: z.string().max(4000).default(''),
    path: z.string().max(300).default(''),
    release: z.string().max(60).default(''),
  })
  .strict();
export type ClientError = z.infer<typeof clientErrorSchema>;
export const errorReportSchema = z.object({
  id: z.uuid(),
  source: z.enum(['web', 'api']),
  name: z.string(),
  message: z.string(),
  stack: z.string(),
  location: z.string(),
  release: z.string(),
  userAgent: z.string(),
  occurrences: z.number().int(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type ErrorReport = z.infer<typeof errorReportSchema>;
