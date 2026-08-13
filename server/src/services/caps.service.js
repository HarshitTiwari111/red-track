import Click from '../models/Click.js';
import Conversion from '../models/Conversion.js';
import Offer from '../models/Offer.js';
import { getSettingsSync } from './settings.service.js';
import { sendTelegram } from './telegram.service.js';
import { tzParts, localToUtc } from '../utils/time.js';
import logger from '../utils/logger.js';

/**
 * Offer caps.
 *
 * Counters are recomputed on a timer (not on the hot path) and held in memory,
 * so the click redirect can decide synchronously whether an offer is still in
 * rotation. A capped offer is skipped by the rotation only - visitors already on
 * a lander still reach it through /go, exactly like the funnel would expect.
 */

const counters = new Map(); // offerId -> { clicks, uniques, conversions }
const alerted = new Set(); // `${offerId}:${kind}:${periodKey}`
let lastRefresh = 0;

const PERIODS = ['hour', 'day', 'month', 'total'];

export function periodStart(timePeriod, tz) {
  if (timePeriod === 'total') return new Date(0);
  const p = tzParts(new Date(), tz);
  let naive;
  if (timePeriod === 'hour') naive = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour));
  else if (timePeriod === 'month') naive = new Date(Date.UTC(p.year, p.month - 1, 1));
  else naive = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return localToUtc(naive, tz);
}

export function periodKey(timePeriod, tz) {
  if (timePeriod === 'total') return 'total';
  const p = tzParts(new Date(), tz);
  const base = `${p.year}-${String(p.month).padStart(2, '0')}`;
  if (timePeriod === 'month') return base;
  const day = `${base}-${String(p.day).padStart(2, '0')}`;
  return timePeriod === 'hour' ? `${day}T${String(p.hour).padStart(2, '0')}` : day;
}

const hasCap = (c) => Boolean(c && (c.uniqueVisits > 0 || c.clickCap > 0 || c.conversionCap > 0));

/** Recompute counters for every offer that actually has a cap configured. */
export async function refreshCaps() {
  try {
    const tz = getSettingsSync().reportTimezone || 'Asia/Kolkata';
    const offers = await Offer.find({}, { caps: 1, name: 1 }).lean();
    const capped = offers.filter((o) => hasCap(o.caps));

    if (capped.length === 0) {
      counters.clear();
      lastRefresh = Date.now();
      return;
    }

    // One aggregation per distinct period, not per offer.
    const byPeriod = new Map();
    for (const o of capped) {
      const period = PERIODS.includes(o.caps.timePeriod) ? o.caps.timePeriod : 'day';
      if (!byPeriod.has(period)) byPeriod.set(period, []);
      byPeriod.get(period).push(o);
    }

    const next = new Map();

    for (const [period, list] of byPeriod) {
      const since = periodStart(period, tz);
      const ids = list.map((o) => o._id);

      const [clickAgg, convAgg] = await Promise.all([
        Click.aggregate([
          { $match: { offerId: { $in: ids }, botFlag: false, ts: { $gte: since } } },
          {
            $group: {
              _id: '$offerId',
              clicks: { $sum: 1 },
              uniques: { $sum: { $cond: ['$isUnique', 1, 0] } },
            },
          },
        ]),
        Conversion.aggregate([
          { $match: { offerId: { $in: ids }, status: { $ne: 'rejected' }, ts: { $gte: since } } },
          { $group: { _id: '$offerId', conversions: { $sum: 1 } } },
        ]),
      ]);

      for (const r of clickAgg) {
        next.set(String(r._id), { clicks: r.clicks || 0, uniques: r.uniques || 0, conversions: 0 });
      }
      for (const r of convAgg) {
        const cur = next.get(String(r._id)) || { clicks: 0, uniques: 0, conversions: 0 };
        cur.conversions = r.conversions || 0;
        next.set(String(r._id), cur);
      }
    }

    counters.clear();
    for (const [k, v] of next) counters.set(k, v);
    lastRefresh = Date.now();

    checkAlerts(capped, tz);
  } catch (err) {
    logger.warn('caps refresh failed:', err.message);
  }
}

/** Which cap (if any) an offer has hit right now. Synchronous - safe on the hot path. */
export function capStatus(offer) {
  const caps = offer?.caps;
  if (!hasCap(caps)) return null;
  const c = counters.get(String(offer._id)) || { clicks: 0, uniques: 0, conversions: 0 };

  const clicksCounted = caps.filterType === 'unique' ? c.uniques : c.clicks;
  if (caps.clickCap > 0 && clicksCounted >= caps.clickCap) return 'clicks';
  if (caps.uniqueVisits > 0 && c.uniques >= caps.uniqueVisits) return 'uniqueVisits';
  if (caps.conversionCap > 0 && c.conversions >= caps.conversionCap) return 'conversions';
  return null;
}

export const isCapped = (offer) => capStatus(offer) !== null;

/** Live counters for the dashboard, so an operator can see cap progress. */
export function capUsage(offerId) {
  return counters.get(String(offerId)) || { clicks: 0, uniques: 0, conversions: 0 };
}

function checkAlerts(offers, tz) {
  for (const offer of offers) {
    const hit = capStatus(offer);
    if (!hit) continue;
    const wantsAlert =
      (hit === 'conversions' && offer.caps.alertOnConversionCap) ||
      ((hit === 'clicks' || hit === 'uniqueVisits') && offer.caps.alertOnClickCap);
    if (!wantsAlert) continue;

    const key = `${offer._id}:${hit}:${periodKey(offer.caps.timePeriod, tz)}`;
    if (alerted.has(key)) continue;
    alerted.add(key);
    if (alerted.size > 5000) alerted.clear();

    sendTelegram(
      `🛑 <b>Offer cap reached</b>\n${offer.name}\nCap: ${hit} (${offer.caps.timePeriod})\nThe offer is out of rotation until the period resets.`,
      { key: `cap-${offer._id}` }
    );
  }
}

let timer = null;
export function startCapsRefresh(intervalMs = 30_000) {
  if (timer) return;
  refreshCaps();
  timer = setInterval(refreshCaps, intervalMs);
  timer.unref?.();
}

export function stopCapsRefresh() {
  if (timer) clearInterval(timer);
  timer = null;
}

export const capsAgeMs = () => (lastRefresh ? Date.now() - lastRefresh : -1);
