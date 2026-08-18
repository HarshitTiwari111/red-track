import cron from 'node-cron';
import { reconcileStats } from './reconcile.job.js';
import { cleanupOldClicks } from './cleanup.job.js';
import { checkPostbackFailures, dailySummary } from './alerts.job.js';
import { refreshAllDomainSsl } from '../services/ssl.service.js';
import { verifyPendingDomains } from '../services/dns.service.js';
import { getSettingsSync } from '../services/settings.service.js';
import { telegramEnabled } from '../services/telegram.service.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const tasks = [];

const run = (name, fn) => async () => {
  try {
    await fn();
  } catch (err) {
    logger.error(`cron ${name} failed:`, err.message);
  }
};

/**
 * Only ONE process should run cron jobs. In PM2 cluster mode that is instance 0
 * (NODE_APP_INSTANCE=0); outside PM2 the single process runs them.
 */
export function isCronLeader() {
  const inst = process.env.NODE_APP_INSTANCE ?? process.env.pm_id;
  return inst === undefined || String(inst) === '0';
}

export function startJobs() {
  if (!isCronLeader()) {
    logger.info(`cron: skipped on worker ${process.env.NODE_APP_INSTANCE}`);
    return;
  }
  const tz = getSettingsSync().reportTimezone || 'Asia/Kolkata';

  // Hourly stats reconciliation (5 minutes past each hour)
  tasks.push(cron.schedule('5 * * * *', run('reconcile', () => reconcileStats({ hours: 2 })), { timezone: tz }));

  /*
   * Nightly deep rebuild at 02:40. The hourly pass above can only fix what it
   * can see; anything older stays as it was first written, so a rollup that
   * disagrees with the raw clicks never heals. This walks a wider window and
   * rewrites those buckets from the clicks, which are the record of truth.
   */
  tasks.push(
    cron.schedule(
      '40 2 * * *',
      run('reconcile-deep', () => reconcileStats({ hours: config.reconcileDeepDays * 24 })),
      { timezone: tz }
    )
  );

  // Daily raw-click cleanup at 03:30
  tasks.push(cron.schedule('30 3 * * *', run('cleanup', cleanupOldClicks), { timezone: tz }));

  // Postback failure watchdog every 5 minutes
  tasks.push(cron.schedule('*/5 * * * *', run('postback-watchdog', checkPostbackFailures), { timezone: tz }));

  // Pending tracking domains re-checked every 10 minutes, so a registrar change
  // flips the domain to active on its own instead of waiting on the Verify button
  tasks.push(cron.schedule('*/10 * * * *', run('dns-verify', verifyPendingDomains), { timezone: tz }));

  // Tracking-domain certificate check at 04:10
  tasks.push(cron.schedule('10 4 * * *', run('ssl-check', refreshAllDomainSsl), { timezone: tz }));

  // Daily summary at 09:00
  tasks.push(cron.schedule('0 9 * * *', run('daily-summary', dailySummary), { timezone: tz }));

  logger.info(
    `cron: ${tasks.length} jobs scheduled (tz=${tz}, telegram=${telegramEnabled() ? 'on' : 'off'})`
  );
}

export function stopJobs() {
  tasks.forEach((t) => t.stop());
  tasks.length = 0;
}
