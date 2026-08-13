import dns from 'node:dns';
import Domain from '../models/Domain.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { refreshCache } from './cache.service.js';

/**
 * DNS ownership check for tracking domains.
 *
 * Uses resolveCname/resolve4 rather than dns.lookup on purpose: lookup goes
 * through the OS resolver (and its cache/hosts file), which is exactly what an
 * operator watching for a fresh registrar change must not be answered from.
 */
const resolver = new dns.promises.Resolver();
if (config.dnsResolvers.length) resolver.setServers(config.dnsResolvers);

/** DNS names are case-insensitive and answers carry a trailing dot. */
const clean = (h) =>
  String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');

/** Propagation delays are the normal case here, so the copy never says "wrong". */
const FRIENDLY = {
  ENOTFOUND: 'DNS record abhi propagate nahi hua — the name does not resolve yet',
  ENODATA: 'DNS record abhi propagate nahi hua — the name exists but has no matching record yet',
  ESERVFAIL: 'the nameserver returned SERVFAIL — check the zone is published',
  ETIMEOUT: 'the DNS query timed out',
  EREFUSED: 'the nameserver refused the query',
};

const describe = (err) => FRIENDLY[err?.code] || err?.message || 'lookup failed';

/**
 * Resolve `host` and decide whether it points at `target`.
 *
 * Two ways to pass, because a CNAME is not the only correct setup:
 *   cname - the textbook case, host is a CNAME to the target
 *   a     - host and target resolve to at least one shared IPv4. Covers plain A
 *           records and Cloudflare-proxied domains, where the CNAME is flattened
 *           away and querying it would report a false failure forever.
 */
export async function checkDns(host, target) {
  const name = clean(host);
  const want = clean(target);
  if (!name || !want) return { ok: false, method: '', found: [], error: 'missing host or target' };

  const errors = [];

  try {
    const found = (await resolver.resolveCname(name)).map(clean);
    if (found.includes(want)) return { ok: true, method: 'cname', found, error: '' };
    if (found.length) {
      return {
        ok: false,
        method: '',
        found,
        error: `CNAME points at ${found.join(', ')} instead of ${want}`,
      };
    }
  } catch (err) {
    errors.push(describe(err));
  }

  try {
    const [hostIps, targetIps] = await Promise.all([resolver.resolve4(name), resolver.resolve4(want)]);
    const shared = hostIps.filter((ip) => targetIps.includes(ip));
    if (shared.length) return { ok: true, method: 'a', found: hostIps, error: '' };
    if (hostIps.length) {
      return {
        ok: false,
        method: '',
        found: hostIps,
        error: `resolves to ${hostIps.join(', ')}, which is not where ${want} points (${targetIps.join(', ')})`,
      };
    }
  } catch (err) {
    errors.push(describe(err));
  }

  return { ok: false, method: '', found: [], error: errors[0] || 'no CNAME or A record found' };
}

/** Run the check for one domain document and persist the outcome. */
export async function verifyDomainDns(domain) {
  /**
   * A verified domain keeps the target it was proved against; a pending one
   * always re-reads the configured target. Without this, a domain added before
   * DNS_TARGET_CNAME was set keeps checking the old value forever - the operator
   * fixes their config, and every pending domain still fails against a stale
   * hostname with no way back short of deleting and re-adding it.
   */
  const target = (domain.dnsVerifiedAt && domain.targetCname) || config.dnsTargetCname;
  const result = await checkDns(domain.host, target);
  const now = new Date();

  const patch = {
    targetCname: target,
    dnsCheckedAt: now,
    dnsFound: result.found.slice(0, 10),
    dnsMethod: result.ok ? result.method : '',
    dnsError: result.ok ? '' : result.error,
  };

  if (result.ok) {
    patch.dnsVerifiedAt = now;
    // Never resurrect a domain the operator paused on purpose
    if (domain.status === 'pending') patch.status = 'active';
  }

  const updated = await Domain.findByIdAndUpdate(
    domain._id,
    { $set: patch, $inc: { dnsAttempts: 1 } },
    { new: true }
  ).lean();

  // The host guard reads domains from the cache, so a newly active domain
  // would keep 404ing for up to the refresh interval without this.
  if (result.ok && domain.status === 'pending') await refreshCache();

  return { domain: updated, result };
}

/**
 * Re-check every pending domain. Runs on a timer so the operator does not have
 * to sit on the Verify button while the registrar change propagates.
 */
export async function verifyPendingDomains() {
  const pending = await Domain.find({ status: 'pending' }).lean();
  if (!pending.length) return { checked: 0, verified: 0 };

  let verified = 0;
  for (const d of pending) {
    // eslint-disable-next-line no-await-in-loop
    const { result } = await verifyDomainDns(d);
    if (result.ok) {
      verified += 1;
      logger.info(`dns: ${d.host} verified via ${result.method.toUpperCase()} — now active`);
    }
  }
  logger.info(`dns: checked ${pending.length} pending domain(s), ${verified} verified`);
  return { checked: pending.length, verified };
}
