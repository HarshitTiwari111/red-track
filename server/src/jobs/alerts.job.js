import { PostbackLog } from '../models/Logs.js';
import { StatsHourly } from '../models/Stats.js';
import { sendTelegram } from '../services/telegram.service.js';
import { getSettingsSync } from '../services/settings.service.js';
import { localDayKey, localToUtc } from '../utils/time.js';
import logger from '../utils/logger.js';

const FAILURE_THRESHOLD = 10;

/** Alert when postbacks start failing in bulk (>10 failures in 5 minutes). */
export async function checkPostbackFailures() {
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const failures = await PostbackLog.countDocuments({ ts: { $gte: since }, ok: false });
  if (failures > FAILURE_THRESHOLD) {
    const recent = await PostbackLog.find({ ts: { $gte: since }, ok: false })
      .sort({ ts: -1 })
      .limit(3)
      .lean();
    const reasons = [...new Set(recent.map((r) => r.reason))].join(', ');
    await sendTelegram(
      `🚨 <b>Postback failure spike</b>\n${failures} failures in the last 5 minutes.\nRecent reasons: ${reasons || 'n/a'}`,
      { key: 'postback-spike' }
    );
    logger.warn(`postback failure spike: ${failures} in 5 min`);
  }
  return { failures };
}

/** 09:00 report-timezone summary of yesterday. */
export async function dailySummary() {
  const tz = getSettingsSync().reportTimezone || 'Asia/Kolkata';
  const todayKey = localDayKey(new Date(), tz);
  const [y, m, d] = todayKey.split('-').map(Number);
  const startLocal = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0));
  const endLocal = new Date(Date.UTC(y, m - 1, d - 1, 23, 59, 59, 999));

  const [agg] = await StatsHourly.aggregate([
    { $match: { hourBucket: { $gte: startLocal, $lte: endLocal } } },
    {
      $group: {
        _id: null,
        clicks: { $sum: '$clicks' },
        conversions: { $sum: '$conversions' },
        revenue: { $sum: '$revenue' },
        cost: { $sum: '$cost' },
      },
    },
  ]);

  const s = agg || { clicks: 0, conversions: 0, revenue: 0, cost: 0 };
  const profit = (s.revenue || 0) - (s.cost || 0);
  const roi = s.cost ? ((profit / s.cost) * 100).toFixed(1) : '0.0';
  const dayKey = startLocal.toISOString().slice(0, 10);

  await sendTelegram(
    [
      `📊 <b>KAP Tracker - ${dayKey}</b>`,
      `Clicks: <b>${s.clicks || 0}</b>`,
      `Conversions: <b>${s.conversions || 0}</b>`,
      `Revenue: <b>${(s.revenue || 0).toFixed(2)}</b>`,
      `Cost: <b>${(s.cost || 0).toFixed(2)}</b>`,
      `Profit: <b>${profit.toFixed(2)}</b> (ROI ${roi}%)`,
    ].join('\n'),
    { key: 'daily-summary', throttle: false }
  );

  // localToUtc keeps the cron's local-hour intent honest across DST changes
  return { day: dayKey, ...s, profit, utcStart: localToUtc(startLocal, tz) };
}
