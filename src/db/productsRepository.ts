import {
  Long,
  ObjectId,
  type AnyBulkWriteOperation,
  type Collection,
  type Document,
} from 'mongodb';
import type { MappedProductDocument } from '../map/toProductDocument.js';

function toMongoGs1Info(gs1_info: Record<string, unknown>): Record<string, unknown> {
  return {
    ...gs1_info,
    gln: Long.fromString(String(gs1_info.gln)),
    gtin: Long.fromString(String(gs1_info.gtin)),
  };
}

export class ProductsRepository {
  constructor(private readonly collection: Collection<Document>) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndexes([
      {
        key: {
          'gs1_info.gln': 1,
          'gs1_info.gtin': 1,
          'gs1_info.targetMarketCountryCode': 1,
        },
        unique: true,
        name: 'uniq_gs1_identity',
      },
    ]);
  }

  async bulkUpsertMappedProducts(docs: MappedProductDocument[]): Promise<{ matched: number; modified: number; upserted: number }> {
    if (docs.length === 0) return { matched: 0, modified: 0, upserted: 0 };

    const ops: AnyBulkWriteOperation<Document>[] = docs.map((doc) => {
      const gs1_info = toMongoGs1Info(doc.gs1_info);
      const filter = {
        'gs1_info.gln': gs1_info.gln,
        'gs1_info.gtin': gs1_info.gtin,
        'gs1_info.targetMarketCountryCode': doc.gs1_info.targetMarketCountryCode,
      };

      const $set: Record<string, unknown> = {
        name: doc.name,
        provider: doc.provider,
        protien: doc.protien,
        carbs: doc.carbs,
        fat: doc.fat,
        fiber: doc.fiber,
        quantity: doc.quantity,
        calories: doc.calories,
        added_by: new ObjectId(doc.added_by),
        gs1_info,
        isDeleted: doc.isDeleted,
        ingredients: doc.ingredients,
        kenmerken: doc.kenmerken,
        allergie_info: doc.allergie_info,
        __v: doc.__v,
        updatedAt: '$$NOW',
      };

      return {
        updateOne: {
          filter,
          update: [{ $set: $set }, { $set: { createdAt: { $ifNull: ['$createdAt', '$$NOW'] } } }],
          upsert: true,
        },
      } satisfies AnyBulkWriteOperation<Document>;
    });

    const res = await this.collection.bulkWrite(ops, { ordered: false });
    return {
      matched: res.matchedCount,
      modified: res.modifiedCount,
      upserted: res.upsertedCount,
    };
  }
}
