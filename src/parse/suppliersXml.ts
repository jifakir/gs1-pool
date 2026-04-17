import { createXmlParser } from './xmlParser.js';
import { getFieldCI, stripNs } from './jsonWalk.js';

export type SupplierRow = {
  gln: string;
  itemCount?: number;
};

function asRecord(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  return node as Record<string, unknown>;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function walkForSupplierLikeObjects(node: unknown, out: Record<string, unknown>[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) walkForSupplierLikeObjects(item, out);
    return;
  }
  const obj = asRecord(node);
  if (!obj) return;

  const keys = Object.keys(obj).map(stripNs);
  const hasGlnKey = keys.some((k) => k.toLowerCase() === 'gln');

  if (hasGlnKey) {
    out.push(obj);
    return;
  }

  for (const v of Object.values(obj)) {
    walkForSupplierLikeObjects(v, out);
  }
}

/**
 * Parse Datalink `GET /suppliers` XML, e.g.:
 * `<rows><row><GLN>…</GLN><targetMarketCountryCode>…</targetMarketCountryCode><itemCount>0</itemCount></row></rows>`
 */
export function parseSuppliersXml(xml: string): SupplierRow[] {
  const parser = createXmlParser();
  const parsed = parser.parse(xml) as unknown;
  const candidates: Record<string, unknown>[] = [];
  walkForSupplierLikeObjects(parsed, candidates);

  const rows: SupplierRow[] = [];
  for (const c of candidates) {
    const glnRaw = getFieldCI(c, 'gln');
    const itemCountRaw = getFieldCI(c, 'itemCount');

    const gln = typeof glnRaw === 'string' ? glnRaw : typeof glnRaw === 'number' ? String(glnRaw) : undefined;
    if (!gln) continue;

    const itemCount = toNumber(itemCountRaw);
    rows.push({ gln, itemCount });
  }

  const dedup = new Map<string, SupplierRow>();
  for (const r of rows) dedup.set(r.gln, r);
  return [...dedup.values()];
}
