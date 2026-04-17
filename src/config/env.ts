import { z } from 'zod';

const envSchema = z.object({
  DATALINK_BASE_URL: z.string().url(),
  DATALINK_SUBSCRIPTION_KEY: z.string().min(1),
  TARGET_MARKET_COUNTRY_CODE: z.string().regex(/^\d+$/),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1),
  MONGODB_COLLECTION: z.string().min(1),
  MONGODB_SYNC_STATE_COLLECTION: z.string().min(1).default('gs1_datalink_sync_state'),

  ADDED_BY_OBJECT_ID: z.string().regex(/^[a-f0-9]{24}$/i),

  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  POLL_MAX_MS: z.coerce.number().int().positive().default(900_000),
  POLL_BASE_DELAY_MS: z.coerce.number().int().positive().default(2000),
  POLL_MAX_DELAY_MS: z.coerce.number().int().positive().default(30_000),

  DRY_RUN: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true' || v === '1'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  USER_AGENT: z.string().min(1).default('gs1-pool/1.0.0'),

  INITIAL_UPDATED_SINCE: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : undefined))
    .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), 'INITIAL_UPDATED_SINCE must be ISO8601'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  return parsed.data;
}

export function redactMongoUri(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '[invalid-uri]';
  }
}
