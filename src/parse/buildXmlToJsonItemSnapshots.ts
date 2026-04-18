import type { XmlToJsonSnapshotInput } from '../db/xmlToJsonRepository.js';
import { cleanJsonForXmlToJsonStorage, type CleanJsonForStorageOptions } from './cleanJsonForXmlToJsonStorage.js';
import {
  collectNodesByLocalName,
  findFirstStringByLocalName,
  getFieldCI,
  scalarTextFromUnknown,
} from './jsonWalk.js';

/** Stable id for dedupe: digits-only GLN, GTIN, TMCC joined by `:`. */
export function buildGs1ItemId(glnDigits: string, gtinDigits: string, tmccDigits: string): string {
  return `${glnDigits}:${gtinDigits}:${tmccDigits}`;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function asRecord(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  return node as Record<string, unknown>;
}

export type BuildXmlToJsonItemSnapshotsParams = {
  parsed: unknown;
  correlationId: string;
  glnContext: string;
  tmccContext: string;
  updatedSince?: string;
  source: XmlToJsonSnapshotInput['source'];
  clean: CleanJsonForStorageOptions;
};

/**
 * One snapshot per `<row>` / `<tradeItem>` when present; otherwise one snapshot for the whole tree.
 * Computes `itemId` from GLN + GTIN + TMCC when those can be resolved.
 */
export function buildXmlToJsonItemSnapshots(params: BuildXmlToJsonItemSnapshotsParams): XmlToJsonSnapshotInput[] {
  const rows = collectNodesByLocalName(params.parsed, 'row');
  const tradeItems = collectNodesByLocalName(params.parsed, 'tradeItem');
  const chunks =
    rows.length > 0 ? rows : tradeItems.length > 0 ? tradeItems : [params.parsed];

  const out: XmlToJsonSnapshotInput[] = [];
  let fallbackIdx = 0;

  for (const chunk of chunks) {
    const obj = asRecord(chunk) ?? {};
    const glnDigits = digitsOnly(
      scalarTextFromUnknown(getFieldCI(obj, 'gln')) ?? params.glnContext,
    );
    const gtinRaw =
      scalarTextFromUnknown(getFieldCI(obj, 'gtin')) ?? findFirstStringByLocalName(obj, 'gtin') ?? '';
    const gtinDigits = digitsOnly(typeof gtinRaw === 'string' ? gtinRaw : String(gtinRaw));
    const tmccDigits = digitsOnly(
      scalarTextFromUnknown(getFieldCI(obj, 'targetMarketCountryCode')) ?? params.tmccContext,
    );

    let itemId: string;
    if (glnDigits.length > 0 && gtinDigits.length >= 8 && gtinDigits.length <= 14 && tmccDigits.length > 0) {
      itemId = buildGs1ItemId(glnDigits, gtinDigits, tmccDigits);
    } else {
      itemId = `unresolved:${params.correlationId}:${params.source}:${fallbackIdx}:${digitsOnly(params.glnContext)}`;
      fallbackIdx += 1;
    }

    const json = cleanJsonForXmlToJsonStorage(chunk, params.clean);

    out.push({
      itemId,
      correlationId: params.correlationId,
      gln: glnDigits || digitsOnly(params.glnContext),
      gtin: gtinDigits.length >= 8 ? gtinDigits : undefined,
      targetMarketCountryCode: tmccDigits || digitsOnly(params.tmccContext),
      updatedSince: params.updatedSince,
      source: params.source,
      json,
    });
  }

  return out;
}
