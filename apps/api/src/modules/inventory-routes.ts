import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idParams,
  financeWriteHeaders,
  financePageSchema,
  inventoryItemSchema,
  inventoryItemInputSchema,
  inventoryItemPatchSchema,
  inventoryItemQuerySchema,
  inventoryRetireSchema,
  inventoryLoanSchema,
  inventoryLoanInputSchema,
  inventoryLoanReturnSchema,
  inventoryLoanExtendSchema,
  inventoryLoanQuerySchema,
  inventorySummarySchema,
  inventoryExportQuerySchema,
} from '@bnature/contracts';
import type { ModuleContext } from './context';
import {
  listItems,
  getItem,
  createItem,
  updateItem,
  retireItem,
  inventorySummary,
  exportItems,
  listLoans,
  myLoans,
  getLoan,
  createLoan,
  returnLoan,
  extendLoan,
  borrowerOptions,
} from './inventory';

const replay = (reply: FastifyReply, r: { data: unknown; replayed: boolean }, status = 200) =>
  reply.code(status).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
const key = (req: FastifyRequest) => String(req.headers['idempotency-key']);

export function registerInventoryRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1/inventory';
  const tags = ['Inventory'];
  const write = { headers: financeWriteHeaders };
  app.get(
    `${p}/summary`,
    { schema: { tags, response: { 200: inventorySummarySchema } } },
    async (req) => inventorySummary(db, await access(req, 'inventory:read')),
  );
  app.get(
    `${p}/items`,
    {
      schema: {
        tags,
        querystring: inventoryItemQuerySchema,
        response: { 200: financePageSchema(inventoryItemSchema) },
      },
    },
    async (req) => listItems(db, await access(req, 'inventory:read'), req.query),
  );
  app.get(
    `${p}/items/export`,
    {
      schema: {
        tags,
        querystring: inventoryExportQuerySchema,
        produces: ['text/csv'],
        response: { 200: z.string() },
      },
    },
    async (req, reply) => {
      const csv = await exportItems(db, await access(req, 'inventory:read'), req.query);
      return reply
        .header('Content-Disposition', 'attachment; filename="inventar.csv"')
        .header('Cache-Control', 'no-store')
        .type('text/csv; charset=utf-8')
        .send(csv);
    },
  );
  app.get(
    `${p}/items/:id`,
    { schema: { tags, params: idParams, response: { 200: inventoryItemSchema } } },
    async (req) => getItem(db, await access(req, 'inventory:read'), req.params.id),
  );
  app.post(
    `${p}/items`,
    {
      schema: {
        tags,
        ...write,
        body: inventoryItemInputSchema,
        response: { 201: inventoryItemSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createItem(db, await access(req, 'inventory:write'), key(req), req.body),
        201,
      ),
  );
  app.patch(
    `${p}/items/:id`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: inventoryItemPatchSchema,
        response: { 200: inventoryItemSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await updateItem(
          db,
          await access(req, 'inventory:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.post(
    `${p}/items/:id/retire`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: inventoryRetireSchema,
        response: { 200: inventoryItemSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await retireItem(
          db,
          await access(req, 'inventory:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.get(
    `${p}/people`,
    {
      schema: {
        tags,
        response: {
          200: z.object({
            items: z.array(z.object({ id: z.uuid(), name: z.string(), isMember: z.boolean() })),
          }),
        },
      },
    },
    async (req) => borrowerOptions(db, await access(req, 'inventory:lend')),
  );
  app.get(
    `${p}/loans`,
    {
      schema: {
        tags,
        querystring: inventoryLoanQuerySchema,
        response: { 200: financePageSchema(inventoryLoanSchema) },
      },
    },
    async (req) => listLoans(db, await access(req, 'inventory:read'), req.query),
  );
  // Any signed-in person sees only the loans recorded for their own linked person.
  app.get(
    `${p}/my-loans`,
    {
      schema: {
        tags,
        querystring: inventoryLoanQuerySchema,
        response: { 200: financePageSchema(inventoryLoanSchema) },
      },
    },
    async (req) => myLoans(db, await access(req), req.query),
  );
  app.get(
    `${p}/loans/:id`,
    { schema: { tags, params: idParams, response: { 200: inventoryLoanSchema } } },
    async (req) => getLoan(db, await access(req, 'inventory:read'), req.params.id),
  );
  app.post(
    `${p}/loans`,
    {
      schema: {
        tags,
        ...write,
        body: inventoryLoanInputSchema,
        response: { 201: inventoryLoanSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createLoan(db, await access(req, 'inventory:lend'), key(req), req.body),
        201,
      ),
  );
  app.post(
    `${p}/loans/:id/return`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: inventoryLoanReturnSchema,
        response: { 200: inventoryLoanSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await returnLoan(
          db,
          await access(req, 'inventory:lend'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.post(
    `${p}/loans/:id/extend`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: inventoryLoanExtendSchema,
        response: { 200: inventoryLoanSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await extendLoan(
          db,
          await access(req, 'inventory:lend'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
}
