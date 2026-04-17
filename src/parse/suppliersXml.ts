import { createXmlParser } from './xmlParser.js';
import { stripNs } from './jsonWalk.js';

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
  const hasGlnKey = keys.includes('gln');

  if (hasGlnKey) {
    out.push(obj);
    return;
  }

  for (const v of Object.values(obj)) {
    walkForSupplierLikeObjects(v, out);
  }
}

export function parseSuppliersXml(xml: string): SupplierRow[] {
  const parser = createXmlParser();
  const parsed = parser.parse(xml) as unknown;
  const candidates: Record<string, unknown>[] = [];
  walkForSupplierLikeObjects(parsed, candidates);

  const rows: SupplierRow[] = [];
  for (const c of candidates) {
    const glnRaw = c.gln ?? Object.entries(c).find(([k]) => stripNs(k) === 'gln')?.[1];
    const itemCountRaw =
      c.itemCount ?? Object.entries(c).find(([k]) => stripNs(k) === 'itemCount')?.[1];

    const gln = typeof glnRaw === 'string' ? glnRaw : typeof glnRaw === 'number' ? String(glnRaw) : undefined;
    if (!gln) continue;

    const itemCount = toNumber(itemCountRaw);
    rows.push({ gln, itemCount });
  }

  const dedup = new Map<string, SupplierRow>();
  for (const r of rows) dedup.set(r.gln, r);
  return [...dedup.values()];
}
