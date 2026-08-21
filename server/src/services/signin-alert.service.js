import crypto from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import AuditLog from '../models/AuditLog.js';
import { lookupGeo, normalizeIp } from './geo.service.js';
import { sendTelegram } from './telegram.service.js';
import { recordAudit } from './audit.service.js';
import logger from '../utils/logger.js';

/**
 * Tell the operator when an account signs in from somewhere it has not signed
 * in from before.
 *
 * A stolen password is silent by design: the thief sees exactly what the owner
 * sees, and the owner sees nothing at all. This is the cheapest thing that
 * breaks that silence, and it needs no new storage - the audit log already
 * holds every prior sign-in, so "new" is simply "no earlier login row from
 * this device".
 *
 * Only new devices are announced. An alert on every sign-in is an alert nobody
 * reads by the second week.
 */

/**
 * What counts as "the same device".
 *
 * The IP's /24 rather than the address itself, because a home connection moves
 * within its block and an alert on every DHCP lease teaches people to ignore
 * these. Paired with the browser and OS, which do not change on their own.
 */
function deviceKey(ip, userAgent) {
  const clean = normalizeIp(ip);
  const block = clean.includes(':')
    ? clean.split(':').slice(0, 4).join(':') // IPv6: the routing prefix
    : clean.split('.').slice(0, 3).join('.'); // IPv4: the /24

  const ua = new UAParser(userAgent || '').getResult();
  const shape = [block, ua.browser?.name || '?', ua.os?.name || '?'].join('|');
  return crypto.createHash('sha256').update(shape).digest('hex').slice(0, 32);
}

function describe(ip, userAgent) {
  const ua = new UAParser(userAgent || '').getResult();
  const geo = lookupGeo(ip);
  const where = [geo.city, geo.country].filter((s) => s && s !== 'XX').join(', ');
  const what = [ua.browser?.name, ua.os?.name].filter(Boolean).join(' on ') || 'unknown device';
  return { where: where || 'unknown location', what };
}

/**
 * Called after a successful sign-in. Never awaited, never throws: an alert that
 * cannot be delivered must not stop someone logging in.
 */
export function noticeSignIn(req, user) {
  (async () => {
    const ip = req?.ip || '';
    const userAgent = String(req?.get?.('user-agent') || '');
    const device = deviceKey(ip, userAgent);

    /*
     * Look for an earlier sign-in from this device. The row written for THIS
     * login is excluded by time, not by id: recordAudit is fire-and-forget, so
     * it may not have landed yet and cannot be relied on either way.
     */
    const seenBefore = await AuditLog.findOne({
      userId: user._id,
      action: 'login',
      'changes.device': device,
      ts: { $lt: new Date(Date.now() - 1000) },
    })
      .select({ _id: 1 })
      .lean();

    /*
     * Stamp this login with its device so the next one can recognise it.
     *
     * The user is named explicitly: recordAudit normally reads req.user, and
     * at login time the request has not been through requireAuth, so the row
     * would record the sign-in without saying whose it was.
     */
    recordAudit(req, {
      userId: user._id,
      userEmail: user.email,
      role: user.role,
      action: 'login',
      entity: 'User',
      entityId: String(user._id),
      entityName: user.email,
      changes: { device },
      note: seenBefore ? 'known device' : 'new device',
    });

    if (seenBefore) return;

    const { where, what } = describe(ip, userAgent);
    await sendTelegram(
      `🔐 New sign-in to KAP Tracker\n` +
        `Account: ${user.email}\n` +
        `Device: ${what}\n` +
        `Location: ${where}\n` +
        `IP: ${normalizeIp(ip)}\n\n` +
        `If this was not you, change the password now.`,
      { key: `signin:${user._id}` }
    );
  })().catch((err) => logger.warn(`sign-in alert failed: ${err.message}`));
}

export default noticeSignIn;
