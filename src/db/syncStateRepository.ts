import type { Collection, Filter } from 'mongodb';

export type SyncStateRecord = {
  _id: string;
  gln: string;
  targetMarketCountryCode: string;
  updatedSince: string;
  updatedAt: Date;
};

export class SyncStateRepository {
  constructor(private readonly collection: Collection<SyncStateRecord>) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndexes([
      {
        key: { gln: 1, targetMarketCountryCode: 1 },
        unique: true,
        name: 'uniq_gln_tmcc',
      },
    ]);
  }

  private key(gln: string, tmcc: string): string {
    return `${gln}_${tmcc}`;
  }

  async getUpdatedSince(gln: string, targetMarketCountryCode: string): Promise<string | undefined> {
    const doc = await this.collection.findOne({
      _id: this.key(gln, targetMarketCountryCode),
    } as Filter<SyncStateRecord>);
    return doc?.updatedSince;
  }

  async putUpdatedSince(gln: string, targetMarketCountryCode: string, updatedSince: string): Promise<void> {
    const now = new Date();
    await this.collection.updateOne(
      { _id: this.key(gln, targetMarketCountryCode) } as Filter<SyncStateRecord>,
      {
        $set: {
          gln,
          targetMarketCountryCode,
          updatedSince,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }
}
