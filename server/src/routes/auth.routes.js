import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { signToken, setAuthCookie, clearAuthCookie, requireAuth } from '../middleware/auth.js';
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
    // Writes the 'login' audit row itself, stamped with the device, and warns
    // the operator if this one has not been seen before. Never awaited.
    noticeSignIn(req, user);
    return res.json({ user: user.toSafeJSON() });
  })
);

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

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
