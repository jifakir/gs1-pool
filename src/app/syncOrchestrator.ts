import { effectiveItemsXmlPreviewChars, type AppConfig } from '../config/env.js';
import type { DatalinkApi } from '../datalink/datalinkApi.js';
import { DatalinkHttpError, DatalinkNotFoundError } from '../errors/DatalinkHttpError.js';
import { mapTradeItemDtoToProductDocument, maxLastChangeIso } from '../map/toProductDocument.js';
import type { SyncMetrics } from '../observability/metrics.js';
import { buildGs1ItemId, buildXmlToJsonItemSnapshots } from '../parse/buildXmlToJsonItemSnapshots.js';
import { cleanJsonForXmlToJsonStorage } from '../parse/cleanJsonForXmlToJsonStorage.js';
import { parseDatalinkItemsXmlToJson } from '../parse/datalinkItemsXmlToJson.js';
import { parseSuppliersXml } from '../parse/suppliersXml.js';
import { extractTradeItemDtos, parseTradeItemDtoFromItemResponse } from '../parse/tradeItemXml.js';
import type { AppLogger } from '../types/logger.js';
import type { ProductsRepository } from '../db/productsRepository.js';
import type { XmlToJsonRepository } from '../db/xmlToJsonRepository.js';
import type { SyncStateRepository } from '../db/syncStateRepository.js';
import { sleep } from '../datalink/rateLimiter.js';
import { persistXmlToJsonSnapshots } from '../storage/persistXmlToJsonSnapshots.js';

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

function maybeLogXmlBodyPreview(
  logger: AppLogger,
  previewChars: number,
  meta: Record<string, unknown>,
  bodyText: string,
  msg: string,
): void {
  if (previewChars <= 0) return;
  logger.info(
    {
      ...meta,
      totalChars: bodyText.length,
      truncated: bodyText.length > previewChars,
      preview: bodyText.slice(0, previewChars),
    },
    msg,
  );
}

