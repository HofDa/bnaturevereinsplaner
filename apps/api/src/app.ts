import Fastify, { LogController } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { fromNodeHeaders } from 'better-auth/node';
import type { Database } from '@bnature/db';
import { errorSchema } from '@bnature/contracts';
import { createAuth } from './auth';
import { HttpError } from './middleware/access';
import { registerRoutes } from './modules/routes';
import type { Config } from './plugins/config';
import { createPushSender, type PushSender } from './services/push';
import { createErrorAlert, recordError, type ErrorAlert } from './services/error-reports';

export async function createApp(
  db: Database,
  config: Config,
  // Tests pass their own sender; by default pushes go out when VAPID keys are configured.
  push: PushSender | null = createPushSender(config),
  errorAlert?: ErrorAlert | null,
) {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: 'info',
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'],
            serializers: {
              req: (req) => ({ method: req.method, path: req.url?.split('?')[0] }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
    bodyLimit: 256 * 1024,
    trustProxy: config.TRUST_PROXY === 'true',
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  const auth = createAuth(db, config);
  const ownAlert = errorAlert === undefined ? createErrorAlert(config) : null;
  const alert = errorAlert === undefined ? ownAlert!.alert : errorAlert;
  app.addHook('onClose', async () => ownAlert?.close());
  await app.register(rateLimit, {
    hook: 'preHandler',
    max: 150,
    timeWindow: '1 minute',
    keyGenerator: async (req) => {
      if (!req.url.startsWith('/api/v1/')) return req.ip;
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      return session ? `user:${session.user.id}` : `ip:${req.ip}`;
    },
  });
  const ipLimit = app.createRateLimit({
    max: 3000,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });
  app.addHook('onRequest', async (req, reply) => {
    const result = await ipLimit(req);
    if (!result.isAllowed && result.isExceeded) {
      reply.header('Retry-After', result.ttlInSeconds);
      throw new HttpError(429, 'RATE_LIMITED', 'Zu viele Anfragen. Bitte später erneut versuchen.');
    }
  });
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/api/v1'))
      route.schema = {
        ...route.schema,
        response: {
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          413: errorSchema,
          415: errorSchema,
          422: errorSchema,
          429: errorSchema,
          500: errorSchema,
          ...(typeof route.schema?.response === 'object' && route.schema.response
            ? route.schema.response
            : {}),
        },
      };
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'b*nature API',
        version: '1.2.3',
        description:
          'Organization-scoped REST API. Cookie session required except health. Set X-Organization-Id to select an authorized organization.',
      },
      servers: [{ url: config.APP_URL }],
      components: {
        securitySchemes: {
          cookieSession: {
            type: 'apiKey',
            in: 'cookie',
            name:
              config.NODE_ENV === 'production'
                ? '__Secure-better-auth.session_token'
                : 'better-auth.session_token',
          },
        },
      },
      security: [{ cookieSession: [] }],
    },
    transform: jsonSchemaTransform,
    transformObject: (document) => {
      if (!('openapiObject' in document)) return document.swaggerObject;
      const api = document.openapiObject;
      // Binary success responses still use the shared JSON error contract.
      for (const path of Object.values(api.paths ?? {})) {
        if (!path) continue;
        for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
          const operation = path[method];
          if (!operation) continue;
          for (const [status, response] of Object.entries(operation.responses ?? {})) {
            if (status.startsWith('2') || '$ref' in response) continue;
            if (response.content?.['application/pdf'])
              response.content = { 'application/json': response.content['application/pdf'] };
          }
        }
      }
      return api;
    },
  });
  if (config.NODE_ENV !== 'production') await app.register(swaggerUI, { routePrefix: '/api/docs' });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers.origin !== new URL(config.APP_URL).origin ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new HttpError(
          403,
          'INVALID_ORIGIN',
          'Die Anfrage stammt nicht vom erlaubten Ursprung.',
        );
    }
  });
  app.setErrorHandler((error, req, reply) => {
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'Die Anfrage konnte nicht verarbeitet werden.';
    let fields: Record<string, string[]> | undefined;
    if (error instanceof HttpError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 422;
      code = 'VALIDATION_ERROR';
      message = 'Bitte prüfen Sie Ihre Eingaben.';
      fields = {};
      for (const issue of error.issues) (fields[issue.path.join('.')] ??= []).push(issue.message);
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error.validation
    ) {
      status = 422;
      code = 'VALIDATION_ERROR';
      message = 'Bitte prüfen Sie Ihre Eingaben.';
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    ) {
      status = error.statusCode;
      code = status === 429 ? 'RATE_LIMITED' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      message =
        status === 429 ? 'Zu viele Anfragen. Bitte später erneut versuchen.' : 'Ungültige Anfrage.';
    } else {
      const cause =
        typeof error === 'object' && error !== null && 'cause' in error ? error.cause : error;
      const pgCode = typeof cause === 'object' && cause && 'code' in cause ? cause.code : undefined;
      if (pgCode === '23505') {
        status = 409;
        code = 'CONFLICT';
        message = 'Dieser Eintrag ist bereits vorhanden.';
      } else if (pgCode === '23P01') {
        status = 409;
        code = 'OVERLAP';
        message = 'Der Zeitraum überschneidet sich mit einem vorhandenen Eintrag.';
      } else if (pgCode === '23503' || pgCode === '23514') {
        status = 422;
        code = 'INVALID_RELATION';
        message = 'Die Zuordnung oder der Status ist ungültig.';
      } else {
        app.log.error(
          { requestId: req.id, code: typeof pgCode === 'string' ? pgCode : 'INTERNAL_ERROR' },
          'Request failed',
        );
        // Keep what is needed to find the bug: error type, masked message, stack frames and
        // the route pattern (never the concrete URL or the request body).
        const failure = error instanceof Error ? error : new Error('Non-error thrown');
        void recordError(
          db,
          {
            source: 'api',
            name: typeof pgCode === 'string' ? `${failure.name} (${pgCode})` : failure.name,
            message: failure.message,
            stack: failure.stack,
            location: `${req.method} ${req.routeOptions?.url ?? 'unknown route'}`,
            release: process.env.APP_RELEASE ?? '',
          },
          alert,
        );
      }
    }
    return reply
      .code(status)
      .send({ error: { code, message, requestId: req.id, ...(fields ? { fields } : {}) } });
  });
  app.setNotFoundHandler(() => {
    throw new HttpError(404, 'NOT_FOUND', 'Endpunkt nicht gefunden.');
  });
  const authPaths = new Set([
    '/api/auth/sign-in/email',
    '/api/auth/sign-out',
    '/api/auth/get-session',
    '/api/auth/change-password',
    '/api/auth/update-user',
    '/api/auth/list-sessions',
    '/api/auth/revoke-session',
    '/api/auth/revoke-sessions',
    '/api/auth/revoke-other-sessions',
  ]);
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    schema: { hide: true },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      if (!authPaths.has(req.url.split('?')[0]!))
        throw new HttpError(404, 'NOT_FOUND', 'Endpunkt nicht gefunden.');
      const url = new URL(req.url, config.APP_URL);
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers: fromNodeHeaders(req.headers),
          ...(req.body ? { body: JSON.stringify(req.body) } : {}),
        }),
      );
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(await response.text());
    },
  });
  await registerRoutes(app, db, auth, config, push, alert);
  return app;
}
