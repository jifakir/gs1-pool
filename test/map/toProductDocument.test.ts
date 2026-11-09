import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTradeItemDtos } from '../../src/parse/tradeItemXml.js';
import {
  mapTradeItemDtoToProductDocument,
  parseIngredientStatement,
} from '../../src/map/toProductDocument.js';

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
    // Macros are per the nutrient basis, so quantity is the basis (100), not the pack size.
    expect(doc.quantity).toBe(100);
    expect(doc.gs1_info.targetMarketCountryCode).toBe('528');
    expect(doc.gs1_info.gtin).toBe('08711741355022');
    expect(doc.gs1_info.gln).toBe('8719333022925');
    expect(doc.gs1_info.allergenInfo).toEqual([
      { allergenTypeCode: 'SO', levelOfContainmentCode: 'CONTAINS' },
    ]);
  });

  it('fills app fields from the real Datalink shape (attributes, languages, two nutrient tables)', async () => {
    const xml = await readFile(join(here, '../fixtures/real-shape-trade-item.xml'), 'utf8');
    const dto = extractTradeItemDtos({
      itemsResponseXml: xml,
      gln: '8711578000003',
      targetMarketCountryCode: '528',
    })[0]!;

    const doc = mapTradeItemDtoToProductDocument(dto, '61210a3c6ea2a51938724bb4');

    expect(doc.name).toBe('Sojadrank 1L');
    // Per-100 ml table wins over the per-portion one.
    expect(doc.calories).toBe(16);
    expect(doc.fat).toBe(0.3);
    expect(doc.carbs).toBe(1);
    expect(doc.fiber).toBe(0.5);
    expect(doc.protien).toBe(1.5);
    expect(doc.quantity).toBe(100);
    expect(doc.unit).toBe('ml');

    expect(doc.ingredients).toEqual([
      { name: 'water', amount: '' },
      { name: 'TARWEbloem', amount: '45%' },
      { name: 'suiker', amount: '12,5%' },
      { name: 'sojasaus (water, SOJAbonen)', amount: '' },
      { name: 'zout', amount: '' },
    ]);
    expect(doc.allergie_info).toEqual([
      { name: 'Tarwe', value: 'Bevat' },
      { name: 'Soja', value: 'Bevat' },
    ]);
    expect(doc.kenmerken).toEqual([
      { icon: 'biologisch', kmName: 'Biologisch' },
      { icon: 'vegan', kmName: 'Vegan' },
      { icon: 'caloriearm', kmName: 'Caloriearm' },
    ]);

    const info = doc.gs1_info;
    expect(info.ingredientStatement).toMatch(/^Ingrediënten: water/);
    expect(info.productImage).toBe('https://example.test/08711578582974_C1N1.tif');
    expect(info.brandName).toBe('Testmerk');
    expect(info.netContent).toEqual([{ value: '1000', measurementUnitCode: 'MLT' }]);
    // Shape the admin panel reads: energy as [kJ, kcal], others as { value }.
    const detail = (info.ingredientDetail as { nutrientDetail: { nutrientTypeCode: string; quantityContained: unknown }[] })
      .nutrientDetail;
    expect(detail.find((d) => d.nutrientTypeCode === 'ENER-')?.quantityContained).toEqual([
      { value: '67', measurementUnitCode: 'KJO' },
      { value: '16', measurementUnitCode: 'E14' },
    ]);
    expect(detail.find((d) => d.nutrientTypeCode === 'PRO-')?.quantityContained).toEqual({
      value: '1.5',
      measurementUnitCode: 'GRM',
    });
  });
});

describe('parseIngredientStatement', () => {
  it('drops the trace note after a dash', () => {
    expect(
      parseIngredientStatement('Ingrediënten: Deegwaren van griesmeel van harde TARWE - kan SOJA en MOSTERD bevatten'),
    ).toEqual([{ name: 'Deegwaren van griesmeel van harde TARWE', amount: '' }]);
  });

  it('returns an empty list for missing text', () => {
    expect(parseIngredientStatement(undefined)).toEqual([]);
  });
});
