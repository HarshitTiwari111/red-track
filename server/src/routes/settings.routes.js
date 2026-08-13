import express from 'express';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { asyncRoute } from '../middleware/error.js';
import { requireAdmin } from '../middleware/auth.js';
import { getSettings, updateSettings } from '../services/settings.service.js';
import { sendTelegram, telegramEnabled } from '../services/telegram.service.js';
import { newApiKey } from '../utils/ids.js';
import { str, num, bool, isObjectId, badRequest, notFound, oneOf } from '../utils/validate.js';

const router = express.Router();

/* ---------------------------------------------------------------- settings */
router.get(
  '/settings',
  asyncRoute(async (req, res) => {
    const settings = await getSettings({ force: true });
    res.json({ ...settings, telegramConfigured: telegramEnabled() });
  })
);

router.put(
  '/settings',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (Array.isArray(b.botUaPatterns)) {
      patch.botUaPatterns = b.botUaPatterns.map((p) => str(p, 120)).filter(Boolean);
    }
    if (Array.isArray(b.blockedIpRanges)) {
      patch.blockedIpRanges = b.blockedIpRanges.map((p) => str(p, 64)).filter(Boolean);
    }
    if (b.rawClickRetentionDays !== undefined) {
      patch.rawClickRetentionDays = Math.max(1, Math.min(num(b.rawClickRetentionDays, 90), 3650));
    }
    if (b.reportTimezone) {
      const tz = str(b.reportTimezone, 64);
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
      } catch {
        throw badRequest(`Unknown timezone: ${tz}`);
      }
      patch.reportTimezone = tz;
    }
    if (b.telegramEnabled !== undefined) patch.telegramEnabled = bool(b.telegramEnabled, true);

    const saved = await updateSettings(patch);
    res.json({ ...saved, telegramConfigured: telegramEnabled() });
  })
);

router.post(
  '/settings/telegram-test',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const result = await sendTelegram('✅ KAP Tracker test message - Telegram alerts are working.', {
      key: 'test',
      throttle: false,
    });
    res.json(result);
  })
);

/* ------------------------------------------------------------------- users */
router.get(
  '/users',
  asyncRoute(async (req, res) => {
    const users = await User.find({}).sort({ createdAt: 1 });
    res.json({ items: users.map((u) => u.toSafeJSON()) });
  })
);

router.post(
  '/users',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const email = str(req.body?.email, 190).toLowerCase();
    const password = String(req.body?.password || '');
    if (!email.includes('@')) throw badRequest('Valid email required');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');

    const user = await User.create({
      email,
      name: str(req.body?.name, 80),
      passwordHash: await bcrypt.hash(password, 10),
      role: oneOf(str(req.body?.role, 16), ['admin', 'member'], 'member'),
      apiKey: newApiKey(),
    });
    res.status(201).json(user.toSafeJSON());
  })
);

router.patch(
  '/users/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const user = await User.findById(req.params.id);
    if (!user) throw notFound();

    if (req.body?.password) {
      if (String(req.body.password).length < 8) throw badRequest('Password must be at least 8 characters');
      user.passwordHash = await bcrypt.hash(String(req.body.password), 10);
    }
    if (req.body?.name !== undefined) user.name = str(req.body.name, 80);
    if (req.body?.role) user.role = oneOf(str(req.body.role, 16), ['admin', 'member'], user.role);
    if (req.body?.active !== undefined) user.active = bool(req.body.active, true);
    await user.save();
    res.json(user.toSafeJSON());
  })
);

router.post(
  '/users/:id/rotate-api-key',
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { apiKey: newApiKey() } }, { new: true });
    if (!user) throw notFound();
    res.json(user.toSafeJSON());
  })
);

router.delete(
  '/users/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) throw badRequest('Invalid id');
    if (String(req.user.uid) === String(req.params.id)) throw badRequest('You cannot delete your own account');
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) throw notFound();
    res.json({ ok: true });
  })
);

export default router;
