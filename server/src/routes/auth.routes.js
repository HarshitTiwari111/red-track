import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { signToken, setAuthCookie, clearAuthCookie, requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/error.js';
import { str } from '../utils/validate.js';

const router = express.Router();

// 5 attempts per 10 minutes per IP, as specified.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again in 10 minutes.' },
});

router.post(
  '/login',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const email = str(req.body?.email, 190).toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email, active: true });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    setAuthCookie(res, signToken(user));
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
