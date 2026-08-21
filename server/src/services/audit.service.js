import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

/**
 * Field names whose value must never reach the audit log.
 *
 * An audit trail is read by more people than the records it describes, and it
 * is the one collection nothing redacts on the way out. A token copied in here
 * "just to show what changed" would outlive every rotation of that token.
 * The name of the field is still recorded, so the change is visible without
 * the value being disclosed.
 */
const REDACT = new Set([
  'password',
  'passwordHash',
  'apiKey',
  'accessToken',
  'refreshToken',
  'developerToken',
  'metaAppSecret',
  'appSecret',
  'jwtSecret',
  'secret',
  'token',
]);

const MAX_VALUE = 300;
const MAX_DEPTH = 6;

/**
 * Replace every redacted field, at any depth.
 *
 * Checking only the top level was not enough: a traffic source keeps its token
 * at `integration.accessToken`, so the whole `integration` object changed, and
 * serialising it wrote the token into the log in full. Anything holding a
 * secret holds it one level down, which is precisely the case a top-level
 * check misses.
 */
const scrub = (v, depth = 0) => {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (depth >= MAX_DEPTH) return '[deep]';

  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));

  if (typeof v === 'object') {
    // Mongoose ObjectIds and the like: a string is what a reader wants anyway
    if (typeof v.toHexString === 'function') return v.toHexString();
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = REDACT.has(k) ? '[redacted]' : scrub(val, depth + 1);
    }
    return out;
  }

  return String(v);
};

const short = (v) => scrub(v, 0);

const same = (a, b) => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/**
 * The fields that actually changed, and what they became.
 *
 * Only the new value is kept. Keeping both sides doubles what a leak of this
 * collection is worth and, for the questions an audit log is asked - who
 * changed this, when, to what - the old value is already the previous row.
 */
export function diffFields(before, after) {
  const out = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (k === '_id' || k === '__v' || k === 'updatedAt' || k === 'createdAt') continue;
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (same(a, b)) continue;
    out[k] = REDACT.has(k) ? '[redacted]' : short(b);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Write one audit row. Never awaited by a request, and never throws: an audit
 * write that failed must not turn a successful save into a 500.
 */
export function recordAudit(req, entry) {
  const doc = {
    userId: req?.user?.uid || null,
    userEmail: req?.user?.email || '',
    role: req?.user?.role || '',
    ip: req?.ip || '',
    userAgent: String(req?.get?.('user-agent') || '').slice(0, 300),
    ...entry,
  };

  AuditLog.create(doc).catch((err) => logger.warn(`audit write failed: ${err.message}`));
}

export default recordAudit;
