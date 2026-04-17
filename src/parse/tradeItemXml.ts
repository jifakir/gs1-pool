import { z } from 'zod';
import { createXmlParser } from './xmlParser.js';
import { collectNodesByLocalName, findFirstStringByLocalName } from './jsonWalk.js';

/**
 * Parsed trade item JSON (namespace prefixes removed by the XML parser).
 * This is intentionally permissive; mapping narrows to your Mongo `gs1_info` shape.
 */
export const tradeItemDtoSchema = z
  .object({
    gln: z.string().regex(/^\d+$/),
    gtin: z.string().regex(/^\d{8,14}$/),
    targetMarketCountryCode: z.string().regex(/^\d+$/),
    tradeItemJson: z.unknown(),
  })
  .strict();

export type TradeItemDto = z.infer<typeof tradeItemDtoSchema>;

export function extractTradeItemDtos(params: {
  itemsResponseXml: string;
  gln: string;
  targetMarketCountryCode: string;
}): TradeItemDto[] {
  const parser = createXmlParser();
  const parsed = parser.parse(params.itemsResponseXml) as unknown;
  const objs = collectNodesByLocalName(parsed, 'tradeItem');

  const out: TradeItemDto[] = [];
  for (const obj of objs) {
    const gtin = findFirstStringByLocalName(obj, 'gtin');
    if (!gtin) continue;

    const dto = tradeItemDtoSchema.safeParse({
      gln: params.gln,
      gtin,
      targetMarketCountryCode: params.targetMarketCountryCode,
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
  const objs = collectNodesByLocalName(parsed, 'tradeItem');
  const obj = objs[0] ?? parsed;

  const gtinFromXml = findFirstStringByLocalName(obj, 'gtin');
  const gtin = gtinFromXml ?? params.gtin;

  const dto = tradeItemDtoSchema.safeParse({
    gln: params.gln,
    gtin,
    targetMarketCountryCode: params.targetMarketCountryCode,
    tradeItemJson: obj,
  });

  if (!dto.success) {
    const msg = dto.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid trade item DTO: ${msg}`);
  }
  return dto.data;
}
