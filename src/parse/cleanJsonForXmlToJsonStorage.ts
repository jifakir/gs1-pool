/**
 * Optional readability pass for JSON stored in xmltojson only (does not change semantic content:
 * trims incidental outer whitespace on strings; does not collapse internal spaces in free text).
 */
export type CleanJsonForStorageOptions = {
  trimStrings: boolean;
  /** Remove string keys whose value is "" after trim (objects only). */
  dropEmptyStrings: boolean;
};

export function cleanJsonForXmlToJsonStorage(
  value: unknown,
  opts: CleanJsonForStorageOptions,
): unknown {
  if (!opts.trimStrings && !opts.dropEmptyStrings) {
    return value;
  }
  return cleanValue(value, opts);
}

function cleanValue(value: unknown, opts: CleanJsonForStorageOptions): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const t = opts.trimStrings ? value.trim() : value;
    if (opts.dropEmptyStrings && t === '') return undefined;
    return t;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const next = value.map((x) => cleanValue(x, opts)).filter((x) => x !== undefined);
    return next;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const cv = cleanValue(v, opts);
      if (cv === undefined && opts.dropEmptyStrings) continue;
      out[k] = cv;
    }
    return out;
  }
  return value;
}
