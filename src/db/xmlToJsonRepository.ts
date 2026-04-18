import type { Collection, Document } from 'mongodb';

export type XmlToJsonSnapshotInput = {
  correlationId: string;
  gln: string;
  targetMarketCountryCode: string;
  updatedSince?: string;
  /** Source of the snapshot for later filtering (`sync_items_export`, `fetch_one`). */
  source: 'sync_items_export' | 'fetch_one';
  /** Exact subtree from {@link parseDatalinkItemsXmlToJson}; do not reshape. */
  json: unknown;
};

export class XmlToJsonRepository {
  constructor(private readonly collection: Collection<Document>) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndexes([
      { key: { gln: 1, createdAt: -1 }, name: 'xmltojson_gln_createdAt' },
      { key: { correlationId: 1 }, name: 'xmltojson_correlationId' },
      { key: { source: 1 }, name: 'xmltojson_source' },
    ]);
  }

  async insertSnapshots(inputs: XmlToJsonSnapshotInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const now = new Date();
    await this.collection.insertMany(
      inputs.map((rec) =>
        ({
          correlationId: rec.correlationId,
          gln: rec.gln,
          targetMarketCountryCode: rec.targetMarketCountryCode,
          updatedSince: rec.updatedSince,
          source: rec.source,
          json: rec.json,
          createdAt: now,
        }) satisfies Document,
      ),
      { ordered: false },
    );
    return inputs.length;
  }
}
