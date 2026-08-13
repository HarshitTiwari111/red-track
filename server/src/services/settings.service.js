import Settings, { DEFAULT_BOT_UA_PATTERNS } from '../models/Settings.js';
import logger from '../utils/logger.js';

let cached = null;
let loadedAt = 0;
const TTL_MS = 30_000;

export const DEFAULT_SETTINGS = {
  _id: 'global',
  botUaPatterns: DEFAULT_BOT_UA_PATTERNS,
  blockedIpRanges: [],
  rawClickRetentionDays: 90,
  reportTimezone: 'Asia/Kolkata',
  telegramEnabled: true,
};

/** Synchronous read used by the hot click path - never awaits the DB. */
export function getSettingsSync() {
  return cached || DEFAULT_SETTINGS;
}

export async function getSettings({ force = false } = {}) {
  if (!force && cached && Date.now() - loadedAt < TTL_MS) return cached;
  try {
    const doc =
      (await Settings.findById('global').lean()) ||
      (await Settings.create({ _id: 'global' })).toObject();
    cached = doc;
    loadedAt = Date.now();
    onChangeHandlers.forEach((h) => h(cached));
  } catch (err) {
    logger.warn('settings load failed, using defaults:', err.message);
    cached = cached || DEFAULT_SETTINGS;
  }
  return cached;
}

export async function updateSettings(patch) {
  const doc = await Settings.findByIdAndUpdate(
    'global',
    { $set: patch },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  cached = doc;
  loadedAt = Date.now();
  onChangeHandlers.forEach((h) => h(cached));
  return doc;
}

const onChangeHandlers = [];
export const onSettingsChange = (fn) => onChangeHandlers.push(fn);
