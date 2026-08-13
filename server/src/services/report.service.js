import mongoose from 'mongoose';
import Click from '../models/Click.js';
import { StatsHourly, StatsSubs } from '../models/Stats.js';
import { getSettingsSync } from './settings.service.js';
import { getCampaignById, getOffer, getLander, getNetworkById, getSource } from './cache.service.js';
import { parseRange, localDayKey } from '../utils/time.js';
import { str, bool, toObjectId } from '../utils/validate.js';

export const DIMENSIONS = [
  'campaign',
  'source',
  'network',
  'offer',
  'lander',
  'country',
  'device',
  'os',
  'browser',
  'day',
  'hour',
  'sub1',
  'sub2',
  'sub3',
  'sub4',
  'sub5',
  'sub6',
  'sub7',
  'sub8',
  'sub9',
  'sub10',
];

// Dimensions that stats_hourly can answer directly
const FAST_DIMS = new Set(['campaign', 'country', 'device', 'day', 'hour']);
const SUB_DIMS = new Set(['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'sub6', 'sub7', 'sub8', 'sub9', 'sub10']);

const RAW_FIELD = {
  campaign: '$campaignId',
  source: '$source',
  offer: '$offerId',
  lander: '$landerId',
  country: '$geo.country',
  device: '$uaParsed.device',
  os: '$uaParsed.os',
  browser: '$uaParsed.browser',
  sub1: '$sub1',
  sub2: '$sub2',
  sub3: '$sub3',
  sub4: '$sub4',
  sub5: '$sub5',
  sub6: '$sub6',
  sub7: '$sub7',
  sub8: '$sub8',
  sub9: '$sub9',
  sub10: '$sub10',
};

const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

/** Derived metrics shared by every code path. */
export function withDerived(row) {
  const clicks = row.clicks || 0;
  const lpClicks = row.lpClicks || 0;
  const conversions = row.conversions || 0;
  const revenue = row.revenue || 0;
  const cost = row.cost || 0;
  const profit = revenue - cost;
  return {
    ...row,
    clicks,
    uniques: row.uniques || 0,
    lpClicks,
    conversions,
    revenue: round(revenue),
    cost: round(cost),
    profit: round(profit),
    lpCtr: clicks ? round((lpClicks / clicks) * 100) : 0,
    cr: clicks ? round((conversions / clicks) * 100) : 0,
    roi: cost ? round((profit / cost) * 100) : 0,
    epc: clicks ? round(revenue / clicks, 4) : 0,
    cpc: clicks ? round(cost / clicks, 4) : 0,
  };
}

function emptyRow() {
  return { clicks: 0, uniques: 0, lpClicks: 0, conversions: 0, revenue: 0, cost: 0 };
}

/** Normalise query params into a filter object. */
export function parseFilters(q = {}) {
  const filters = {};
  if (q.campaignId && toObjectId(q.campaignId)) filters.campaignId = toObjectId(q.campaignId);
  if (q.offerId && toObjectId(q.offerId)) filters.offerId = toObjectId(q.offerId);
  if (q.landerId && toObjectId(q.landerId)) filters.landerId = toObjectId(q.landerId);
  if (q.country) filters.country = str(q.country, 8).toUpperCase();
  if (q.device) filters.device = str(q.device, 24).toLowerCase();
  if (q.os) filters.os = str(q.os, 40);
  if (q.browser) filters.browser = str(q.browser, 40);
  if (q.source) filters.source = str(q.source, 80);
  for (const s of SUB_DIMS) if (q[s]) filters[s] = str(q[s], 255);
  return filters;
}

const FAST_FILTER_KEYS = new Set(['campaignId', 'country', 'device']);

/**
 * @param {object} params { groupBy, from, to, filters, includeBots, limit }
 * @returns {{rows: object[], totals: object, source: 'stats'|'stats_subs'|'raw', groupBy: string}}
 */
export async function runReport(params = {}) {
  const settings = getSettingsSync();
  const tz = settings.reportTimezone || 'Asia/Kolkata';
  const groupBy = DIMENSIONS.includes(params.groupBy) ? params.groupBy : 'campaign';
  const filters = params.filters || {};
  const includeBots = bool(params.includeBots, false);
  const range = parseRange(params.from, params.to, tz);
  const limit = Math.min(Math.max(Number(params.limit) || 500, 1), 5000);

  const filterKeys = Object.keys(filters);
  const fastFilters = filterKeys.every((k) => FAST_FILTER_KEYS.has(k));

  if (FAST_DIMS.has(groupBy) && fastFilters) {
    return finish(await reportFromHourly({ groupBy, range, filters, includeBots, tz }), groupBy, 'stats', limit);
  }
  if (SUB_DIMS.has(groupBy) && fastFilters && !includeBots) {
    return finish(await reportFromSubs({ groupBy, range, filters, tz }), groupBy, 'stats_subs', limit);
  }
  return finish(await reportFromRaw({ groupBy, range, filters, includeBots, tz }), groupBy, 'raw', limit);
}

function finish(rows, groupBy, source, limit) {
  const totals = emptyRow();
  for (const r of rows) {
    totals.clicks += r.clicks || 0;
    totals.uniques += r.uniques || 0;
    totals.lpClicks += r.lpClicks || 0;
    totals.conversions += r.conversions || 0;
    totals.revenue += r.revenue || 0;
    totals.cost += r.cost || 0;
  }
  // Buckets can end up all-zero (e.g. a bot-only hour when bots are excluded) -
  // they carry no information, so keep them out of the table.
  const out = rows
    .filter((r) => r.clicks || r.conversions || r.revenue || r.cost || r.lpClicks)
    .map(withDerived)
    .sort((a, b) => b.clicks - a.clicks || b.revenue - a.revenue);
  return { rows: out.slice(0, limit), totals: withDerived(totals), source, groupBy };
}

/* ------------------------------------------------------------ stats_hourly */
async function reportFromHourly({ groupBy, range, filters, includeBots }) {
  const match = { hourBucket: { $gte: range.localFrom, $lte: range.localTo } };
  if (filters.campaignId) match.campaignId = filters.campaignId;
  if (filters.country) match.country = filters.country;
  if (filters.device) match.device = filters.device;

  let id;
  if (groupBy === 'campaign') id = '$campaignId';
  else if (groupBy === 'country') id = '$country';
  else if (groupBy === 'device') id = '$device';
  else if (groupBy === 'day')
    // buckets are naive-local, so format them as UTC to read the wall clock back
    id = { $dateToString: { format: '%Y-%m-%d', date: '$hourBucket', timezone: 'UTC' } };
  else id = { $dateToString: { format: '%Y-%m-%d %H:00', date: '$hourBucket', timezone: 'UTC' } };

  const agg = await StatsHourly.aggregate([
    { $match: match },
    {
      $group: {
        _id: id,
        clicks: { $sum: '$clicks' },
        bots: { $sum: '$bots' },
        uniques: { $sum: '$uniques' },
        lpClicks: { $sum: '$lpClicks' },
        conversions: { $sum: '$conversions' },
        revenue: { $sum: '$revenue' },
        cost: { $sum: '$cost' },
      },
    },
  ]).allowDiskUse(true);

  return agg.map((r) => ({
    key: r._id === null ? '' : String(r._id),
    label: labelFor(groupBy, r._id),
    clicks: (r.clicks || 0) + (includeBots ? r.bots || 0 : 0),
    uniques: r.uniques || 0,
    lpClicks: r.lpClicks || 0,
    conversions: r.conversions || 0,
    revenue: r.revenue || 0,
    cost: r.cost || 0,
    bots: r.bots || 0,
  }));
}

/* -------------------------------------------------------------- stats_subs */
async function reportFromSubs({ groupBy, range, filters, tz }) {
  const match = {
    day: { $gte: localDayKey(range.utcFrom, tz), $lte: localDayKey(range.utcTo, tz) },
    subKey: { $regex: `^${groupBy}:` },
  };
  if (filters.campaignId) match.campaignId = filters.campaignId;

  const agg = await StatsSubs.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$subKey',
        clicks: { $sum: '$clicks' },
        conversions: { $sum: '$conversions' },
        revenue: { $sum: '$revenue' },
        cost: { $sum: '$cost' },
      },
    },
  ]).allowDiskUse(true);

  return agg.map((r) => {
    const value = String(r._id).slice(groupBy.length + 1);
    return {
      key: value,
      label: value || '(none)',
      clicks: r.clicks || 0,
      uniques: 0, // not tracked per-sub
      lpClicks: 0,
      conversions: r.conversions || 0,
      revenue: r.revenue || 0,
      cost: r.cost || 0,
    };
  });
}

