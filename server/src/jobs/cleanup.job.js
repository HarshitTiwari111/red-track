import Click from '../models/Click.js';
import { getSettings } from '../services/settings.service.js';
import logger from '../utils/logger.js';

/**
 * Delete raw clicks past the retention window. Aggregated stats are never
 * touched - historical reporting stays intact forever.
 */
export async function cleanupOldClicks() {
  const settings = await getSettings();
  const days = Math.max(1, Number(settings.rawClickRetentionDays) || 90);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const res = await Click.deleteMany({ ts: { $lt: cutoff } });
  if (res.deletedCount) logger.info(`cleanup: deleted ${res.deletedCount} clicks older than ${days} days`);
  return { deleted: res.deletedCount || 0, cutoff, days };
}

export default cleanupOldClicks;
