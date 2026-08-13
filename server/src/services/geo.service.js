import geoip from 'geoip-lite';

const EMPTY = { country: 'XX', region: '', city: '' };

/** Free MaxMind-Lite lookup - no external calls, purely local database. */
export function lookupGeo(ip) {
  if (!ip) return EMPTY;
  try {
    const clean = normalizeIp(ip);
    const g = geoip.lookup(clean);
    if (!g) return EMPTY;
    return {
      country: (g.country || 'XX').toUpperCase(),
      region: g.region || '',
      city: g.city || '',
    };
  } catch {
    return EMPTY;
  }
}

/** Strip the IPv6-mapped-IPv4 prefix and any port suffix. */
export function normalizeIp(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') s = '127.0.0.1';
  return s;
}

/**
 * Client IP resolution. Trusts X-Forwarded-For only because the tracker is meant
 * to sit behind nginx/Cloudflare; app.set('trust proxy') controls req.ip too.
 */
export function clientIp(req) {
  const cf = req.get('cf-connecting-ip');
  if (cf) return normalizeIp(cf);
  const xff = req.get('x-forwarded-for');
  if (xff) return normalizeIp(xff.split(',')[0]);
  return normalizeIp(req.ip || req.socket?.remoteAddress || '');
}
