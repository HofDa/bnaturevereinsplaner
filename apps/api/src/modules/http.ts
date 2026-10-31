import type { FastifyReply, FastifyRequest } from 'fastify';

export const replay = (
  reply: FastifyReply,
  r: { data: unknown; replayed: boolean },
  status = 200,
) => reply.code(status).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
export const idempotencyKey = (req: FastifyRequest) => String(req.headers['idempotency-key']);
// RFC 6266/5987: ASCII fallback plus the exact UTF-8 name.
export function attachment(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
// Typed reply.send for binary bodies the response schema declares as strings.
export const sendBinary = (reply: FastifyReply, data: Buffer | string) => reply.send(data);
export const sendPdf = (reply: FastifyReply, pdf: Buffer, filename: string) =>
  reply.type('application/pdf').header('Content-Disposition', attachment(filename)).send(pdf);
