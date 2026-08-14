import config from './config/env.js';
import logger from './utils/logger.js';
import { connectDb } from './db/connect.js';
import { ensureIndexes } from './db/indexes.js';
import { runMigrations } from './db/migrate.js';
import { getSettings } from './services/settings.service.js';
import { initBotFilter } from './services/bot.service.js';
import { refreshCache, startCacheRefresh } from './services/cache.service.js';
import { startCapsRefresh } from './services/caps.service.js';
import { startJobs, isCronLeader } from './jobs/index.js';
import { notifyError } from './services/telegram.service.js';
import { createApp } from './app.js';

async function main() {
  await connectDb();
  await ensureIndexes();
  // Same rule as cron: one instance does the shared work, not every worker
  if (isCronLeader()) await runMigrations();

  const settings = await getSettings({ force: true });
  initBotFilter(settings);

  await refreshCache();
  startCacheRefresh();
  startCapsRefresh();
  startJobs();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`KAP Tracker listening on port ${config.port} (${config.nodeEnv})`);
    logger.info(`Base URL: ${config.baseUrl}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection:', err);
  notifyError(`unhandledRejection: ${err?.message || err}`);
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
  notifyError(`uncaughtException: ${err?.message || err}`);
});

main().catch((err) => {
  logger.error('startup failed:', err);
  process.exit(1);
});
