import crypto from 'node:crypto';
import Session from '../models/Session.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Refresh-token sessions: issue, rotate, revoke.
 *
 * See models/Session.js for why the long-lived half is a database row rather
 * than a second JWT.
 */

/** How long a refresh token lives if it is never used again. */
export const REFRESH_TTL_MS = config.refreshTokenDays * 24 * 60 * 60 * 1000;

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function newRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Start a new session - one sign-in, one family. */
export async function createSession(user, { ip = '', userAgent = '', family = null } = {}) {
  const token = newRefreshToken();
  await Session.create({
    userId: user._id,
    tokenHash: hash(token),
    family: family || crypto.randomUUID(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    ip,
    userAgent: String(userAgent).slice(0, 300),
  });
  return token;
}

/**
 * Trade a refresh token for the next one.
 *
 * Returns `{ ok, userId, family, token }` on success, or `{ ok: false, reason }`
 * - 'unknown' when the token was never issued or has already expired
 * - 'reused' when it was issued but has already been rotated away, which is
 *   the signal that someone is holding a copy
 */
export async function rotateSession(rawToken, { ip = '', userAgent = '' } = {}) {
  if (!rawToken) return { ok: false, reason: 'unknown' };

  const current = await Session.findOne({ tokenHash: hash(rawToken) });
  if (!current) return { ok: false, reason: 'unknown' };

  if (current.revokedAt || current.expiresAt <= new Date()) {
    /*
     * An expired token is simply over. A revoked one is different: it worked
     * once, so a copy exists, and the copy is either the thief's or the
     * owner's. Nothing here can tell them apart, so the safe answer is to end
     * every session descended from that sign-in.
     */
    if (current.revokedAt) {
      await revokeFamily(current.family, 'reuse detected');
      return { ok: false, reason: 'reused', userId: current.userId, family: current.family };
    }
    return { ok: false, reason: 'unknown' };
  }

  const next = newRefreshToken();
  const created = await Session.create({
    userId: current.userId,
    tokenHash: hash(next),
    family: current.family,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    ip,
    userAgent: String(userAgent).slice(0, 300),
  });

  current.revokedAt = new Date();
  current.reason = 'rotated';
  current.lastUsedAt = new Date();
  await current.save();

  return { ok: true, userId: current.userId, family: current.family, token: next, sessionId: created._id };
}

/** End one session - what logout does. */
export async function revokeToken(rawToken, reason = 'logout') {
  if (!rawToken) return;
  try {
    await Session.updateOne(
      { tokenHash: hash(rawToken), revokedAt: null },
      { $set: { revokedAt: new Date(), reason } }
    );
  } catch (err) {
    logger.warn(`session revoke failed: ${err.message}`);
  }
}

export async function revokeFamily(family, reason = 'revoked') {
  try {
    await Session.updateMany({ family, revokedAt: null }, { $set: { revokedAt: new Date(), reason } });
  } catch (err) {
    logger.warn(`session family revoke failed: ${err.message}`);
  }
}

/** Every session for one user - used when a password changes. */
export async function revokeAllForUser(userId, reason = 'password changed') {
  try {
    await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), reason } });
  } catch (err) {
    logger.warn(`session user revoke failed: ${err.message}`);
  }
}
