import type { FastifyInstance } from 'fastify';
import type { Database } from '@bnature/db';
import type { accessControl } from '../middleware/access';
import type { Config } from '../plugins/config';
import type { PushSender } from '../services/push';
export type ModuleContext = {
  server: FastifyInstance;
  db: Database;
  access: ReturnType<typeof accessControl>;
  config: Config;
  /** Null when Web Push is not configured on this server. */
  push: PushSender | null;
};
