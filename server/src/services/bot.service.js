import { getSettingsSync, onSettingsChange } from './settings.service.js';
import { normalizeIp } from './geo.service.js';
import logger from '../utils/logger.js';

let uaRegex = null;
let ipRules = [];

function compile(settings) {
  const patterns = settings.botUaPatterns || [];
  try {
    uaRegex = patterns.length
      ? new RegExp(patterns.map(escapeRe).join('|'), 'i')
      : null;
  } catch (err) {
    logger.warn('bot UA regex compile failed:', err.message);
    uaRegex = null;
  }
  ipRules = (settings.blockedIpRanges || []).map(parseCidr).filter(Boolean);
}

onSettingsChange(compile);

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ipToLong(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

/** Supports "1.2.3.4" and "1.2.3.0/24". IPv6 entries are matched as plain strings. */
function parseCidr(entry) {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  if (raw.includes(':')) return { type: 'exact6', value: raw.toLowerCase() };
  const [addr, bitsRaw] = raw.split('/');
  const base = ipToLong(addr);
  if (base === null) return null;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { type: 'cidr', network: (base & mask) >>> 0, mask };
}

export function isBlockedIp(ip) {
  if (!ipRules.length) return false;
  const clean = normalizeIp(ip);
  if (clean.includes(':')) return ipRules.some((r) => r.type === 'exact6' && r.value === clean.toLowerCase());
  const n = ipToLong(clean);
  if (n === null) return false;
  return ipRules.some((r) => r.type === 'cidr' && ((n & r.mask) >>> 0) === r.network);
}

export function isBotUa(ua) {
  if (!ua) return true; // no user-agent at all is not a real browser
  if (!uaRegex) compile(getSettingsSync());
  return uaRegex ? uaRegex.test(ua) : false;
}

/** Single entry point used by the click path. */
export function detectBot(ua, ip) {
  return isBotUa(ua) || isBlockedIp(ip);
}

export function initBotFilter(settings) {
  compile(settings || getSettingsSync());
}
