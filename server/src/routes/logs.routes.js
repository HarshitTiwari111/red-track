import express from 'express';
import Click from '../models/Click.js';
import Conversion from '../models/Conversion.js';
import { PostbackLog, ClickErrorLog } from '../models/Logs.js';
import { asyncRoute } from '../middleware/error.js';
import { updateConversionStatus, addManualConversions } from '../services/conversion.service.js';
import { getCampaignById, getOffer, getNetworkById, getLander, getSource } from '../services/cache.service.js';
import { clientIp } from '../services/geo.service.js';
import { str, bool, toObjectId, isObjectId, badRequest, notFound } from '../utils/validate.js';
import { parseRange } from '../utils/time.js';
import { getSettingsSync } from '../services/settings.service.js';
import { scopeByCampaign, ownedCampaignIds, ownsDoc, isAdmin } from '../middleware/scope.js';

const router = express.Router();

const decorate = (doc) => ({
  ...doc,
  campaignName: doc.campaignId ? getCampaignById(doc.campaignId)?.name || '' : '',
  offerName: doc.offerId ? getOffer(doc.offerId)?.name || '' : '',
  networkName: doc.networkId ? getNetworkById(doc.networkId)?.name || '' : '',
  landerName: doc.landerId ? getLander(doc.landerId)?.name || '' : '',
});

/* ------------------------------------------------------------- clicks log */
router.get(
  '/clicks',
  asyncRoute(async (req, res) => {
    const q = {};
    const cid = toObjectId(req.query.campaignId);
    if (cid) q.campaignId = cid;
    if (req.query.country) q['geo.country'] = str(req.query.country, 8).toUpperCase();
    if (req.query.device) q['uaParsed.device'] = str(req.query.device, 24).toLowerCase();
    if (req.query.clickid) q.clickid = str(req.query.clickid, 64);
    if (req.query.bot !== undefined && req.query.bot !== '') q.botFlag = bool(req.query.bot);
    if (req.query.from || req.query.to) {
      const tz = getSettingsSync().reportTimezone;
      const range = parseRange(req.query.from, req.query.to, tz);
      q.ts = { $gte: range.utcFrom, $lte: range.utcTo };
    }

    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const items = await Click.find(await scopeByCampaign(req, q))
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
    res.json({ items: items.map(decorate), count: items.length });
  })
);

router.get(
  '/clicks/:clickid',
  asyncRoute(async (req, res) => {
    const click = await Click.findOne({ clickid: str(req.params.clickid, 64) }).lean();
    if (!click) throw notFound();
    if (!isAdmin(req)) {
      const mine = await ownedCampaignIds(req);
      if (!mine.some((id) => String(id) === String(click.campaignId))) throw notFound();
    }
    const conversions = await Conversion.find({ clickid: click.clickid }).sort({ ts: -1 }).lean();
    res.json({ click: decorate(click), conversions });
  })
);

/* -------------------------------------------------------- conversions log */
router.get(
  '/conversions',
  asyncRoute(async (req, res) => {
    const q = {};
    const cid = toObjectId(req.query.campaignId);
    if (cid) q.campaignId = cid;
    const nid = toObjectId(req.query.networkId);
    if (nid) q.networkId = nid;
    const oid = toObjectId(req.query.offerId);
    if (oid) q.offerId = oid;
    if (req.query.status) q.status = str(req.query.status, 24);
    if (req.query.type) q.type = str(req.query.type, 24);
    if (req.query.clickid) q.clickid = str(req.query.clickid, 64);
    if (req.query.from || req.query.to) {
      const tz = getSettingsSync().reportTimezone;
      const range = parseRange(req.query.from, req.query.to, tz);
      q.ts = { $gte: range.utcFrom, $lte: range.utcTo };
    }

    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const items = await Conversion.find(await scopeByCampaign(req, q))
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
    res.json({ items: items.map(decorate), count: items.length });
  })
);

/**
 * Conversions grid: every column the page can show, rendered from the snapshot
 * stored on each conversion plus cache lookups for entity names. No joins.
 */
router.get(
  '/conversions/table',
  asyncRoute(async (req, res) => {
    const q = {};
    const cid = toObjectId(req.query.campaignId);
    if (cid) q.campaignId = cid;
    const nid = toObjectId(req.query.networkId);
    if (nid) q.networkId = nid;
    const oid = toObjectId(req.query.offerId);
    if (oid) q.offerId = oid;
    if (req.query.status) q.status = str(req.query.status, 24);
    if (req.query.type) q.type = str(req.query.type, 24);
    if (req.query.clickid) q.clickid = str(req.query.clickid, 64);

    const tz = getSettingsSync().reportTimezone;
    const range = parseRange(req.query.from, req.query.to, tz);
    q.ts = { $gte: range.utcFrom, $lte: range.utcTo };

    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const items = await Conversion.find(await scopeByCampaign(req, q))
      .sort({ ts: -1 })
      .limit(limit)
      .lean();

    // Traffic channel comes from the campaign's source
    const rows = items.map((c, i) => {
      const campaign = c.campaignId ? getCampaignById(c.campaignId) : null;
      const source = campaign?.trafficSourceId ? getSource(campaign.trafficSourceId) : null;
      const subs = c.clickSubs || [];
      const convSubs = c.convSubs || [];

      const flat = {};
      for (let n = 1; n <= 20; n += 1) {
        flat[`clickSub${n}`] = subs[n - 1] || '';
        flat[`convSub${n}`] = convSubs[n - 1] || '';
      }

      return {
        ...c,
        index: i + 1,
        campaignName: campaign?.name || '',
        offerName: c.offerId ? getOffer(c.offerId)?.name || '' : '',
        networkName: c.networkId ? getNetworkById(c.networkId)?.name || '' : '',
        landerName: c.landerId ? getLander(c.landerId)?.name || '' : '',
        sourceName: source?.name || '',
        duplicateStatus: c.duplicateHits ? `${c.duplicateHits} duplicate(s)` : 'unique',
        conversion: 1,
        utmSource: c.utm?.source || '',
        utmMedium: c.utm?.medium || '',
        utmCampaign: c.utm?.campaign || '',
        utmAdgroup: c.utm?.adgroup || '',
        utmAd: c.utm?.ad || '',
        utmPlacement: c.utm?.placement || '',
        utmKeyword: c.utm?.keyword || '',
        ...flat,
      };
    });

    const totals = rows.reduce(
      (a, r) => {
        a.conversion += 1;
        a.payout += r.payout || 0;
        a.cost += r.cost || 0;
        a.publisherRevenue += r.publisherRevenue || 0;
        return a;
      },
      { conversion: 0, payout: 0, cost: 0, publisherRevenue: 0 }
    );
    totals.payout = Math.round(totals.payout * 100) / 100;
    totals.cost = Math.round(totals.cost * 100) / 100;
    totals.publisherRevenue = Math.round(totals.publisherRevenue * 100) / 100;

    res.json({ rows, totals, count: rows.length });
  })
);

