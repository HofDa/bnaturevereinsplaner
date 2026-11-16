import type { FastifyInstance } from 'fastify';
import type { Database } from '@bnature/db';
import type { Auth } from '../auth';
import type { Config } from '../plugins/config';
import type { PushSender } from '../services/push';
import type { ErrorAlert } from '../services/error-reports';
import type { LiveHub } from '../services/live';
import { registerErrorReportRoutes } from './error-reports';
import { accessControl } from '../middleware/access';
import { registerSystemRoutes } from './system';
import { registerOrganizationRoutes } from './organization';
import { registerMemberRoutesRoutes } from './member-routes';
import { registerMemberExtrasRoutes } from './member-extras';
import { registerReportRoutes } from './reports';
import { registerNewsletterRoutes } from './mail-newsletters';
import { registerGroupsRoutes } from './groups';
import { registerBoardRoutes } from './board';
import { registerAuditLogRoutes } from './audit-log';
import { registerDashboardRoutes } from './dashboard';
import { registerProfileRoutes } from './profile';
import { registerMemberSelfRoutes } from './member-self';
import { registerUsersRoutes } from './users';
import { registerFinanceRoutes } from './finance/routes';
import { registerLedgerRoutes } from './finance/ledger-routes';
import { registerEventRoutes } from './event-routes';
import { registerDocumentRoutes } from './document-routes';
import { registerVolunteerRoutes } from './volunteers/routes';
import { registerMailRoutes } from './mail-routes';
import { registerInventoryRoutes } from './inventory-routes';
import { registerCommunityRoutes } from './community-routes';
import { registerPlanningRoutes } from './planning';
export async function registerRoutes(
  server: FastifyInstance,
  db: Database,
  auth: Auth,
  config: Config,
  push: PushSender | null,
  errorAlert: ErrorAlert | null,
  live: LiveHub,
) {
  const context = {
    server,
    db,
    access: accessControl(db, auth),
    config,
    push,
    errorAlert,
    live,
  };
  registerSystemRoutes(context);
  registerOrganizationRoutes(context);
  registerMemberRoutesRoutes(context);
  registerMemberExtrasRoutes(context);
  registerReportRoutes(context);
  registerNewsletterRoutes(context);
  registerGroupsRoutes(context);
  registerBoardRoutes(context);
  registerAuditLogRoutes(context);
  registerErrorReportRoutes(context);
  registerDashboardRoutes(context);
  registerProfileRoutes(context);
  registerMemberSelfRoutes(context);
  registerUsersRoutes(context);
  registerFinanceRoutes(context);
  registerLedgerRoutes(context);
  registerDocumentRoutes(context);
  registerEventRoutes(context);
  registerVolunteerRoutes(context);
  registerMailRoutes(context);
  registerInventoryRoutes(context);
  registerCommunityRoutes(context);
  registerPlanningRoutes(context);
}
