import Campaign from '../models/Campaign.js';
import Offer from '../models/Offer.js';
import Lander from '../models/Lander.js';
import TrafficSource from '../models/TrafficSource.js';
import AffiliateNetwork from '../models/AffiliateNetwork.js';
import Domain from '../models/Domain.js';
import AppMeta from '../models/AppMeta.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * In-memory config cache. The click path reads ONLY from here - there is never a
 * DB read before a 302. Refreshed every 30s, immediately after a write in this
 * process, and within a couple of seconds on the other cluster workers - see
 * publishConfigChange below for how they are told.
 */
const cache = {
  campaignsBySlug: new Map(),
  campaignsById: new Map(),
  offers: new Map(),
  landers: new Map(),
  sources: new Map(),
  networksByKey: new Map(),
  domainsByHost: new Map(),
  networksById: new Map(),
  refreshedAt: 0,
  refreshing: null,
};

export async function refreshCache() {
  if (cache.refreshing) return cache.refreshing;
  cache.refreshing = (async () => {
    const [campaigns, offers, landers, sources, networks, domains] = await Promise.all([
      Campaign.find({}).lean(),
      Offer.find({}).lean(),
      Lander.find({}).lean(),
      TrafficSource.find({}).lean(),
      AffiliateNetwork.find({}).lean(),
      Domain.find({}).lean(),
    ]);

    const campaignsBySlug = new Map();
    const campaignsById = new Map();
    for (const c of campaigns) {
      campaignsBySlug.set(c.slug, c);
      campaignsById.set(String(c._id), c);
    }
    cache.campaignsBySlug = campaignsBySlug;
    cache.campaignsById = campaignsById;
    cache.offers = new Map(offers.map((o) => [String(o._id), o]));
    cache.landers = new Map(landers.map((l) => [String(l._id), l]));
    cache.sources = new Map(sources.map((s) => [String(s._id), s]));
    cache.networksByKey = new Map(networks.map((n) => [n.postbackSecurityKey, n]));
    cache.networksById = new Map(networks.map((n) => [String(n._id), n]));
    cache.domainsByHost = new Map(domains.map((d) => [d.host, d]));
    cache.refreshedAt = Date.now();
  })()
    .catch((err) => logger.error('cache refresh failed:', err.message))
    .finally(() => {
      cache.refreshing = null;
    });
  return cache.refreshing;
}

/**
 * Tell every worker that configuration changed.
 *
 * Refreshing here only fixes the worker that served the write; the others are
 * still holding the old configuration. Bumping a shared counter is what lets
 * them notice, and it costs one tiny write instead of any coordination.
 */
let seenVersion = -1;
export async function publishConfigChange() {
  await refreshCache();
  try {
    const doc = await AppMeta.findOneAndUpdate(
      { _id: 'config' },
      { $inc: { version: 1 }, $set: { at: new Date() } },
      { upsert: true, new: true }
    ).lean();
    // This worker is already current, so it must not refresh again on the watch
    seenVersion = doc?.version ?? seenVersion;
  } catch (err) {
    // The local refresh already happened; the others still catch up on their
    // full tick, which is what used to happen every time.
    logger.warn('config version bump failed:', err.message);
  }
}

let timer = null;
let watch = null;
export function startCacheRefresh() {
  if (timer) return;
  timer = setInterval(() => {
    refreshCache();
  }, config.cacheRefreshMs);
  timer.unref?.();

  /*
   * A second, much faster timer that reads one number rather than the whole
   * configuration. It is what turns "up to 30 seconds" into "a couple of
   * seconds" for a change made on another worker, without putting a database
   * read anywhere near the click path.
   */
  watch = setInterval(async () => {
    try {
      const doc = await AppMeta.findById('config', { version: 1 }).lean();
      const v = doc?.version ?? 0;
      if (seenVersion === -1) {
        seenVersion = v;
        return;
      }
      if (v !== seenVersion) {
        seenVersion = v;
        await refreshCache();
      }
    } catch {
      /* the full refresh above is the backstop */
    }
  }, config.configWatchMs);
  watch.unref?.();
}

export function stopCacheRefresh() {
  if (timer) clearInterval(timer);
  if (watch) clearInterval(watch);
  timer = null;
  watch = null;
}

export const getCampaignBySlug = (slug) => cache.campaignsBySlug.get(String(slug || '').toLowerCase());
export const getCampaignById = (id) => cache.campaignsById.get(String(id));
export const getOffer = (id) => cache.offers.get(String(id));
export const getLander = (id) => cache.landers.get(String(id));
/** Every cached offer, for lookups that run the other way (network -> its offers). */
export const listOffers = () => [...cache.offers.values()];
export const getSource = (id) => cache.sources.get(String(id));
export const getNetworkByKey = (key) => cache.networksByKey.get(String(key));
export const getNetworkById = (id) => cache.networksById.get(String(id));
export const getDomainByHost = (host) => cache.domainsByHost.get(String(host || '').toLowerCase());
export const cacheAgeMs = () => (cache.refreshedAt ? Date.now() - cache.refreshedAt : -1);
export const cacheStats = () => ({
  campaigns: cache.campaignsBySlug.size,
  offers: cache.offers.size,
  landers: cache.landers.size,
  sources: cache.sources.size,
  networks: cache.networksById.size,
  domains: cache.domainsByHost.size,
  ageMs: cacheAgeMs(),
});
