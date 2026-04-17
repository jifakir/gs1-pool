import { describe, expect, it } from 'vitest';
import {
  gs1GlnLikeSchema,
  gs1GtinSchema,
  isValidGtinDigitLength,
  normalizeGs1Digits,
} from '../../src/schema/gs1Identifiers.js';
import { scalarTextFromUnknown } from '../../src/parse/jsonWalk.js';

describe('gs1Identifiers (from Datalink / GDSN log samples)', () => {
  it('normalizes GTINs with leading zeros and non-digits', () => {
    expect(normalizeGs1Digits(' 00000096203439 ')).toBe('00000096203439');
    expect(isValidGtinDigitLength('00000096203439')).toBe(true);
    expect(gs1GtinSchema.parse('00000096203439')).toBe('00000096203439');
  });

  it('rejects non–GS1-length digit runs', () => {
    expect(isValidGtinDigitLength('1234567')).toBe(false);
    expect(isValidGtinDigitLength('12345678901')).toBe(false);
  });

  it('accepts 13-digit GLN from log (e.g. 5038862000024)', () => {
    expect(gs1GlnLikeSchema.parse('5038862000024')).toBe('5038862000024');
  });

  it('reads TMCC from attributed elements like in production XML', () => {
    const attributed = { '#text': '528', '@_codeListVersion': '4' };
    expect(scalarTextFromUnknown(attributed)).toBe('528');
  });
});
