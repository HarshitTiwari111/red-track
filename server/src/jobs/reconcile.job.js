import Click from '../models/Click.js';
import Conversion from '../models/Conversion.js';
import { StatsHourly } from '../models/Stats.js';
import { getSettingsSync } from '../services/settings.service.js';
import { localHourBucket, localToUtc } from '../utils/time.js';
import logger from '../utils/logger.js';

const bucketExpr = (field, tz) => ({
  $dateToString: { format: '%Y-%m-%dT%H:00:00.000Z', date: field, timezone: tz },
});

/**
 * Self-healing rebuild of stats_hourly from raw data. Any $inc lost to a crashed
 * write or a race is corrected here. Default window: the last 2 hours.
 *
 * The window is snapped back to the start of a whole local hour, because a bucket
 * must be recomputed from ALL of its clicks - starting mid-hour would rewrite that
 * hour using only part of its traffic.
 *
 * Buckets in the window with no surviving raw data are deleted, so the window is
 * capped to the retention period: past that cutoff the clicks are gone and the
 * rollups are the only remaining record of them. A day of margin covers a cleanup
 * run that lands while this one is working.
 */
export async function reconcileStats({ hours = 2 } = {}) {
  const settings = getSettingsSync();
  const tz = settings.reportTimezone || 'Asia/Kolkata';

  const retentionHours = Math.max(1, (Number(settings.rawClickRetentionDays) || 90) - 1) * 24;
  const asked = Math.max(1, Number(hours) || 2);
  const window = Math.min(asked, retentionHours);
  if (window < asked) {
    logger.info(`reconcile: window trimmed ${asked}h -> ${window}h, to stay inside click retention`);
  }

  const end = new Date();
  const startBucket = localHourBucket(new Date(end.getTime() - window * 3600 * 1000), tz);
  const start = localToUtc(startBucket, tz);

  const clickAgg = await Click.aggregate([
    { $match: { ts: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          campaignId: '$campaignId',
          bucket: bucketExpr('$ts', tz),
          country: { $ifNull: ['$geo.country', 'XX'] },
          device: { $ifNull: ['$uaParsed.device', 'unknown'] },
        },
        clicks: { $sum: { $cond: [{ $eq: ['$botFlag', true] }, 0, 1] } },
        bots: { $sum: { $cond: [{ $eq: ['$botFlag', true] }, 1, 0] } },
        uniques: {
          $sum: { $cond: [{ $and: [{ $ne: ['$botFlag', true] }, '$isUnique'] }, 1, 0] },
        },
        lpViews: {
          $sum: {
            $cond: [{ $and: [{ $ne: ['$botFlag', true] }, { $ifNull: ['$landerId', false] }] }, 1, 0],
          },
        },
        lpClicks: {
          $sum: { $cond: [{ $and: [{ $ne: ['$botFlag', true] }, '$lpClick'] }, 1, 0] },
        },
        cost: { $sum: { $cond: [{ $eq: ['$botFlag', true] }, 0, { $ifNull: ['$cost', 0] }] } },
      },
    },
  ]).allowDiskUse(true);

  const convAgg = await Conversion.aggregate([
    { $match: { clickTs: { $gte: start, $lte: end }, status: { $ne: 'rejected' } } },
    {
      $group: {
        _id: {
          campaignId: '$campaignId',
          bucket: bucketExpr('$clickTs', tz),
          country: { $ifNull: ['$country', 'XX'] },
          device: { $ifNull: ['$device', 'unknown'] },
        },
        conversions: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$payout', 0] } },
      },
    },
  ]).allowDiskUse(true);

  const merged = new Map();
  const keyOf = (id) => `${id.campaignId}|${id.bucket}|${id.country}|${id.device}`;

  for (const r of clickAgg) {
    merged.set(keyOf(r._id), {
      id: r._id,
      clicks: r.clicks || 0,
      bots: r.bots || 0,
      uniques: r.uniques || 0,
      lpViews: r.lpViews || 0,
      lpClicks: r.lpClicks || 0,
      cost: r.cost || 0,
      conversions: 0,
      revenue: 0,
    });
  }
  for (const r of convAgg) {
    const k = keyOf(r._id);
    const row = merged.get(k) || {
      id: r._id,
      clicks: 0,
      bots: 0,
      uniques: 0,
      lpViews: 0,
      lpClicks: 0,
      cost: 0,
      conversions: 0,
      revenue: 0,
    };
    row.conversions = r.conversions || 0;
    row.revenue = r.revenue || 0;
    merged.set(k, row);
  }

  // Buckets whose raw data disappeared (deleted clicks/conversions) can never be
  // corrected by the upserts below, because nothing generates a key for them.
  // Drop them explicitly, otherwise the old counters live on forever.
  const existing = await StatsHourly.find(
    { hourBucket: { $gte: startBucket } },
    { _id: 1, campaignId: 1, hourBucket: 1, country: 1, device: 1 }
  ).lean();

  const stale = existing.filter(
    (b) => !merged.has(`${b.campaignId}|${b.hourBucket.toISOString()}|${b.country}|${b.device}`)
  );
  if (stale.length) {
    await StatsHourly.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    logger.info(`reconcile: dropped ${stale.length} orphaned hourly buckets`);
  }

  if (merged.size === 0) return { buckets: 0, dropped: stale.length };

  const ops = [...merged.values()].map((row) => ({
    updateOne: {
      filter: {
        campaignId: row.id.campaignId,
        hourBucket: new Date(row.id.bucket),
        country: row.id.country,
        device: row.id.device,
      },
      update: {
        $set: {
          clicks: row.clicks,
          bots: row.bots,
          uniques: row.uniques,
          lpViews: row.lpViews,
          lpClicks: row.lpClicks,
          cost: row.cost,
          conversions: row.conversions,
          revenue: row.revenue,
        },
      },
      upsert: true,
    },
  }));

  await StatsHourly.bulkWrite(ops, { ordered: false });
  logger.info(`reconcile: rebuilt ${ops.length} hourly buckets (last ${window}h)`);
  return { buckets: ops.length, dropped: stale.length };
}

export default reconcileStats;
