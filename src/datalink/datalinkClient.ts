import type { AppConfig } from '../config/env.js';
import {
  DatalinkAuthError,
  DatalinkForbiddenError,
  DatalinkHttpError,
  DatalinkNotFoundError,
} from '../errors/DatalinkHttpError.js';
import type { AppLogger } from '../types/logger.js';
import type { DatalinkApi } from './datalinkApi.js';
import { AsyncMutex, MinuteRateLimiter, sleep } from './rateLimiter.js';

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt)) return asInt * 1000;
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

export class DatalinkClient implements DatalinkApi {
  private readonly rateLimiter = new MinuteRateLimiter(20);
  private readonly mutex = new AsyncMutex();

  constructor(
    private readonly config: Pick<
      AppConfig,
      | 'DATALINK_BASE_URL'
      | 'DATALINK_SUBSCRIPTION_KEY'
      | 'HTTP_TIMEOUT_MS'
      | 'USER_AGENT'
    >,
    private readonly logger: AppLogger,
  ) {}

  async getSuppliers(params?: { updatedSince?: string }): Promise<{ status: number; bodyText: string }> {
    const qs = new URLSearchParams();
    if (params?.updatedSince) qs.set('updatedSince', params.updatedSince);
    const path = `/suppliers${qs.toString() ? `?${qs.toString()}` : ''}`;
    return this.request('GET', path, { operation: 'getSuppliers' });
  }

  async startItems(params: {
    gln: string;
    targetMarketCountryCode: string;
    updatedSince?: string;
  }): Promise<{ status: number; bodyText: string }> {
    const qs = new URLSearchParams();
    qs.set('gln', params.gln);
    qs.set('targetMarketCountryCode', params.targetMarketCountryCode);
    if (params.updatedSince) qs.set('updatedSince', params.updatedSince);
    return this.request('GET', `/items?${qs.toString()}`, {
      operation: 'startItems',
      gln: params.gln,
    });
  }

  async getItemsByInvocationId(invocationId: string): Promise<{ status: number; bodyText: string }> {
    return this.request('GET', `/items/${encodeURIComponent(invocationId)}`, {
      operation: 'getItemsByInvocationId',
      invocationId,
    });
  }

  async getItem(params: {
    gln: string;
    gtin: string;
    targetMarketCountryCode: string;
  }): Promise<{ status: number; bodyText: string }> {
    const p = `/items/${encodeURIComponent(params.gln)}/${encodeURIComponent(params.gtin)}/${encodeURIComponent(params.targetMarketCountryCode)}`;
    return this.request('GET', p, {
      operation: 'getItem',
      gln: params.gln,
    });
  }

  private async request(
    method: 'GET',
    path: string,
    fields: Record<string, unknown>,
  ): Promise<{ status: number; bodyText: string }> {
    return this.mutex.runExclusive(() => this.requestInner(method, path, fields));
  }

  private async requestInner(
    method: 'GET',
    path: string,
    fields: Record<string, unknown>,
  ): Promise<{ status: number; bodyText: string }> {
    const url = joinUrl(this.config.DATALINK_BASE_URL, path);
    const maxAttempts = 12;
    let attempt = 0;

    while (true) {
      attempt += 1;
      await this.rateLimiter.throttle();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.HTTP_TIMEOUT_MS);
      const started = Date.now();
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Ocp-Apim-Subscription-Key': this.config.DATALINK_SUBSCRIPTION_KEY,
            'User-Agent': this.config.USER_AGENT,
            Accept: '*/*',
          },
          signal: controller.signal,
        });

        const durationMs = Date.now() - started;
        const bodyText = await res.text();

        this.logger.info(
          {
            operation: fields.operation,
            httpStatus: res.status,
            durationMs,
            retryCount: attempt - 1,
            url,
            ...fields,
          },
          'datalink_http_response',
        );

        if (res.status === 401) {
          throw new DatalinkAuthError(url);
        }

        if (res.status === 403) {
          throw new DatalinkForbiddenError(url, bodyText);
        }

        if (res.status === 429) {
          const retryAfterMs = parseRetryAfterMs(res.headers) ?? 5000;
          if (attempt >= maxAttempts) {
            throw new DatalinkHttpError('Too many retries after 429', 429, url);
          }
          this.logger.warn(
            { operation: fields.operation, retryAfterMs, attempt },
            'datalink_rate_limited',
          );
          await sleep(retryAfterMs);
          continue;
        }

        if (res.status === 503) {
          if (attempt >= maxAttempts) {
            throw new DatalinkHttpError('Service unavailable (503) after retries', 503, url);
          }
          const backoff = Math.min(30_000, 1000 * 2 ** Math.min(10, attempt)) + Math.floor(Math.random() * 500);
          this.logger.warn({ operation: fields.operation, backoffMs: backoff, attempt }, 'datalink_503_backoff');
          await sleep(backoff);
          continue;
        }

        return { status: res.status, bodyText };
      } catch (err) {
        const durationMs = Date.now() - started;
        if (err instanceof DatalinkAuthError) throw err;
        if (err instanceof DatalinkForbiddenError) throw err;
        if (err instanceof DatalinkHttpError) throw err;

        const isAbort = err instanceof Error && err.name === 'AbortError';
        this.logger.error(
          {
            operation: fields.operation,
            durationMs,
            isAbort,
            err,
          },
          'datalink_http_error',
        );

        if (attempt >= maxAttempts) {
          throw new DatalinkHttpError(isAbort ? 'Request timeout' : 'Request failed', 0, url, {
            cause: err,
          });
        }

        const backoff = Math.min(30_000, 1000 * 2 ** Math.min(10, attempt)) + Math.floor(Math.random() * 500);
        await sleep(backoff);
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}

export function assertOkInvocationPoll(
  status: number,
  urlContext: string,
): void {
  if (status === 404) throw new DatalinkNotFoundError(urlContext);
}
