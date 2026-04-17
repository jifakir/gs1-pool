export function stripNs(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? key : key.slice(idx + 1);
}

/** Read child field by local tag name (case-insensitive). GS1 uses mixed casing (`GLN`, `row`, etc.). */
export function getFieldCI(obj: Record<string, unknown>, localName: string): unknown {
  const want = localName.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (stripNs(k).toLowerCase() === want) {
      return v;
    }
  }
  return undefined;
}

/**
 * Plain text from a fast-xml-parser value: strings, numbers, or elements with attributes
 * (`{ "#text": "528", "@_codeListVersion": "4" }`).
 */
export function scalarTextFromUnknown(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length ? t : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = scalarTextFromUnknown(item);
      if (s !== undefined) return s;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('#text' in o) return scalarTextFromUnknown(o['#text']);
  }
  return undefined;
}

export function collectNodesByLocalName(root: unknown, localName: string): unknown[] {
  const out: unknown[] = [];

  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const stripped = stripNs(k);
      if (stripped.toLowerCase() === localName.toLowerCase()) {
        if (Array.isArray(v)) {
          for (const it of v) out.push(it);
        } else {
          out.push(v);
        }
      } else {
        visit(v);
      }
    }
  };

  visit(root);
  return out;
}

export function pickFirstValueByLocalName(root: unknown, localName: string): unknown {
  let best: unknown;

  const visit = (node: unknown): void => {
    if (best !== undefined) return;
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const stripped = stripNs(k);
      if (stripped === localName) {
        best = v;
        return;
      }
    }
    for (const v of Object.values(obj)) visit(v);
  };

  visit(root);
  return best;
}

export function findFirstStringByLocalName(root: unknown, localName: string): string | undefined {
  let best: string | undefined;

  const visit = (node: unknown): void => {
    if (best !== undefined) return;
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const stripped = stripNs(k);
      if (stripped === localName) {
        if (typeof v === 'string' && v.trim()) {
          best = v;
          return;
        }
        if (typeof v === 'number') {
          best = String(v);
          return;
        }
        if (v && typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
          const t = (v as Record<string, unknown>)['#text'];
          if (typeof t === 'string' && t.trim()) {
            best = t;
            return;
          }
          if (typeof t === 'number') {
            best = String(t);
            return;
          }
        }
      } else {
        visit(v);
      }
    }
  };

  visit(root);
  return best;
}
