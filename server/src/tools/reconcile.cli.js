/**
 * Manual stats reconciliation:
 *   node server/src/tools/reconcile.cli.js [hours]
 * Rebuilds stats_hourly from raw clicks/conversions for the last N hours
 * (default 2). Safe to run any time - the hourly cron does the same thing.
 */
import mongoose from 'mongoose';
import { connectDb } from '../db/connect.js';
import { getSettings } from '../services/settings.service.js';
import { reconcileStats } from '../jobs/reconcile.job.js';
import { StatsHourly } from '../models/Stats.js';
import logger from '../utils/logger.js';

const hours = Math.max(1, Number(process.argv[2]) || 2);

const dump = (rows) =>
  rows
    .map(
      (b) =>
        `  ${b.hourBucket.toISOString()}  ${b.country}/${b.device}  clicks=${b.clicks} uniq=${b.uniques} lp=${b.lpClicks} conv=${b.conversions} rev=${b.revenue} cost=${(b.cost || 0).toFixed(2)} bots=${b.bots || 0}`
    )
    .join('\n');

async function main() {
  await connectDb();
  await getSettings({ force: true });

  const before = await StatsHourly.find({}).sort({ hourBucket: 1, country: 1 }).lean();
  console.log(`\nBEFORE (${before.length} buckets)\n${dump(before)}`);

  const result = await reconcileStats({ hours });

  const after = await StatsHourly.find({}).sort({ hourBucket: 1, country: 1 }).lean();
  console.log(`\nAFTER  (${after.length} buckets, ${result.buckets} rebuilt)\n${dump(after)}\n`);

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error('reconcile failed:', err);
  process.exit(1);
});
