import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import User from '../models/User.js';

export const COOKIE_NAME = 'kap_token';

export function signToken(user) {
  return jwt.sign({ uid: String(user._id), role: user.role, email: user.email }, config.jwtSecret, {
    expiresIn: '7d',
  });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
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
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return next();
}
