import { randomBytes } from 'node:crypto';
import { access, constants, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { XmlToJsonRepository, XmlToJsonSnapshotInput } from '../db/xmlToJsonRepository.js';
import type { SyncMetrics } from '../observability/metrics.js';
import type { AppLogger } from '../types/logger.js';

/** MongoDB BSON document limit is 16 MiB; stay below for inserts. */
export const BSON_SAFE_DOCUMENT_BYTES = 15 * 1024 * 1024;

function resolveLocalStorageDir(localDir: string): string {
  return isAbsolute(localDir) ? localDir : resolve(process.cwd(), localDir);
}

function safeItemIdPathSegment(itemId: string): string {
  return itemId.replace(/:/g, '_').replace(/[^\w.-]+/g, '_').slice(0, 200);
}

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 120);
}

function artifactBaseName(meta: XmlToJsonSnapshotInput): string {
  const ts = Date.now();
  const rand = randomBytes(4).toString('hex');
  return sanitizeFilenamePart(`${meta.correlationId.slice(0, 8)}_${meta.gln}_${meta.source}_${ts}_${rand}`);
}

function localItemJsonPath(baseDir: string, itemId: string): string {
  return join(baseDir, 'by-item', `${safeItemIdPathSegment(itemId)}.json`);
}

async function writeLocalJsonByItem(baseDir: string, doc: Record<string, unknown>, itemId: string): Promise<{ path: string }> {
  const fullPath = localItemJsonPath(baseDir, itemId);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(doc, null, 2), 'utf8');
  return { path: fullPath };
}

async function writeLocalXmlFallback(baseDir: string, rawXml: string, meta: XmlToJsonSnapshotInput): Promise<{ path: string }> {
  const day = new Date().toISOString().slice(0, 10);
  const base = artifactBaseName(meta);
  const relPath = join(day, `${base}.xml`);
  const fullPath = join(baseDir, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, rawXml, 'utf8');
  return { path: fullPath };
}

/**
 * Writes each snapshot to Mongo when possible; otherwise under `localDir/by-item/{itemId}.json`.
 * Respects dedupe mode for both stores.
 */
export async function persistXmlToJsonSnapshots(params: {
  mongo?: XmlToJsonRepository;
  localDir: string;
  logger: AppLogger;
  metrics: SyncMetrics;
  rawXml: string;
  snapshots: XmlToJsonSnapshotInput[];
  dedupeMode: 'skip' | 'replace';
}): Promise<void> {
  const { snapshots, mongo, localDir, logger, metrics, rawXml, dedupeMode } = params;
  if (snapshots.length === 0) return;

  const baseDir = resolveLocalStorageDir(localDir);

  for (const snap of snapshots) {
    const createdAt = new Date();
    const mongoDoc = {
      itemId: snap.itemId,
      correlationId: snap.correlationId,
      gln: snap.gln,
      gtin: snap.gtin,
      targetMarketCountryCode: snap.targetMarketCountryCode,
      updatedSince: snap.updatedSince,
      source: snap.source,
      json: snap.json,
      createdAt,
    };

    let approxBytes = 0;
    try {
      approxBytes = Buffer.byteLength(JSON.stringify(mongoDoc), 'utf8');
    } catch (err) {
      logger.warn({ itemId: snap.itemId, err }, 'xml_to_json_snapshot_not_serializable_fallback_xml');
      try {
        const { path } = await writeLocalXmlFallback(baseDir, rawXml, snap);
        metrics.itemsXmlToJsonLocalXml += 1;
        logger.info({ itemId: snap.itemId, path }, 'xml_to_json_saved_locally_xml');
      } catch (err2) {
        logger.error({ itemId: snap.itemId, err: err2 }, 'xml_to_json_local_xml_write_failed');
      }
      continue;
    }

    let wroteMongo = false;
    if (mongo && approxBytes <= BSON_SAFE_DOCUMENT_BYTES) {
      try {
        const inserted = await mongo.upsertSnapshot(snap, dedupeMode);
        if (!inserted) {
          metrics.itemsXmlToJsonDuplicatesSkipped += 1;
          logger.debug({ itemId: snap.itemId }, 'xml_to_json_duplicate_skipped');
          continue;
        }
        metrics.itemsXmlToJsonSaved += 1;
        wroteMongo = true;
      } catch (err) {
        logger.warn({ itemId: snap.itemId, err }, 'xml_to_json_mongo_failed_fallback_local');
      }
    } else if (mongo && approxBytes > BSON_SAFE_DOCUMENT_BYTES) {
      logger.warn(
        { itemId: snap.itemId, approxBytes, limit: BSON_SAFE_DOCUMENT_BYTES },
        'xml_to_json_snapshot_exceeds_bson_limit_using_local_fallback',
      );
    }

    if (wroteMongo) continue;

    const itemPath = localItemJsonPath(baseDir, snap.itemId);
    if (dedupeMode === 'skip') {
      try {
        await access(itemPath, constants.F_OK);
        metrics.itemsXmlToJsonDuplicatesSkipped += 1;
        logger.debug({ itemId: snap.itemId, path: itemPath }, 'xml_to_json_local_duplicate_skipped');
        continue;
      } catch {
        /* file absent */
      }
    }

    try {
      const { path } = await writeLocalJsonByItem(baseDir, mongoDoc as Record<string, unknown>, snap.itemId);
      metrics.itemsXmlToJsonLocalJson += 1;
      logger.info({ itemId: snap.itemId, path }, 'xml_to_json_saved_locally_json');
    } catch (err) {
      logger.warn({ itemId: snap.itemId, err }, 'xml_to_json_local_json_write_failed_fallback_xml');
      try {
        const { path } = await writeLocalXmlFallback(baseDir, rawXml, snap);
        metrics.itemsXmlToJsonLocalXml += 1;
        logger.info({ itemId: snap.itemId, path }, 'xml_to_json_saved_locally_xml');
      } catch (err2) {
        logger.error({ itemId: snap.itemId, err: err2 }, 'xml_to_json_local_xml_write_failed');
      }
    }
  }
}
