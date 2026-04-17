import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSuppliersXml } from '../../src/parse/suppliersXml.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('parseSuppliersXml', () => {
  it('parses rows/row with uppercase GLN', async () => {
    const xml = await readFile(join(here, '../fixtures/suppliers-rows.xml'), 'utf8');
    const rows = parseSuppliersXml(xml);
    expect(rows).toEqual([
      {
        gln: '8719046000005',
        itemCount: 0,
      },
    ]);
  });

  it('parses minimal inline XML', () => {
    const xml = `<rows><row><GLN>8719046000005</GLN><itemCount>12</itemCount></row></rows>`;
    expect(parseSuppliersXml(xml)).toEqual([{ gln: '8719046000005', itemCount: 12 }]);
  });
});
