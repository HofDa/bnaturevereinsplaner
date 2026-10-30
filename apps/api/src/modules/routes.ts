import type { FastifyInstance } from 'fastify';
import type { Database } from '@bnature/db';
import type { Auth } from '../auth';
import type { Config } from '../plugins/config';
import { accessControl } from '../middleware/access';
import { registerSystemRoutes } from './system';
import { registerOrganizationRoutes } from './organization';
import { registerMemberRoutesRoutes } from './member-routes';
import { registerGroupsRoutes } from './groups';
import { registerBoardRoutes } from './board';
import { registerAuditLogRoutes } from './audit-log';
import { registerDashboardRoutes } from './dashboard';
import { registerProfileRoutes } from './profile';
import { registerUsersRoutes } from './users';
import { registerFinanceRoutes } from './finance/routes';
import { registerLedgerRoutes } from './finance/ledger-routes';
import { registerEventRoutes } from './event-routes';
import { registerDocumentRoutes } from './document-routes';
import { registerVolunteerRoutes } from './volunteers/routes';
import { registerMailRoutes } from './mail-routes';
export async function registerRoutes(
  server: FastifyInstance,
  db: Database,
  auth: Auth,
  config: Config,
) {
  const context = { server, db, access: accessControl(db, auth), config };
  registerSystemRoutes(context);
  registerOrganizationRoutes(context);
  registerMemberRoutesRoutes(context);
  registerGroupsRoutes(context);
  registerBoardRoutes(context);
  registerAuditLogRoutes(context);
  registerDashboardRoutes(context);
  registerProfileRoutes(context);
  registerUsersRoutes(context);
  registerFinanceRoutes(context);
  registerLedgerRoutes(context);
  registerDocumentRoutes(context);
  registerEventRoutes(context);
  registerVolunteerRoutes(context);
  registerMailRoutes(context);
}
