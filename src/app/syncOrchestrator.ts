import type { AppConfig } from '../config/env.js';
import type { DatalinkApi } from '../datalink/datalinkApi.js';
import { DatalinkHttpError, DatalinkNotFoundError } from '../errors/DatalinkHttpError.js';
import { mapTradeItemDtoToProductDocument, maxLastChangeIso } from '../map/toProductDocument.js';
import type { SyncMetrics } from '../observability/metrics.js';
import { parseSuppliersXml } from '../parse/suppliersXml.js';
import { extractTradeItemDtos, parseTradeItemDtoFromItemResponse } from '../parse/tradeItemXml.js';
import type { AppLogger } from '../types/logger.js';
import type { ProductsRepository } from '../db/productsRepository.js';
import type { SyncStateRepository } from '../db/syncStateRepository.js';
import { sleep } from '../datalink/rateLimiter.js';

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

async function pollItemsResult(params: {
  api: DatalinkApi;
  cfg: Pick<AppConfig, 'POLL_MAX_MS' | 'POLL_BASE_DELAY_MS' | 'POLL_MAX_DELAY_MS'>;
  logger: AppLogger;
  invocationId: string;
}): Promise<string> {
  const deadline = Date.now() + params.cfg.POLL_MAX_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const res = await params.api.getItemsByInvocationId(params.invocationId);

    if (res.status === 200) {
      return res.bodyText;
    }
    if (res.status === 204) {
      return '';
    }
    if (res.status === 404) {
      throw new DatalinkNotFoundError(`items:${params.invocationId}`);
    }
    if (res.status === 202) {
      const backoff = Math.min(
        params.cfg.POLL_MAX_DELAY_MS,
        params.cfg.POLL_BASE_DELAY_MS * 2 ** Math.min(12, attempt),
      );
      params.logger.info(
        { invocationId: params.invocationId, attempt, backoffMs: backoff + jitter(250) },
        'datalink_items_poll_waiting',
      );
      await sleep(backoff + jitter(250));
      continue;
    }

    throw new DatalinkHttpError(
      `Unexpected status while polling items`,
      res.status,
      `items:${params.invocationId}`,
    );
  }

  throw new DatalinkHttpError('Polling timed out', 408, `items:${params.invocationId}`);
}

async function fetchItemsXml(params: {
  api: DatalinkApi;
  cfg: AppConfig;
  logger: AppLogger;
  gln: string;
  updatedSince?: string;
}): Promise<string | null> {
  const start = await params.api.startItems({
    gln: params.gln,
    targetMarketCountryCode: params.cfg.TARGET_MARKET_COUNTRY_CODE,
    updatedSince: params.updatedSince,
  });

  if (start.status === 204) {
    return null;
  }

  if (start.status === 202) {
    const invocationId = start.bodyText.trim();
    if (!invocationId) {
      throw new DatalinkHttpError('Missing invocationId in 202 response', 202, 'items:start');
    }
    params.logger.info({ gln: params.gln, invocationId }, 'datalink_items_started');
    const xml = await pollItemsResult({
      api: params.api,
      cfg: params.cfg,
      logger: params.logger,
      invocationId,
    });
    return xml.trim() ? xml : null;
  }

  if (start.status === 200) {
    return start.bodyText.trim() ? start.bodyText : null;
  }

  throw new DatalinkHttpError(`Unexpected status starting items export`, start.status, 'items:start');
}

export type SyncRunOptions = {
  maxSuppliers?: number;
  maxItems?: number;
  gln?: string;
  shouldStop?: () => boolean;
};

