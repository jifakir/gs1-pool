import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTradeItemDtos } from '../../src/parse/tradeItemXml.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('extractTradeItemDtos', () => {
  it('extracts at least one dto from a minimal fixture', async () => {
    const xml = await readFile(join(here, '../fixtures/minimal-trade-item.xml'), 'utf8');
    const dtos = extractTradeItemDtos({
      itemsResponseXml: xml,
      gln: '8719333022925',
      targetMarketCountryCode: '528',
    });
    expect(dtos.length).toBeGreaterThan(0);
    expect(dtos[0]?.gtin).toBeTruthy();
  });

  it('extracts dtos from Datalink `<rows><row>` items response shape', async () => {
    const xml = await readFile(join(here, '../fixtures/items-rows-datalink.xml'), 'utf8');
    const dtos = extractTradeItemDtos({
      itemsResponseXml: xml,
      gln: '5000453000003',
      targetMarketCountryCode: '528',
    });
    expect(dtos).toHaveLength(1);
    expect(dtos[0]?.gln).toBe('5000453000003');
    expect(dtos[0]?.gtin).toBe('08719587049242');
    expect(dtos[0]?.targetMarketCountryCode).toBe('528');
  });
});