async function pollItemsResult(params: {
  api: DatalinkApi;
  cfg: Pick<AppConfig, 'POLL_MAX_MS' | 'POLL_BASE_DELAY_MS' | 'POLL_MAX_DELAY_MS'>;
  itemXmlPreviewChars: number;
  logger: AppLogger;
  invocationId: string;
  gln: string;
}): Promise<string> {
  const deadline = Date.now() + params.cfg.POLL_MAX_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const res = await params.api.getItemsByInvocationId(params.invocationId);

    if (res.status === 200) {
      maybeLogXmlBodyPreview(
        params.logger,
        params.itemXmlPreviewChars,
        {
          phase: 'items_poll',
          gln: params.gln,
          invocationId: params.invocationId,
        },
        res.bodyText,
        'datalink_items_invocation_xml_preview',
      );
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

async function saveItemsXmlAsJsonSnapshots(params: {
  cfg: AppConfig;
  logger: AppLogger;
  metrics: SyncMetrics;
  xmlToJson?: XmlToJsonRepository;
  correlationId: string;
  gln: string;
  updatedSince: string;
  xml: string;
}): Promise<void> {
  if (params.cfg.DRY_RUN || !params.cfg.XML_TO_JSON_SAVE) {
    return;
  }
  const parsed = parseDatalinkItemsXmlToJson(params.xml);
  const records = buildXmlToJsonItemSnapshots({
    parsed,
    correlationId: params.correlationId,
    glnContext: params.gln,
    tmccContext: params.cfg.TARGET_MARKET_COUNTRY_CODE,
    updatedSince: params.updatedSince,
    source: 'sync_items_export',
    clean: {
      trimStrings: params.cfg.XMLTOJSON_CLEAN_TRIM_STRINGS,
      dropEmptyStrings: params.cfg.XMLTOJSON_CLEAN_DROP_EMPTY_STRINGS,
    },
  });
  await persistXmlToJsonSnapshots({
    mongo: params.xmlToJson,
    localDir: params.cfg.XMLTOJSON_LOCAL_DIR,
    logger: params.logger,
    metrics: params.metrics,
    rawXml: params.xml,
    snapshots: records,
    dedupeMode: params.cfg.XMLTOJSON_DEDUPE_MODE,
  });
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
    params.logger.info(
      {
        gln: params.gln,
        targetMarketCountryCode: params.cfg.TARGET_MARKET_COUNTRY_CODE,
        updatedSince: params.updatedSince,
        meaning:
          'GS1 returned 204: no trade items match this query (often nothing changed since updatedSince for incremental sync).',
      },
      'datalink_items_start_no_content_204',
    );
    return null;
  }

  const itemXmlPreviewChars = effectiveItemsXmlPreviewChars(params.cfg);

  if (start.status === 202) {
    const invocationId = start.bodyText.trim();
    if (!invocationId) {
      throw new DatalinkHttpError('Missing invocationId in 202 response', 202, 'items:start');
    }
    params.logger.info({ gln: params.gln, invocationId }, 'datalink_items_started');
    const xml = await pollItemsResult({
      api: params.api,
      cfg: params.cfg,
      itemXmlPreviewChars,
      logger: params.logger,
      invocationId,
      gln: params.gln,
    });
    if (!xml.trim()) {
      params.logger.info(
        {
          gln: params.gln,
          invocationId,
          meaning: 'Poll returned 200 with empty body — no XML payload.',
        },
        'datalink_items_poll_empty_body',
      );
      return null;
    }
    return xml;
  }

  if (start.status === 200) {
    maybeLogXmlBodyPreview(
      params.logger,
      itemXmlPreviewChars,
      {
        phase: 'items_start_sync',
        gln: params.gln,
      },
      start.bodyText,
      'datalink_items_start_xml_preview',
    );
    if (!start.bodyText.trim()) {
      params.logger.info(
        { gln: params.gln, meaning: 'startItems returned 200 with empty body.' },
        'datalink_items_start_sync_empty_body',
      );
      return null;
    }
    return start.bodyText;
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
  xmlToJson?: XmlToJsonRepository;
  correlationId: string;
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
      logger.debug({ gln, updatedSince }, 'sync_supplier_skipped_no_xml_payload');
      continue;
    }

    await saveItemsXmlAsJsonSnapshots({
      cfg,
      logger,
      metrics,
      xmlToJson: params.xmlToJson,
      correlationId: params.correlationId,
      gln,
      updatedSince,
      xml,
    });

    if (!cfg.SAVE_PRODUCTS) {
      logger.info({ gln }, 'sync_products_pipeline_skipped_save_products_disabled');
      continue;
    }

    let dtos = extractTradeItemDtos({
      itemsResponseXml: xml,
      gln,
      targetMarketCountryCode: tmcc,
    });
    if (dtos.length === 0 && xml.trim().length > 0) {
      logger.warn(
        {
          gln,
          responseXmlChars: xml.length,
          hint:
            'Enable item XML previews with LOG_DATALINK_ITEM_DETAILS=true (optional cap LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS), then inspect logs. Expected `<rows><row>` or `<tradeItem>` with gtin/gln/targetMarketCountryCode (TMCC may use XML attributes). GS1 GTIN lengths must be 8 / 12 / 13 / 14 digits.',
        },
        'sync_no_trade_items_extracted_from_xml',
      );
    }
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
      throw new Error('ProductsRepository missing while DRY_RUN=false and SAVE_PRODUCTS=true');
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
  xmlToJson?: XmlToJsonRepository;
  correlationId: string;
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

  if (!cfg.DRY_RUN && cfg.XML_TO_JSON_SAVE) {
    const parsed = parseDatalinkItemsXmlToJson(res.bodyText);
    const glnD = params.gln.replace(/\D/g, '');
    const gtinD = params.gtin.replace(/\D/g, '');
    const tmccD = params.targetMarketCountryCode.replace(/\D/g, '');
    const itemId = buildGs1ItemId(glnD, gtinD, tmccD);
    const json = cleanJsonForXmlToJsonStorage(parsed, {
      trimStrings: cfg.XMLTOJSON_CLEAN_TRIM_STRINGS,
      dropEmptyStrings: cfg.XMLTOJSON_CLEAN_DROP_EMPTY_STRINGS,
    });
    await persistXmlToJsonSnapshots({
      mongo: params.xmlToJson,
      localDir: cfg.XMLTOJSON_LOCAL_DIR,
      logger,
      metrics,
      rawXml: res.bodyText,
      snapshots: [
        {
          itemId,
          correlationId: params.correlationId,
          gln: glnD,
          gtin: gtinD,
          targetMarketCountryCode: tmccD,
          source: 'fetch_one',
          json,
        },
      ],
      dedupeMode: cfg.XMLTOJSON_DEDUPE_MODE,
    });
  }

  if (!cfg.SAVE_PRODUCTS) {
    logger.info({ gln: params.gln, gtin: params.gtin }, 'fetch_one_products_skipped_save_products_disabled');
    return;
  }

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
    throw new Error('ProductsRepository missing while DRY_RUN=false and SAVE_PRODUCTS=true');
  }

  await params.products.bulkUpsertMappedProducts([mapped]);
  metrics.itemsUpserted += 1;
}
