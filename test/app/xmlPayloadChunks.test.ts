import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunksForXmlToJsonStorage } from '../../src/app/xmlPayloadChunks.js';
import { parseDatalinkItemsXmlToJson } from '../../src/parse/datalinkItemsXmlToJson.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('chunksForXmlToJsonStorage', () => {
  it('returns one subtree per row without trimming keys', async () => {
    const xml = await readFile(join(here, '../fixtures/items-rows-datalink.xml'), 'utf8');
    const parsed = parseDatalinkItemsXmlToJson(xml);
    const chunks = chunksForXmlToJsonStorage(parsed);
    expect(chunks.length).toBe(1);
    const first = chunks[0] as Record<string, unknown>;
    expect(first.tradeItemProperties).toBeDefined();
  });

  it('falls back to full tree when no row/tradeItem nodes', () => {
    const parsed = parseDatalinkItemsXmlToJson('<?xml version="1.0"?><catalog><meta>a</meta></catalog>');
    const chunks = chunksForXmlToJsonStorage(parsed);
    expect(chunks).toEqual([parsed]);
  });

  it('chunks each tradeItem when present under a wrapper root', async () => {
    const xml = await readFile(join(here, '../fixtures/minimal-trade-item.xml'), 'utf8');
    const parsed = parseDatalinkItemsXmlToJson(xml);
    const chunks = chunksForXmlToJsonStorage(parsed);
    expect(chunks.length).toBe(1);
    const first = chunks[0] as Record<string, unknown>;
    expect(typeof first.gtin).toBe('string');
  });
});
