import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import {
  signToken,
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  requireAuth,
  REFRESH_COOKIE,
} from '../middleware/auth.js';
import {
  createSession,
  rotateSession,
  revokeToken,
  revokeFamily,
  REFRESH_TTL_MS,
} from '../services/session.service.js';
import { notifyError } from '../services/telegram.service.js';
import { asyncRoute } from '../middleware/error.js';
import { MongoRateLimitStore } from '../services/ratelimit.service.js';
import { recordAudit } from '../services/audit.service.js';
import { noticeSignIn } from '../services/signin-alert.service.js';
import { str } from '../utils/validate.js';

const router = express.Router();

/*
 * 5 failed attempts per window per IP - and 5 across the whole install, not 5
 * per worker. The default store counts in process memory, so every extra
 * instance raised the real limit by another five and a restart cleared it; the
 * counter lives in MongoDB now, where every instance sees the same number.
 *
 * The window is short on purpose: someone who mistypes their own password
 * should not be locked out for a coffee break. It is the one number here that
 * trades safety for patience, so it is written once and read everywhere below
 * rather than repeated and left to drift.
 */
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  store: new MongoRateLimitStore({ prefix: 'login', windowMs: LOGIN_WINDOW_MS }),
  message: {
    error: `Too many login attempts. Try again in ${LOGIN_WINDOW_MS / 60000} minutes.`,
  },
});

router.post(
  '/login',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const email = str(req.body?.email, 190).toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email, active: true });
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!ok) {
      /*
       * The email is recorded even when no such user exists - a run of failures
       * against an address that was never registered is exactly the shape of a
       * list being tried, and it is invisible if only real users are logged.
       */
      recordAudit(req, {
        action: 'login_failed',
        entity: 'User',
        entityId: String(user?._id || ''),
        entityName: email,
        note: user ? 'wrong password' : 'no such account',
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    setAuthCookie(res, signToken(user));
    setRefreshCookie(
      res,
      await createSession(user, { ip: req.ip, userAgent: req.get('user-agent') }),
      REFRESH_TTL_MS
    );

    // Writes the 'login' audit row itself, stamped with the device, and warns
    // the operator if this one has not been seen before. Never awaited.
    noticeSignIn(req, user);
    return res.json({ user: user.toSafeJSON() });
  })
);

/**
 * Trade the refresh cookie for a fresh pair.
 *
 * No requireAuth: the whole point is that the access token has expired. The
 * refresh cookie is the credential, and it is checked against a row that can
 * be revoked - which is what an access token can never be.
 */
router.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE];
    const result = await rotateSession(presented, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    if (!result.ok) {
      clearAuthCookie(res);

      if (result.reason === 'reused') {
        /*
         * Loud on purpose. Every session from that sign-in has just been ended
         * by rotateSession, and the person it happened to deserves to know why
         * they were signed out - it is the one signal that a token was copied.
         */
        recordAudit(req, {
          userId: result.userId,
          action: 'refresh_reuse',
          entity: 'Session',
          entityId: String(result.family || ''),
          note: 'refresh token replayed - all sessions in this family revoked',
        });
        notifyError(
          `⚠️ KAP Tracker: a refresh token was replayed. Every session from that sign-in has been revoked. If this was not a stale browser tab, treat the account as compromised.`
        );
        return res.status(401).json({ error: 'Session ended. Please sign in again.', code: 'reused' });
      }

      return res.status(401).json({ error: 'Authentication required', code: 'unauthenticated' });
    }

    const user = await User.findById(result.userId);
    if (!user || !user.active) {
      // Deactivating an account has to end its sessions, not just its logins
      await revokeFamily(result.family, 'user inactive');
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Authentication required', code: 'unauthenticated' });
    }

    setAuthCookie(res, signToken(user));
    setRefreshCookie(res, result.token, REFRESH_TTL_MS);
    return res.json({ user: user.toSafeJSON() });
  })
);

router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    // Clearing the cookie only stops this browser sending it; the row has to
    // go too, or a copy taken earlier still refreshes.
    await revokeToken(req.cookies?.[REFRESH_COOKIE], 'logout');
    clearAuthCookie(res);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await User.findById(req.user.uid);
    if (!user || !user.active) return res.status(401).json({ error: 'Authentication required' });
    return res.json({ user: user.toSafeJSON() });
  })
);

export default router;
