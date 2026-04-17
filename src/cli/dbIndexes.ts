import 'dotenv/config';
import { loadConfig, redactMongoUri } from '../config/env.js';
import { createLogger } from '../observability/createLogger.js';
import { connectMongo } from '../db/mongo.js';
import { ProductsRepository } from '../db/productsRepository.js';
import { SyncStateRepository, type SyncStateRecord } from '../db/syncStateRepository.js';
import { randomUUID } from 'node:crypto';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger({ level: cfg.LOG_LEVEL, correlationId: randomUUID() });
  const client = await connectMongo(cfg, logger);

  try {
    const db = client.db(cfg.MONGODB_DB);
    const products = new ProductsRepository(db.collection(cfg.MONGODB_COLLECTION));
    const syncState = new SyncStateRepository(
      db.collection<SyncStateRecord>(cfg.MONGODB_SYNC_STATE_COLLECTION),
    );
    await products.ensureIndexes();
    await syncState.ensureIndexes();
    logger.info({ mongoUri: redactMongoUri(cfg.MONGODB_URI), db: cfg.MONGODB_DB }, 'indexes_ensured');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
