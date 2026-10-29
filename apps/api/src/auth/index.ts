import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { schema, type Executor } from '@bnature/db';
import type { Config } from '../plugins/config';
export function createAuth(db: Executor, config: Config, provisioning = false) {
  return betterAuth({
    appName: 'b*nature Vereinsplattform',
    baseURL: config.APP_URL,
    basePath: '/api/auth',
    secret: config.AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    trustedOrigins: [new URL(config.APP_URL).origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !provisioning,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      storage: 'memory',
      customRules: { '/sign-in/email': { window: 60, max: 10 } },
    },
    logger: { disabled: config.NODE_ENV === 'test', level: 'error' },
  });
}
export type Auth = ReturnType<typeof createAuth>;
