import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import {
  idParams,
  memberInputSchema,
  memberPatchSchema,
  listQuerySchema,
} from '@bnature/contracts';
import { listMembers, getMember, createMember, updateMember } from './members';
import { wire, memberResponse, pageOf } from './responses';
export function registerMemberRoutesRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(
    `${p}/members`,
    {
      schema: {
        tags: ['Members'],
        querystring: listQuerySchema,
        response: { 200: pageOf(memberResponse) },
      },
    },
    async (req) => {
      const a = await access(req, 'members:read');
      return wire(await listMembers(db, a.organizationId, req.query));
    },
  );
  app.post(
    `${p}/members`,
    { schema: { tags: ['Members'], body: memberInputSchema, response: { 201: memberResponse } } },
    async (req, reply) => {
      const a = await access(req, 'members:write');
      return reply.code(201).send(wire(await createMember(db, a, req.body)));
    },
  );
  app.get(
    `${p}/members/:id`,
    { schema: { tags: ['Members'], params: idParams, response: { 200: memberResponse } } },
    async (req) => {
      const a = await access(req, 'members:read');
      return wire(await getMember(db, a.organizationId, req.params.id));
    },
  );
  app.patch(
    `${p}/members/:id`,
    {
      schema: {
        tags: ['Members'],
        params: idParams,
        body: memberPatchSchema,
        response: { 200: memberResponse },
      },
    },
    async (req) => {
      const a = await access(req, 'members:write');
      return wire(await updateMember(db, a, req.params.id, req.body));
    },
  );
}
