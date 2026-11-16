import { z } from 'zod';
const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().startsWith('postgres'),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  TRUST_PROXY: z.enum(['false', 'true']).default('false'),
  // Private file storage outside any web root; must be on persistent, backed-up storage.
  DOCUMENT_STORAGE_DIR: z.string().min(1).default('.local/documents'),
  EMAIL_MODE: z.enum(['disabled', 'local', 'smtp']).default('disabled'),
  EMAIL_FROM: z.email().default('noreply@bnature.test'),
  SMTP_HOST: optionalSecret,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['false', 'true']).default('false'),
  SMTP_USER: optionalSecret,
  SMTP_PASSWORD: optionalSecret,
  // Operator address that is told about problems seen for the first time. Needs e-mail.
  ERROR_ALERT_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.email().optional(),
  ),
  // Web Push (browser notifications). Without a key pair the feature is switched off.
  // Generate once with: bunx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: optionalSecret,
  VAPID_PRIVATE_KEY: optionalSecret,
  // Contact the push services may use for this server; defaults to mailto:EMAIL_FROM.
  VAPID_SUBJECT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^(mailto:.+@.+|https:\/\/.+)$/)
      .optional(),
  ),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.EMAIL_MODE === 'smtp' && !config.SMTP_HOST)
    throw new Error('SMTP_HOST is required for EMAIL_MODE=smtp');
  if (!!config.SMTP_USER !== !!config.SMTP_PASSWORD)
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
  if (!!config.VAPID_PUBLIC_KEY !== !!config.VAPID_PRIVATE_KEY)
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together');
  if (config.NODE_ENV === 'production' && config.EMAIL_MODE === 'local')
    throw new Error('Local email capture is only available in development and tests');
  if (
    config.NODE_ENV === 'production' &&
    config.EMAIL_MODE === 'smtp' &&
    config.EMAIL_FROM.endsWith('.test')
  )
    throw new Error('Production email requires a real sender address');
  if (
    config.NODE_ENV === 'production' &&
    (!config.APP_URL.startsWith('https://') || /localhost|127\.0\.0\.1/.test(config.APP_URL))
  )
    throw new Error('Production requires a public HTTPS APP_URL');
  return config;
}
