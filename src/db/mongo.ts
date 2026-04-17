import { MongoClient } from 'mongodb';
import type { AppConfig } from '../config/env.js';
import { redactMongoUri } from '../config/env.js';
import type { AppLogger } from '../types/logger.js';

export async function connectMongo(
  cfg: Pick<AppConfig, 'MONGODB_URI'>,
  logger: AppLogger,
): Promise<MongoClient> {
  logger.info({ mongoUri: redactMongoUri(cfg.MONGODB_URI) }, 'mongo_connecting');
  const client = new MongoClient(cfg.MONGODB_URI, { retryWrites: true });
  await client.connect();
  logger.info({}, 'mongo_connected');
  return client;
}
