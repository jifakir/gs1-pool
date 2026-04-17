export function stripNs(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? key : key.slice(idx + 1);
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
      if (stripped === localName) {
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
