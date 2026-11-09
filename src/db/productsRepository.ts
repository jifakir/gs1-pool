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

      // Pipeline updates treat strings starting with `$` and `$`-keys as expressions, and reject
      // empty objects; `$literal` stores GS1 text and nested JSON exactly as given.
      const literal = (value: unknown): { $literal: unknown } => ({ $literal: value });
      const $set: Record<string, unknown> = {
        name: literal(doc.name),
        provider: literal(doc.provider),
        protien: literal(doc.protien),
        carbs: literal(doc.carbs),
        fat: literal(doc.fat),
        fiber: literal(doc.fiber),
        unit: literal(doc.unit),
        quantity: literal(doc.quantity),
        calories: literal(doc.calories),
        added_by: literal(new ObjectId(doc.added_by)),
        gs1_info: literal(gs1_info),
        isDeleted: literal(doc.isDeleted),
        ingredients: literal(doc.ingredients),
        kenmerken: literal(doc.kenmerken),
        allergie_info: literal(doc.allergie_info),
        __v: literal(doc.__v),
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
