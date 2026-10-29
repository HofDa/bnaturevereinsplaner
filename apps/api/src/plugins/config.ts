import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().startsWith('postgres'),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  TRUST_PROXY: z.enum(['false', 'true']).default('false'),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (
    config.NODE_ENV === 'production' &&
    (!config.APP_URL.startsWith('https://') || /localhost|127\.0\.0\.1/.test(config.APP_URL))
  )
    throw new Error('Production requires a public HTTPS APP_URL');
  return config;
}
