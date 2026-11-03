import { attachmentDisposition as attachment } from '../services/http';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const replay = (
  reply: FastifyReply,
  r: { data: unknown; replayed: boolean },
  status = 200,
) => reply.code(status).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
export const idempotencyKey = (req: FastifyRequest) => String(req.headers['idempotency-key']);
export { attachment };
// Typed reply.send for binary bodies the response schema declares as strings.
export const sendBinary = (reply: FastifyReply, data: Buffer | string) => reply.send(data);
export const sendPdf = (reply: FastifyReply, pdf: Buffer, filename: string) =>
  reply.type('application/pdf').header('Content-Disposition', attachment(filename)).send(pdf);
