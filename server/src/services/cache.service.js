import Campaign from '../models/Campaign.js';
import Offer from '../models/Offer.js';
import Lander from '../models/Lander.js';
import TrafficSource from '../models/TrafficSource.js';
import AffiliateNetwork from '../models/AffiliateNetwork.js';
import Domain from '../models/Domain.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * In-memory config cache. The click path reads ONLY from here - there is never a
 * DB read before a 302. Refreshed every 30s and immediately after any CRUD write
 * in this process (other cluster workers pick the change up on their next tick).
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

let timer = null;
export function startCacheRefresh() {
  if (timer) return;
  timer = setInterval(() => {
    refreshCache();
  }, config.cacheRefreshMs);
  timer.unref?.();
}

export function stopCacheRefresh() {
  if (timer) clearInterval(timer);
  timer = null;
}

export const getCampaignBySlug = (slug) => cache.campaignsBySlug.get(String(slug || '').toLowerCase());
export const getCampaignById = (id) => cache.campaignsById.get(String(id));
export const getOffer = (id) => cache.offers.get(String(id));
export const getLander = (id) => cache.landers.get(String(id));
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
