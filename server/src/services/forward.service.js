import { replaceMacros } from './macro.service.js';
import { PostbackLog } from '../models/Logs.js';
import logger from '../utils/logger.js';

/**
 * Server-to-server forwarding: fire configured URLs (with macros replaced) when a
 * click or a conversion happens. Used to push conversions back to the traffic
 * source so its own optimiser can learn from them.
 *
 * Always fire-and-forget - a slow or broken third-party endpoint must never delay
 * a redirect or a postback response.
 */
export function fireForwards(list, ctx, kind = 'forward') {
  if (!Array.isArray(list) || list.length === 0) return;

  for (const entry of list) {
    if (!entry?.enabled || !entry?.url) continue;

    let url;
    try {
      url = replaceMacros(entry.url, ctx);
    } catch (err) {
      logger.warn(`forward macro failed (${entry.name || kind}): ${err.message}`);
      continue;
    }
    if (!/^https?:\/\//i.test(url)) {
      logForward(false, kind, entry, url, 'not an http(s) URL');
      continue;
    }

    fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'KAP-Tracker/1.0 (+forwarder)' },
    })
      .then((res) => {
        if (!res.ok) logForward(false, kind, entry, url, `HTTP ${res.status}`);
      })
      .catch((err) => logForward(false, kind, entry, url, err.message));
  }
}

function logForward(ok, kind, entry, url, reason) {
  logger.warn(`${kind} forward failed (${entry.name || 'unnamed'}): ${reason}`);
  PostbackLog.create({
    ok,
    kind,
    reason: `${entry.name || 'unnamed'}: ${reason}`,
    query: { url },
  }).catch(() => {});
}

export default fireForwards;
