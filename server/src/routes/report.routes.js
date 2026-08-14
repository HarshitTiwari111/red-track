import express from 'express';
import { asyncRoute } from '../middleware/error.js';
import { runReport, runTimeseries, runSummary, parseFilters, DIMENSIONS } from '../services/report.service.js';
import { getSettingsSync } from '../services/settings.service.js';
import { ownedCampaignIds } from '../middleware/scope.js';
import { str } from '../utils/validate.js';

const router = express.Router();

/** Ownership scope in the shape each entry point expects. */
const scope = async (req) => {
  const ids = await ownedCampaignIds(req);
  return ids === null ? {} : { campaignIds: ids };
};

router.get(
  '/report',
  asyncRoute(async (req, res) => {
    const result = await runReport({
      groupBy: str(req.query.groupBy, 24) || 'campaign',
      from: req.query.from,
      to: req.query.to,
      includeBots: req.query.includeBots,
      limit: req.query.limit,
      sortBy: str(req.query.sortBy, 24),
      sortDir: req.query.sortDir === 'asc' ? 'asc' : 'desc',
      tz: str(req.query.tz, 64),
      // null for an admin, so no scope is applied at all
      filters: { ...parseFilters(req.query), ...(await scope(req)) },
    });
    res.json(result);
  })
);

router.get(
  '/report/dimensions',
  asyncRoute(async (req, res) => {
    res.json({ dimensions: DIMENSIONS, reportTimezone: getSettingsSync().reportTimezone || 'Asia/Kolkata' });
  })
);

router.get(
  '/report/timeseries',
  asyncRoute(async (req, res) => {
    const points = await runTimeseries({
      ...(await scope(req)),
      from: req.query.from,
      to: req.query.to,
      campaignId: req.query.campaignId,
      granularity: req.query.granularity === 'hour' ? 'hour' : 'day',
    });
    res.json({ points });
  })
);

router.get(
  '/report/summary',
  asyncRoute(async (req, res) => {
    const summary = await runSummary({
      ...(await scope(req)),
      from: req.query.from,
      to: req.query.to,
      campaignId: req.query.campaignId,
    });
    res.json(summary);
  })
);

export default router;
