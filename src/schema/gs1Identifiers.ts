import { z } from 'zod';

/**
 * Canonical digit-only normalization for GS1 identifiers in XML/JSON strings
 * (whitespace, leading zeros preserved in the digit string).
 */
export function normalizeGs1Digits(input: string): string {
  return input.replace(/\D/g, '');
}

/** GTIN-8 / GTIN-12 / GTIN-13 / GTIN-14 (GS1 General Specifications). */
export const GS1_GTIN_DIGIT_LENGTHS = [8, 12, 13, 14] as const;
const GTIN_LENGTHS = new Set<number>(GS1_GTIN_DIGIT_LENGTHS);

export function isValidGtinDigitLength(digits: string): boolean {
  return GTIN_LENGTHS.has(digits.length);
}

export const gs1GtinSchema = z
  .string()
  .transform(normalizeGs1Digits)
  .refine((s) => isValidGtinDigitLength(s), {
    message: 'GTIN must be 8, 12, 13, or 14 digits',
  });

/**
 * GLN is 13 digits in GDSN; upstream may omit leading zeros—allow 7–13 digit forms
 * after stripping non-digits (validation only; callers may left-pad for storage).
 */
export const gs1GlnLikeSchema = z
  .string()
  .transform(normalizeGs1Digits)
  .refine((s) => s.length >= 7 && s.length <= 13, {
    message: 'GLN-like location id expected 7–13 digits',
  });

/** ISO 3166 numeric / GDSN target market country code (typically 3 digits). */
export const gs1TargetMarketCountryCodeSchema = z
  .string()
  .transform(normalizeGs1Digits)
  .refine((s) => s.length >= 1 && s.length <= 3, {
    message: 'target market country code expected 1–3 digits',
  });

export const tradeItemCoreSchema = z
  .object({
    gln: gs1GlnLikeSchema,
    gtin: gs1GtinSchema,
    targetMarketCountryCode: gs1TargetMarketCountryCodeSchema,
    tradeItemJson: z.unknown(),
  })
  .strict();
