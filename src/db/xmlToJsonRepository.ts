import type { Collection, Document } from 'mongodb';

export type XmlToJsonSnapshotInput = {
  /** Dedupe key: typically `glnDigits:gtinDigits:tmccDigits` from GS1 identifiers. */
  itemId: string;
  correlationId: string;
  gln: string;
  gtin?: string;
  targetMarketCountryCode: string;
  updatedSince?: string;
  source: 'sync_items_export' | 'fetch_one';
  /** Cleaned subtree for this item (or full tree when no row/tradeItem split). */
  json: unknown;
};

export class XmlToJsonRepository {
  constructor(private readonly collection: Collection<Document>) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndexes([
      { key: { itemId: 1 }, unique: true, name: 'xmltojson_itemId_unique' },
      { key: { gln: 1, createdAt: -1 }, name: 'xmltojson_gln_createdAt' },
      { key: { correlationId: 1 }, name: 'xmltojson_correlationId' },
      { key: { source: 1 }, name: 'xmltojson_source' },
    ]);
  }

  /**
   * @param mode `skip` — do nothing if `itemId` exists; `replace` — replace existing document.
   * @returns whether a document was written (`false` when skipped as duplicate in `skip` mode).
   */
  async upsertSnapshot(rec: XmlToJsonSnapshotInput, mode: 'skip' | 'replace'): Promise<boolean> {
    const now = new Date();
    const doc = {
      itemId: rec.itemId,
      correlationId: rec.correlationId,
      gln: rec.gln,
      gtin: rec.gtin,
      targetMarketCountryCode: rec.targetMarketCountryCode,
      updatedSince: rec.updatedSince,
      source: rec.source,
      json: rec.json,
      createdAt: now,
    } satisfies Document;

    if (mode === 'skip') {
      const hit = await this.collection.findOne({ itemId: rec.itemId }, { projection: { _id: 1 } });
      if (hit) return false;
      await this.collection.insertOne(doc);
      return true;
    }

    await this.collection.replaceOne({ itemId: rec.itemId }, doc, { upsert: true });
    return true;
  }
}