/* --------------------------------------------------------------- raw mode */
async function reportFromRaw({ groupBy, range, filters, includeBots, tz }) {
  const match = { ts: { $gte: range.utcFrom, $lte: range.utcTo } };
  if (!includeBots) match.botFlag = false;
  if (filters.campaignId) match.campaignId = filters.campaignId;
  if (filters.offerId) match.offerId = filters.offerId;
  if (filters.landerId) match.landerId = filters.landerId;
  if (filters.country) match['geo.country'] = filters.country;
  if (filters.device) match['uaParsed.device'] = filters.device;
  if (filters.os) match['uaParsed.os'] = filters.os;
  if (filters.browser) match['uaParsed.browser'] = filters.browser;
  if (filters.source) match.source = filters.source;
  for (const s of SUB_DIMS) if (filters[s]) match[s] = filters[s];

  // network is derived from the offer, so group by offer and remap afterwards
  const effectiveGroup = groupBy === 'network' ? 'offer' : groupBy;

  let id;
  if (effectiveGroup === 'day') id = { $dateToString: { format: '%Y-%m-%d', date: '$ts', timezone: tz } };
  else if (effectiveGroup === 'hour') id = { $dateToString: { format: '%Y-%m-%d %H:00', date: '$ts', timezone: tz } };
  else id = RAW_FIELD[effectiveGroup] || '$campaignId';

  const agg = await Click.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'conversions',
        localField: 'clickid',
        foreignField: 'clickid',
        as: 'convs',
        pipeline: [{ $match: { status: { $ne: 'rejected' } } }, { $project: { payout: 1 } }],
      },
    },
    {
      $group: {
        _id: id,
        clicks: { $sum: 1 },
        uniques: { $sum: { $cond: ['$isUnique', 1, 0] } },
        lpClicks: { $sum: { $cond: ['$lpClick', 1, 0] } },
        conversions: { $sum: { $size: '$convs' } },
        revenue: { $sum: { $sum: '$convs.payout' } },
        cost: { $sum: '$cost' },
      },
    },
  ]).allowDiskUse(true);

  let rows = agg.map((r) => ({
    key: r._id === null || r._id === undefined ? '' : String(r._id),
    label: labelFor(effectiveGroup, r._id),
    clicks: r.clicks || 0,
    uniques: r.uniques || 0,
    lpClicks: r.lpClicks || 0,
    conversions: r.conversions || 0,
    revenue: r.revenue || 0,
    cost: r.cost || 0,
  }));

  if (groupBy === 'network') rows = remapToNetworks(agg);
  return rows;
}

