import type { z } from 'zod';
import { createXmlParser } from './xmlParser.js';
import { isValidGtinDigitLength, tradeItemCoreSchema } from '../schema/gs1Identifiers.js';
import {
  collectNodesByLocalName,
  findFirstStringByLocalName,
  getFieldCI,
  scalarTextFromUnknown,
} from './jsonWalk.js';

/**
 * Parsed trade item JSON (namespace prefixes removed by the XML parser).
 * This is intentionally permissive; mapping narrows to your Mongo `gs1_info` shape.
 */
export const tradeItemDtoSchema = tradeItemCoreSchema;

export type TradeItemDto = z.infer<typeof tradeItemDtoSchema>;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function scalarFromField(obj: Record<string, unknown>, localName: string): string | undefined {
  const raw = getFieldCI(obj, localName);
  return scalarTextFromUnknown(raw);
}

function asRecord(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  return node as Record<string, unknown>;
}

export function extractTradeItemDtos(params: {
  itemsResponseXml: string;
  gln: string;
  targetMarketCountryCode: string;
}): TradeItemDto[] {
  const parser = createXmlParser();
  const parsed = parser.parse(params.itemsResponseXml) as unknown;
  const tradeItems = collectNodesByLocalName(parsed, 'tradeItem');
  const rows = collectNodesByLocalName(parsed, 'row');
  const candidates = [...tradeItems, ...rows];

  const out: TradeItemDto[] = [];
  for (const raw of candidates) {
    const obj = asRecord(raw);
    if (!obj) continue;

    const gtinRaw =
      scalarFromField(obj, 'gtin') ?? findFirstStringByLocalName(obj, 'gtin');
    if (!gtinRaw) continue;
    const gtin = digitsOnly(gtinRaw);
    if (!isValidGtinDigitLength(gtin)) continue;

    const glnRaw = scalarFromField(obj, 'gln') ?? params.gln;
    const gln = digitsOnly(glnRaw);
    if (!gln.length) continue;

    const tmccRaw =
      scalarFromField(obj, 'targetMarketCountryCode') ?? params.targetMarketCountryCode;
    const tmcc = digitsOnly(tmccRaw);
    if (!tmcc.length) continue;

    const dto = tradeItemDtoSchema.safeParse({
      gln,
      gtin,
      targetMarketCountryCode: tmcc,
      tradeItemJson: obj,
    });
    if (!dto.success) continue;
    out.push(dto.data);
  }
  return out;
}

export function parseTradeItemDtoFromItemResponse(params: {
  xml: string;
  gln: string;
  gtin: string;
  targetMarketCountryCode: string;
}): TradeItemDto {
  const parser = createXmlParser();
  const parsed = parser.parse(params.xml) as unknown;
  const rows = collectNodesByLocalName(parsed, 'row');
  const tradeItems = collectNodesByLocalName(parsed, 'tradeItem');
  const obj = asRecord(rows[0]) ?? asRecord(tradeItems[0]) ?? asRecord(parsed);
  if (!obj) {
    throw new Error('Could not resolve trade item or row node in XML');
  }

  const gtinRaw =
    scalarFromField(obj, 'gtin') ?? findFirstStringByLocalName(obj, 'gtin') ?? params.gtin;
  const gtin = digitsOnly(gtinRaw);

  const glnRaw = scalarFromField(obj, 'gln') ?? params.gln;
  const gln = digitsOnly(glnRaw);

  const tmccRaw =
    scalarFromField(obj, 'targetMarketCountryCode') ?? params.targetMarketCountryCode;
  const tmcc = digitsOnly(tmccRaw);

  const dto = tradeItemDtoSchema.safeParse({
    gln,
    gtin,
    targetMarketCountryCode: tmcc,
    tradeItemJson: obj,
  });

  if (!dto.success) {
    const msg = dto.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid trade item DTO: ${msg}`);
  }
  return dto.data;
}
