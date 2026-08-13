import { getOffer, getLander } from './cache.service.js';
import { isCapped } from './caps.service.js';

/** Weighted pick over [{ weight }] items. Returns the index, or -1 when empty. */
export function weightedPick(items) {
  if (!items || items.length === 0) return -1;
  let total = 0;
  for (const it of items) total += Math.max(0, Number(it.weight) || 0);
  if (total <= 0) return Math.floor(Math.random() * items.length); // all zero => uniform
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= Math.max(0, Number(items[i].weight) || 0);
    if (r <= 0) return i;
  }
  return items.length - 1;
}

const listMatches = (list, value) => {
  if (!list || list.length === 0) return true; // empty condition = "any"
  const v = String(value || '').toLowerCase();
  return list.some((x) => String(x).toLowerCase() === v);
};

/**
 * Hour-of-day window. `from` may be greater than `to` for overnight windows
 * (e.g. 22 -> 5 means 22,23,0..5).
 */
function timeMatches(timeRange, hour) {
  if (!timeRange) return true;
  const { from, to } = timeRange;
  if (from === null || from === undefined || to === null || to === undefined) return true;
  if (from <= to) return hour >= from && hour <= to;
  return hour >= from || hour <= to;
}

/**
 * Rules win over weighted rotation. First matching rule with a valid pathIndex
 * decides the path; otherwise the paths array is picked by weight.
 * @returns {number} path index, or -1 when the campaign has no usable path
 */
export function selectPathIndex(campaign, ctx) {
  const paths = campaign.paths || [];
  if (paths.length === 0) return -1;

  for (const rule of campaign.rules || []) {
    const c = rule.conditions || {};
    if (!listMatches(c.country, ctx.country)) continue;
    if (!listMatches(c.device, ctx.device)) continue;
    if (!listMatches(c.os, ctx.os)) continue;
    if (!listMatches(c.browser, ctx.browser)) continue;
    if (!timeMatches(c.timeRange, ctx.hour)) continue;
    if (rule.pathIndex >= 0 && rule.pathIndex < paths.length) return rule.pathIndex;
  }

  const idx = weightedPick(paths);
  return idx;
}

/**
 * Weighted landing-page pick inside a path. Falls back to the legacy single
 * `landerId` when the path predates lander rotation.
 */
export function selectLander(path) {
  if (!path || path.directLinking) return null;

  const live = (path.landers || [])
    .map((l) => ({ ...l, doc: getLander(l.landerId) }))
    .filter((l) => l.doc && l.doc.status === 'active');

  if (live.length) {
    const idx = weightedPick(live);
    return idx >= 0 ? live[idx].doc : null;
  }

  const single = path.landerId ? getLander(path.landerId) : null;
  return single && single.status === 'active' ? single : null;
}

/**
 * Weighted offer pick inside a path, skipping paused, deleted and capped offers.
 * If every offer in the path is capped the path still has to send traffic
 * somewhere, so caps are ignored as a last resort rather than dropping the click.
 */
export function selectOffer(path) {
  const live = (path?.offers || [])
    .map((o) => ({ ...o, doc: getOffer(o.offerId) }))
    .filter((o) => o.doc && o.doc.status === 'active');
  if (live.length === 0) return null;

  const uncapped = live.filter((o) => !isCapped(o.doc));
  const candidates = uncapped.length ? uncapped : live;

  const idx = weightedPick(candidates);
  return idx >= 0 ? candidates[idx].doc : null;
}
