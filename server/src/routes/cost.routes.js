import express from 'express';
import Click from '../models/Click.js';
import CostEntry from '../models/CostEntry.js';
import { StatsHourly } from '../models/Stats.js';
import { asyncRoute } from '../middleware/error.js';
import { getSettingsSync } from '../services/settings.service.js';
import { parseRange } from '../utils/time.js';
import { num, toObjectId, badRequest } from '../utils/validate.js';

const router = express.Router();

/**
 * Manual cost push: spread a total spend across a campaign's traffic in a date
 * range. Cost is distributed proportionally (per click), and written to BOTH the
 * raw clicks and the hourly stats so report modes agree with each other.
 */
router.post(
  '/cost',
  asyncRoute(async (req, res) => {
    const campaignId = toObjectId(req.body?.campaignId);
    if (!campaignId) throw badRequest('campaignId is required');
    const totalCost = num(req.body?.totalCost, NaN);
    if (!Number.isFinite(totalCost) || totalCost < 0) throw badRequest('totalCost must be a positive number');

    const tz = getSettingsSync().reportTimezone;
    const range = parseRange(req.body?.from, req.body?.to, tz);

    const clickFilter = { campaignId, botFlag: false, ts: { $gte: range.utcFrom, $lte: range.utcTo } };
    const clickCount = await Click.countDocuments(clickFilter);
    if (clickCount === 0) {
      throw badRequest('No clicks found in that period - nothing to distribute cost across');
    }

    const perClick = totalCost / clickCount;
    await Click.updateMany(clickFilter, { $set: { cost: perClick } });

    // Rewrite hourly cost = clicks * perClick for every bucket in the window
    const buckets = await StatsHourly.find(
      { campaignId, hourBucket: { $gte: range.localFrom, $lte: range.localTo } },
      { _id: 1, clicks: 1 }
    ).lean();

    if (buckets.length) {
      await StatsHourly.bulkWrite(
        buckets.map((b) => ({
          updateOne: { filter: { _id: b._id }, update: { $set: { cost: (b.clicks || 0) * perClick } } },
        })),
        { ordered: false }
      );
    }

    const entry = await CostEntry.create({
      campaignId,
      from: range.utcFrom,
      to: range.utcTo,
      totalCost,
      distributedRows: buckets.length,
      note: String(req.body?.note || '').slice(0, 500),
      createdBy: req.user?.email || '',
    });

    res.json({
      ok: true,
      clicks: clickCount,
      perClick: Math.round(perClick * 1e6) / 1e6,
      buckets: buckets.length,
      entry,
    });
  })
);

router.get(
  '/cost',
  asyncRoute(async (req, res) => {
    const q = {};
    const cid = toObjectId(req.query.campaignId);
    if (cid) q.campaignId = cid;
    const items = await CostEntry.find(q).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ items });
  })
);

export default router;
