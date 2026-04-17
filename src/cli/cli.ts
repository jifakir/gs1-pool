#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { loadConfig, redactMongoUri } from '../config/env.js';
import { DatalinkClient } from '../datalink/datalinkClient.js';
import { connectMongo } from '../db/mongo.js';
import { ProductsRepository } from '../db/productsRepository.js';
import { SyncStateRepository, type SyncStateRecord } from '../db/syncStateRepository.js';
import { createLogger } from '../observability/createLogger.js';
import { SyncMetrics } from '../observability/metrics.js';
import { runFetchOneJob, runSyncJob } from '../app/syncOrchestrator.js';

function mergeConfig(
  base: ReturnType<typeof loadConfig>,
  overrides: { dryRun?: boolean; logLevel?: string },
): ReturnType<typeof loadConfig> {
  return {
    ...base,
    DRY_RUN: overrides.dryRun ?? base.DRY_RUN,
    LOG_LEVEL: (overrides.logLevel ?? base.LOG_LEVEL) as ReturnType<typeof loadConfig>['LOG_LEVEL'],
  };
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('gs1-pool').description('GS1 Nederland Datalink → MongoDB sync');

  program
    .command('sync')
    .option('--dry-run', 'Do not write to Mongo; print a sample payload', false)
    .option('--verbose', 'Shortcut for --log-level debug', false)
    .option('--log-level <level>', 'fatal|error|warn|info|debug|trace|silent')
    .option('--max-suppliers <n>', 'Limit suppliers for testing', (v) => Number.parseInt(v, 10))
    .option('--max-items <n>', 'Limit mapped items per supplier for testing', (v) => Number.parseInt(v, 10))
    .option('--gln <gln>', 'Only sync a single supplier GLN')
    .action(
      async (opts: {
        dryRun?: boolean;
        verbose?: boolean;
        logLevel?: string;
        maxSuppliers?: number;
        maxItems?: number;
        gln?: string;
      }) => {
        const base = loadConfig();
        const cfg = mergeConfig(base, {
          dryRun: Boolean(opts.dryRun),
          logLevel: opts.verbose ? 'debug' : opts.logLevel,
        });

        const correlationId = randomUUID();
        const logger = createLogger({ level: cfg.LOG_LEVEL, correlationId });
        const metrics = new SyncMetrics();

        logger.info(
          {
            dryRun: cfg.DRY_RUN,
            mongo: cfg.DRY_RUN ? undefined : redactMongoUri(cfg.MONGODB_URI),
            datalinkBaseUrl: cfg.DATALINK_BASE_URL,
          },
          'sync_start',
        );

        const api = new DatalinkClient(cfg, logger);

        if (!cfg.DRY_RUN) {
          const client = await connectMongo(cfg, logger);
          try {
            const db = client.db(cfg.MONGODB_DB);
            const products = new ProductsRepository(db.collection(cfg.MONGODB_COLLECTION));
            const syncState = new SyncStateRepository(
              db.collection<SyncStateRecord>(cfg.MONGODB_SYNC_STATE_COLLECTION),
            );

            let shouldStop = false;
            const onSigInt = (): void => {
              shouldStop = true;
              logger.warn({}, 'sigint_received_finishing_current_batch');
            };
            process.on('SIGINT', onSigInt);

            try {
              await runSyncJob({
                cfg,
                logger,
                metrics,
                api,
                products,
                syncState,
                options: {
                  maxSuppliers: opts.maxSuppliers,
                  maxItems: opts.maxItems,
                  gln: opts.gln,
                  shouldStop: () => shouldStop,
                },
              });
            } finally {
              process.off('SIGINT', onSigInt);
            }
          } finally {
            await client.close();
          }
        } else {
          await runSyncJob({
            cfg,
            logger,
            metrics,
            api,
            options: {
              maxSuppliers: opts.maxSuppliers,
              maxItems: opts.maxItems,
              gln: opts.gln,
            },
          });
        }

        logger.info(metrics.snapshot(), 'sync_done');
      },
    );

  program
    .command('fetch-one')
    .requiredOption('--gln <gln>', 'Supplier GLN')
    .requiredOption('--gtin <gtin>', 'GTIN')
    .requiredOption('--tmcc <tmcc>', 'Target market country code')
    .option('--dry-run', 'Do not write to Mongo; print mapped JSON', false)
    .option('--verbose', 'Shortcut for --log-level debug', false)
    .option('--log-level <level>', 'fatal|error|warn|info|debug|trace|silent')
    .action(
      async (opts: {
        gln: string;
        gtin: string;
        tmcc: string;
        dryRun?: boolean;
        verbose?: boolean;
        logLevel?: string;
      }) => {
        const base = loadConfig();
        const cfg = mergeConfig(base, {
          dryRun: Boolean(opts.dryRun),
          logLevel: opts.verbose ? 'debug' : opts.logLevel,
        });

        const correlationId = randomUUID();
        const logger = createLogger({ level: cfg.LOG_LEVEL, correlationId });
        const metrics = new SyncMetrics();

        const api = new DatalinkClient(cfg, logger);

        if (!cfg.DRY_RUN) {
          const client = await connectMongo(cfg, logger);
          try {
            const db = client.db(cfg.MONGODB_DB);
            const products = new ProductsRepository(db.collection(cfg.MONGODB_COLLECTION));
            await runFetchOneJob({
              cfg,
              logger,
              metrics,
              api,
              products,
              gln: opts.gln,
              gtin: opts.gtin,
              targetMarketCountryCode: opts.tmcc,
            });
          } finally {
            await client.close();
          }
        } else {
          await runFetchOneJob({
            cfg,
            logger,
            metrics,
            api,
            gln: opts.gln,
            gtin: opts.gtin,
            targetMarketCountryCode: opts.tmcc,
          });
        }

        logger.info(metrics.snapshot(), 'fetch_one_done');
      },
    );

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
