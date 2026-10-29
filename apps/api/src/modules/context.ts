import type { FastifyInstance } from 'fastify';
import type { Database } from '@bnature/db';
import type { accessControl } from '../middleware/access';
import type { Config } from '../plugins/config';
export type ModuleContext = {
  server: FastifyInstance;
  db: Database;
  access: ReturnType<typeof accessControl>;
  config: Config;
};