export async function runSyncJob(params: {
  cfg: AppConfig;
  logger: AppLogger;
  metrics: SyncMetrics;
  api: DatalinkApi;
  products?: ProductsRepository;
  syncState?: SyncStateRepository;
  options?: SyncRunOptions;
}): Promise<void> {
  const { cfg, logger, metrics, api } = params;
  const options = params.options ?? {};

  const suppliersRes = await api.getSuppliers();
  if (suppliersRes.status !== 200) {
    throw new DatalinkHttpError('Unexpected suppliers response', suppliersRes.status, 'suppliers');
  }

  let suppliers = parseSuppliersXml(suppliersRes.bodyText);
  if (options.gln) {
    suppliers = suppliers.filter((s) => s.gln === options.gln);
  }
  if (typeof options.maxSuppliers === 'number') {
    suppliers = suppliers.slice(0, Math.max(0, options.maxSuppliers));
  }

  logger.info({ supplierCount: suppliers.length }, 'sync_suppliers_loaded');

  const defaultBootstrapIso = cfg.INITIAL_UPDATED_SINCE ?? '1970-01-01T00:00:00.000Z';

  for (const supplier of suppliers) {
    if (options.shouldStop?.()) {
      logger.warn({}, 'sync_stopped_by_signal');
      break;
    }

    const gln = supplier.gln;
    const tmcc = cfg.TARGET_MARKET_COUNTRY_CODE;

    const persistedSince = cfg.DRY_RUN
      ? undefined
      : await params.syncState?.getUpdatedSince(gln, tmcc);
    const updatedSince = persistedSince ?? defaultBootstrapIso;

    let xml: string | null;
    try {
      xml = await fetchItemsXml({ api, cfg, logger, gln, updatedSince });
    } catch (err) {
      logger.error({ gln, err }, 'sync_items_fetch_failed');
      metrics.recordFailure('http');
      continue;
    }

    if (!xml) {
      logger.info({ gln }, 'sync_no_items_for_selection');
      continue;
    }

    let dtos = extractTradeItemDtos({
      itemsResponseXml: xml,
      gln,
      targetMarketCountryCode: tmcc,
    });
    metrics.itemsFetched += dtos.length;

    if (typeof options.maxItems === 'number') {
      dtos = dtos.slice(0, Math.max(0, options.maxItems));
    }

    let mapped;
    try {
      mapped = dtos.map((dto) => mapTradeItemDtoToProductDocument(dto, cfg.ADDED_BY_OBJECT_ID));
    } catch (err) {
      logger.error({ gln, err }, 'sync_map_failed');
      metrics.recordFailure('map');
      continue;
    }
    metrics.itemsMapped += mapped.length;

    if (cfg.DRY_RUN) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ gln, count: mapped.length, sample: mapped[0] ?? null }, null, 2));
      continue;
    }

    if (!params.products) {
      throw new Error('ProductsRepository missing while DRY_RUN=false');
    }

    try {
      const res = await params.products.bulkUpsertMappedProducts(mapped);
      metrics.itemsUpserted += res.upserted + res.modified;
      logger.info({ gln, ...res }, 'sync_bulk_upsert_complete');
    } catch (err) {
      logger.error({ gln, err }, 'sync_bulk_upsert_failed');
      metrics.recordFailure('mongo');
      continue;
    }

    const nextSince = maxLastChangeIso(mapped) ?? new Date().toISOString();
    if (!cfg.DRY_RUN && params.syncState) {
      await params.syncState.putUpdatedSince(gln, tmcc, nextSince);
    }
  }
}

export async function runFetchOneJob(params: {
  cfg: AppConfig;
  logger: AppLogger;
  metrics: SyncMetrics;
  api: DatalinkApi;
  products?: ProductsRepository;
  gln: string;
  gtin: string;
  targetMarketCountryCode: string;
}): Promise<void> {
  const { cfg, logger, metrics, api } = params;

  const res = await api.getItem({
    gln: params.gln,
    gtin: params.gtin,
    targetMarketCountryCode: params.targetMarketCountryCode,
  });

  if (res.status === 204) {
    logger.info({}, 'fetch_one_no_content');
    return;
  }
  if (res.status !== 200) {
    throw new DatalinkHttpError('Unexpected item response', res.status, 'item');
  }

  metrics.itemsFetched += 1;

  const dto = parseTradeItemDtoFromItemResponse({
    xml: res.bodyText,
    gln: params.gln,
    gtin: params.gtin,
    targetMarketCountryCode: params.targetMarketCountryCode,
  });

  const mapped = mapTradeItemDtoToProductDocument(dto, cfg.ADDED_BY_OBJECT_ID);
  metrics.itemsMapped += 1;

  if (cfg.DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(mapped, null, 2));
    return;
  }

  if (!params.products) {
    throw new Error('ProductsRepository missing while DRY_RUN=false');
  }

  await params.products.bulkUpsertMappedProducts([mapped]);
  metrics.itemsUpserted += 1;
}
