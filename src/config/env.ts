import { z } from 'zod';

const envSchema = z.object({
  DATALINK_BASE_URL: z.string().url(),
  DATALINK_SUBSCRIPTION_KEY: z.string().min(1),
  TARGET_MARKET_COUNTRY_CODE: z.string().regex(/^\d+$/),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1),
  MONGODB_COLLECTION: z.string().min(1),
  MONGODB_SYNC_STATE_COLLECTION: z.string().min(1).default('gs1_datalink_sync_state'),

  /** Collection for raw Datalink items XML → JSON snapshots (staging / review). Default `xmltojson`. */
  MONGODB_XMLTOJSON_COLLECTION: z.string().min(1).default('xmltojson'),

  /** Persist raw items XML→JSON snapshots (see `XmlToJsonRepository`). */
  XML_TO_JSON_SAVE: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true' || v === '1'),

  /** Map trade items → product documents and upsert into `MONGODB_COLLECTION`. Off by default while extraction logic is refined. */
  SAVE_PRODUCTS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true' || v === '1'),

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

  /**
   * When true, logs XML body previews for items export (poll + synchronous 200 start) using
   * `effectiveItemsXmlPreviewChars` — see `LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS`.
   */
  LOG_DATALINK_ITEM_DETAILS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true' || v === '1'),

  /**
   * Max characters of item XML to log when details are enabled. If 0 and `LOG_DATALINK_ITEM_DETAILS`
   * is true, `effectiveItemsXmlPreviewChars` uses {@link DEFAULT_ITEMS_XML_PREVIEW_CHARS}. If this
   * value is > 0, it always wins (item details logging is implicitly on for that budget).
   * Cap 512KiB.
   */
  LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS: z.coerce.number().int().min(0).max(524_288).default(0),

  INITIAL_UPDATED_SINCE: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : undefined))
    .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), 'INITIAL_UPDATED_SINCE must be ISO8601'),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Default preview size when `LOG_DATALINK_ITEM_DETAILS=true` and explicit char cap is 0. */
export const DEFAULT_ITEMS_XML_PREVIEW_CHARS = 16_384;

/**
 * Character budget for `datalink_items_*_xml_preview` logs. Explicit
 * `LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS` > 0 always applies; otherwise, when
 * `LOG_DATALINK_ITEM_DETAILS` is set, uses {@link DEFAULT_ITEMS_XML_PREVIEW_CHARS}.
 */
export function effectiveItemsXmlPreviewChars(cfg: Pick<AppConfig, 'LOG_DATALINK_ITEM_DETAILS' | 'LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS'>): number {
  if (cfg.LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS > 0) {
    return cfg.LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS;
  }
  if (cfg.LOG_DATALINK_ITEM_DETAILS) {
    return DEFAULT_ITEMS_XML_PREVIEW_CHARS;
  }
  return 0;
}

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