function remapToNetworks(agg) {
  const byNetwork = new Map();
  for (const r of agg) {
    const offer = r._id ? getOffer(r._id) : null;
    const netId = offer?.networkId ? String(offer.networkId) : '';
    const cur = byNetwork.get(netId) || {
      key: netId,
      label: netId ? getNetworkById(netId)?.name || netId : '(none)',
      ...emptyRow(),
    };
    cur.clicks += r.clicks || 0;
    cur.uniques += r.uniques || 0;
    cur.lpClicks += r.lpClicks || 0;
    cur.conversions += r.conversions || 0;
    cur.revenue += r.revenue || 0;
    cur.cost += r.cost || 0;
    byNetwork.set(netId, cur);
  }
  return [...byNetwork.values()];
}

function labelFor(dim, value) {
  if (value === null || value === undefined || value === '') return '(none)';
  const v = String(value);
  switch (dim) {
    case 'campaign':
      return getCampaignById(v)?.name || v;
    case 'offer':
      return getOffer(v)?.name || v;
    case 'lander':
      return getLander(v)?.name || v;
    case 'network':
      return getNetworkById(v)?.name || v;
    case 'source':
      return v;
    default:
      return v;
  }
}

/**
 * Timeseries for the overview chart - always day or hour buckets from stats_hourly.
 */
export async function runTimeseries({ from, to, campaignId, granularity = 'day' }) {
  const settings = getSettingsSync();
  const tz = settings.reportTimezone || 'Asia/Kolkata';
  const range = parseRange(from, to, tz);
  const match = { hourBucket: { $gte: range.localFrom, $lte: range.localTo } };
  const cid = toObjectId(campaignId);
  if (cid) match.campaignId = cid;

  const fmt = granularity === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
  const agg = await StatsHourly.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: fmt, date: '$hourBucket', timezone: 'UTC' } },
        clicks: { $sum: '$clicks' },
        conversions: { $sum: '$conversions' },
        revenue: { $sum: '$revenue' },
        cost: { $sum: '$cost' },
      },
    },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);

  return agg.map((r) => ({
    bucket: r._id,
    clicks: r.clicks || 0,
    conversions: r.conversions || 0,
    revenue: round(r.revenue),
    cost: round(r.cost),
    profit: round((r.revenue || 0) - (r.cost || 0)),
  }));
}

/** Summary card totals for an arbitrary range. */
export async function runSummary({ from, to, campaignId }) {
  const settings = getSettingsSync();
  const tz = settings.reportTimezone || 'Asia/Kolkata';
  const range = parseRange(from, to, tz);
  const match = { hourBucket: { $gte: range.localFrom, $lte: range.localTo } };
  const cid = toObjectId(campaignId);
  if (cid) match.campaignId = cid;

  const [agg] = await StatsHourly.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        clicks: { $sum: '$clicks' },
        uniques: { $sum: '$uniques' },
        lpClicks: { $sum: '$lpClicks' },
        conversions: { $sum: '$conversions' },
        revenue: { $sum: '$revenue' },
        cost: { $sum: '$cost' },
        bots: { $sum: '$bots' },
      },
    },
  ]);

  return withDerived({ ...emptyRow(), ...(agg || {}), bots: agg?.bots || 0 });
}

export { mongoose };
