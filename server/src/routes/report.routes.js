import express from 'express';
import { asyncRoute } from '../middleware/error.js';
import { runReport, runTimeseries, runSummary, parseFilters, DIMENSIONS } from '../services/report.service.js';
import { getSettingsSync } from '../services/settings.service.js';
import { str } from '../utils/validate.js';

const router = express.Router();

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
      filters: parseFilters(req.query),
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
      from: req.query.from,
      to: req.query.to,
      campaignId: req.query.campaignId,
    });
    res.json(summary);
  })
);

export default router;
