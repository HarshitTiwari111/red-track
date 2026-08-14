import express from 'express';
import { asyncRoute } from '../middleware/error.js';
import { runReport, runSummary, runTimeseries } from '../services/report.service.js';
import { ownedCampaignIds } from '../middleware/scope.js';
import { getSettingsSync } from '../services/settings.service.js';
import { localDayKey } from '../utils/time.js';

const router = express.Router();

const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The four fixed periods the dashboard reports on, in the report timezone. */
function periods(tz) {
  const todayKey = localDayKey(new Date(), tz);
  const [y, m, d] = todayKey.split('-').map(Number);

  const yest = new Date(Date.UTC(y, m - 1, d - 1));
  const yesterdayKey = key(yest.getUTCFullYear(), yest.getUTCMonth() + 1, yest.getUTCDate());

  const lastY = m === 1 ? y - 1 : y;
  const lastM = m === 1 ? 12 : m - 1;

  return {
    today: { from: todayKey, to: todayKey },
    yesterday: { from: yesterdayKey, to: yesterdayKey },
    thisMonth: { from: key(y, m, 1), to: todayKey },
    lastMonth: { from: key(lastY, lastM, 1), to: key(lastY, lastM, lastDayOf(lastY, lastM)) },
  };
}

const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

/** ROAS as both a ratio and a percentage, matching how the cards render it. */
const withRoas = (s) => ({
  ...s,
  roas: s.cost ? round(s.revenue / s.cost, 2) : 0,
  roasPct: s.cost ? round((s.revenue / s.cost) * 100, 2) : 0,
});

/** Top 3 rows by revenue, padded out so the card always renders three lines. */
const top3 = (rows) =>
  [...rows]
    .sort((a, b) => b.revenue - a.revenue || b.conversions - a.conversions || b.clicks - a.clicks)
    .slice(0, 3)
    .concat(Array(3).fill({ label: '-', revenue: 0, conversions: 0, clicks: 0 }))
    .slice(0, 3)
    .map((r) => ({
      label: r.label || '-',
      revenue: round(r.revenue),
      conversions: r.conversions || 0,
      clicks: r.clicks || 0,
    }));

/**
 * Everything the dashboard needs in one round trip: four period summaries,
 * top-3 lists for three dimensions across today and yesterday, and today's
 * hourly clicks/conversions series.
 */
router.get(
  '/dashboard',
  asyncRoute(async (req, res) => {
    const tz = getSettingsSync().reportTimezone || 'Asia/Kolkata';
    const p = periods(tz);
    const DIMS = ['campaign', 'offer', 'source'];
    // A user's dashboard only counts their own campaigns
    const ids = await ownedCampaignIds(req);
    const scope = ids === null ? {} : { campaignIds: ids };

    const [summaries, tops, chart] = await Promise.all([
      Promise.all(Object.values(p).map((range) => runSummary({ ...range, ...scope }))),
      Promise.all(
        DIMS.flatMap((groupBy) =>
          ['today', 'yesterday'].map((day) =>
            runReport({ groupBy, ...p[day], limit: 50, filters: scope }).then((r) => ({ groupBy, day, rows: r.rows }))
          )
        )
      ),
      runTimeseries({ ...p.today, ...scope, granularity: 'hour' }),
    ]);

    const names = Object.keys(p);
    const summary = Object.fromEntries(names.map((n, i) => [n, withRoas(summaries[i])]));

    const top = {};
    for (const { groupBy, day, rows } of tops) {
      top[groupBy] = top[groupBy] || {};
      top[groupBy][day] = top3(rows);
    }

    res.json({ lastUpdate: new Date().toISOString(), timezone: tz, ranges: p, summary, top, chart });
  })
);

export default router;
