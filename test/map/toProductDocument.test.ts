import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTradeItemDtos } from '../../src/parse/tradeItemXml.js';
import { mapTradeItemDtoToProductDocument } from '../../src/map/toProductDocument.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('mapTradeItemDtoToProductDocument', () => {
  it('maps nutrients and naming fields', async () => {
    const xml = await readFile(join(here, '../fixtures/minimal-trade-item.xml'), 'utf8');
    const dto = extractTradeItemDtos({
      itemsResponseXml: xml,
      gln: '8719333022925',
      targetMarketCountryCode: '528',
    })[0]!;

    const doc = mapTradeItemDtoToProductDocument(dto, '61210a3c6ea2a51938724bb4');

    expect(doc.name).toBe('Kokosmelk');
    expect(doc.provider).toBe('gs1');
    expect(doc.calories).toBe(164);
    expect(doc.fat).toBe(17);
    expect(doc.protien).toBe(1.2);
    expect(doc.carbs).toBe(1.6);
    expect(doc.quantity).toBe(200);
    expect(doc.gs1_info.targetMarketCountryCode).toBe('528');
    expect(doc.gs1_info.gtin).toBe('08711741355022');
    expect(doc.gs1_info.gln).toBe('8719333022925');
    expect(doc.gs1_info.allergenInfo).toEqual([
      { allergenTypeCode: 'SO', levelOfContainmentCode: 'CONTAINS' },
    ]);
  });
});
