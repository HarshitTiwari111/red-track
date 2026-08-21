import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import User from '../models/User.js';

export const COOKIE_NAME = 'kap_token';
export const REFRESH_COOKIE = 'kap_refresh';

/**
 * Where the refresh cookie is allowed to travel.
 *
 * Narrower than the access cookie on purpose: it is only ever read by
 * /auth/refresh and /auth/logout, so there is no reason for it to ride along
 * on the hundreds of other requests a dashboard makes. Fewer places it is
 * sent, fewer places it can leak.
 */
export const REFRESH_PATH = '/api/v1/auth';

/**
 * The access token is deliberately short-lived.
 *
 * A JWT cannot be withdrawn - this server has no way to reject one it signed.
 * Seven days of that was the whole risk: a token copied off a machine stayed
 * good for a week. Fifteen minutes bounds it, and the refresh token below,
 * which IS revocable, carries the session across.
 */
export const ACCESS_TTL_MS = config.accessTokenMinutes * 60 * 1000;

export function signToken(user) {
  return jwt.sign({ uid: String(user._id), role: user.role, email: user.email }, config.jwtSecret, {
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
  });
}

const cookieBase = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
};

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieBase, maxAge: ACCESS_TTL_MS, path: '/' });
}

export function setRefreshCookie(res, token, maxAge) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieBase, maxAge, path: REFRESH_PATH });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
}

/**
 * Accepts either the httpOnly JWT cookie (dashboard) or an X-Api-Key header
 * (server-to-server integrations). Everything under /api/v1 except the public
 * tracking endpoints goes through this.
 */
export async function requireAuth(req, res, next) {
  try {
    const apiKey = req.get('x-api-key');
    if (apiKey) {
      const user = await User.findOne({ apiKey, active: true }).lean();
      if (!user) return res.status(401).json({ error: 'Invalid API key' });
      req.user = { uid: String(user._id), role: user.role, email: user.email };
      return next();
    }

    const bearer = req.get('authorization');
    const token =
      req.cookies?.[COOKIE_NAME] ||
      (bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : null);

    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { uid: payload.uid, role: payload.role, email: payload.email };
    return next();
  } catch (err) {
    /*
     * An expired access token is the ordinary case now that they last fifteen
     * minutes, and it is the only one worth a refresh attempt. Saying so lets
     * the dashboard tell "your token aged out" from "you are not signed in",
     * instead of sending everyone to /auth/refresh to find out.
     */
    const expired = err?.name === 'TokenExpiredError';
    return res
      .status(401)
      .json({ error: 'Authentication required', code: expired ? 'token_expired' : 'unauthenticated' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return next();
}
