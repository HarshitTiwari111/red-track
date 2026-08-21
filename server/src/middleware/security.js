import helmet from 'helmet';
import config from '../config/env.js';

/**
 * Security headers for everything this app serves.
 *
 * The four headers written by hand before were the easy ones. What was missing
 * is the one that actually contains an XSS: a Content-Security-Policy. Without
 * it, a script that gets injected anywhere in the dashboard may load code from
 * any host and post the session wherever it likes.
 *
 * The policy is written out rather than left to helmet's default because the
 * default forbids two things this build does legitimately - see below.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // The Vite build emits one external module script; nothing is inline.
      scriptSrc: ["'self'"],
      /*
       * React writes `style={{...}}` as an inline style attribute, and the
       * dashboard uses them throughout, so this cannot be dropped without
       * rewriting every one into a class. It is the weakest line here, and it
       * is worth knowing that: an injected style attribute is possible, an
       * injected script is not.
       */
      styleSrc: ["'self'", "'unsafe-inline'"],
      // The favicon is an inline SVG data: URI in index.html
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      // The dashboard only ever talks to its own API
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  /*
   * HSTS only in production. Sent over plain http a browser ignores it, but
   * setting it in development would still be a lie about an install that has
   * no certificate.
   */
  hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  // Third-party landers load /track.js and /pixel.gif from here
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Would break those same cross-origin loads
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'sameorigin' },
});

/**
 * CORS is locked to the tracker's own origin. In development the Vite dev server
 * proxies /api, so no cross-origin request should ever be needed.
 */
export function lockedCors(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin === config.baseUrl) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, X-View-As');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}

/** Open CORS, used only by the public pageview endpoint called from any lander. */
export function openCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', req.get('origin') || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}
