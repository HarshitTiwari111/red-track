import config from '../config/env.js';

/** Minimal security headers - only applied to dashboard/API routes, never to /c. */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
}

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