/* "Add conversions" - one `clickid, payout` per line */
router.post(
  '/conversions/manual',
  asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '');
    if (!text.trim()) throw badRequest('Paste at least one click id');
    const result = await addManualConversions(text, {
      type: str(req.body?.type, 24) || 'lead',
      status: str(req.body?.status, 24) || 'approved',
      ip: clientIp(req),
    });
    res.json(result);
  })
);

/* Bulk status update from the toolbar */
router.post(
  '/conversions/bulk-status',
  asyncRoute(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isObjectId);
    if (!ids.length) throw badRequest('Select at least one conversion');
    const status = str(req.body?.status, 24);
    if (!['approved', 'pending', 'rejected'].includes(status)) throw badRequest('Unknown status');

    // A user may only touch conversions on campaigns they own
    const scoped = await Conversion.find(await scopeByCampaign(req, { _id: { $in: ids } }), { _id: 1 }).lean();
    const allowed = scoped.map((c) => String(c._id));

    let updated = 0;
    for (const id of allowed) {
      // Sequential on purpose: each edit adjusts stats by its own delta
      // eslint-disable-next-line no-await-in-loop
      const r = await updateConversionStatus(id, { status });
      if (r) updated += 1;
    }
    res.json({ ok: true, updated });
  })
);

router.patch(
  '/conversions/:id',
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const target = await Conversion.findById(req.params.id).lean();
    if (!target) throw notFound();
    if (!isAdmin(req)) {
      const mine = await ownedCampaignIds(req);
      if (!mine.some((cid) => String(cid) === String(target.campaignId))) throw notFound();
    }
    const updated = await updateConversionStatus(req.params.id, {
      status: req.body?.status,
      payout: req.body?.payout,
      type: req.body?.type,
    });
    if (!updated) throw notFound();
    res.json(decorate(updated));
  })
);

/* -------------------------------------------------------------- diagnostics */
/**
 * Every postback the tracker was called with, accepted or refused. This is the
 * only place that answers "did the network actually call, and with what?" - so
 * the raw query it sent is returned untouched rather than summarised.
 */
router.get(
  '/logs/postbacks',
  asyncRoute(async (req, res) => {
    const tz = getSettingsSync().reportTimezone || 'Asia/Kolkata';
    const q = {};

    if (req.query.from || req.query.to) {
      const range = parseRange(req.query.from, req.query.to, tz);
      q.ts = { $gte: range.utcFrom, $lte: range.utcTo };
    }
    if (req.query.ok !== undefined && req.query.ok !== '') q.ok = bool(req.query.ok);
    if (req.query.kind) q.kind = str(req.query.kind, 16);
    if (req.query.type) q.type = str(req.query.type, 60);
    if (req.query.campaignId && isObjectId(req.query.campaignId)) q.campaignId = toObjectId(req.query.campaignId);
    if (req.query.source) q.source = str(req.query.source, 80);

    // Both ids are usually copied out of an ad platform or a network report,
    // so a partial paste has to work rather than demanding the whole string
    const like = (v) => ({ $regex: String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });
    const cid = str(req.query.clickid, 64);
    if (cid) q.clickid = like(cid);
    const ref = str(req.query.refId, 128);
    if (ref) q.refId = like(ref);

    const items = await PostbackLog.find(await scopeByCampaign(req, q))
      .sort({ ts: -1 })
      .limit(Math.min(Number(req.query.limit) || 200, 1000))
      .lean();

    const rows = items.map((d) => ({
      ...d,
      networkName: d.networkId ? getNetworkById(d.networkId)?.name || '' : '',
      campaignName: d.campaignId ? getCampaignById(d.campaignId)?.name || '' : '',
      offerName: d.offerId ? getOffer(d.offerId)?.name || '' : '',
    }));

    const failed = rows.filter((r) => !r.ok).length;
    res.json({
      items: rows,
      count: rows.length,
      failed,
      retentionDays: 14,
      // Only the values actually present in the log are worth offering as filters
      types: [...new Set(items.map((d) => d.type).filter(Boolean))].sort(),
      sources: [...new Set(items.map((d) => d.source).filter(Boolean))].sort(),
    });
  })
);

router.get(
  '/logs/click-errors',
  asyncRoute(async (req, res) => {
    const items = await ClickErrorLog.find({})
      .sort({ ts: -1 })
      .limit(Math.min(Number(req.query.limit) || 200, 1000))
      .lean();
    res.json({ items, count: items.length });
  })
);

export default router;
