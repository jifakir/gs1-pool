import { describe, expect, it } from 'vitest';
import { cleanJsonForXmlToJsonStorage } from '../../src/parse/cleanJsonForXmlToJsonStorage.js';

describe('cleanJsonForXmlToJsonStorage', () => {
  it('trims string leaves when enabled', () => {
    expect(
      cleanJsonForXmlToJsonStorage({ a: '  x  ', nested: { b: ' y ' } }, { trimStrings: true, dropEmptyStrings: false }),
    ).toEqual({ a: 'x', nested: { b: 'y' } });
  });

  it('is a no-op when all cleaning flags are off', () => {
    const v = { a: '  x  ' };
    expect(cleanJsonForXmlToJsonStorage(v, { trimStrings: false, dropEmptyStrings: false })).toEqual(v);
  });
});
