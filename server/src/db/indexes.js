import logger from '../utils/logger.js';
import User from '../models/User.js';
import TrafficSource from '../models/TrafficSource.js';
import AffiliateNetwork from '../models/AffiliateNetwork.js';
import Offer from '../models/Offer.js';
import Lander from '../models/Lander.js';
import Campaign from '../models/Campaign.js';
import Click from '../models/Click.js';
import Conversion from '../models/Conversion.js';
import { StatsHourly, StatsSubs } from '../models/Stats.js';
import { PostbackLog, ClickErrorLog } from '../models/Logs.js';
import Settings from '../models/Settings.js';
import CostEntry from '../models/CostEntry.js';
import Domain from '../models/Domain.js';
import FunnelTemplate from '../models/FunnelTemplate.js';

const MODELS = [
  User,
  TrafficSource,
  AffiliateNetwork,
  Offer,
  Lander,
  Campaign,
  Click,
  Conversion,
  StatsHourly,
  StatsSubs,
  PostbackLog,
  ClickErrorLog,
  Settings,
  CostEntry,
  Domain,
  FunnelTemplate,
];

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const optionsDiffer = (existing, declared) => {
  const ttlA = existing.expireAfterSeconds;
  const ttlB = declared.expireAfterSeconds;
  if ((ttlA ?? null) !== (ttlB ?? null)) return true;
  if (Boolean(existing.unique) !== Boolean(declared.unique)) return true;
  if (Boolean(existing.sparse) !== Boolean(declared.sparse)) return true;
  return (
    JSON.stringify(existing.partialFilterExpression || null) !==
    JSON.stringify(declared.partialFilterExpression || null)
  );
};

/**
 * Drop indexes that share a key with a declared index but were built with
 * different options (TTL added later, unique/partial changed, ...). Without this
 * Mongo refuses to rebuild them and the new definition silently never applies.
 */
async function repairIndexes(model) {
  const declared = model.schema.indexes(); // [[keys, options], ...]
  let existing;
  try {
    existing = await model.collection.indexes();
  } catch {
    return; // collection does not exist yet - nothing to repair
  }

  for (const idx of existing) {
    if (idx.name === '_id_') continue;
    const match = declared.find(([keys]) => sameKey(keys, idx.key));
    if (!match) continue;
    if (optionsDiffer(idx, match[1] || {})) {
      try {
        await model.collection.dropIndex(idx.name);
        logger.info(`index ${model.modelName}.${idx.name} dropped for rebuild (options changed)`);
      } catch (err) {
        logger.warn(`could not drop ${model.modelName}.${idx.name}: ${err.message}`);
      }
    }
  }
}

/**
 * Build every declared index explicitly on boot. Failures are logged but never
 * fatal - an index conflict must not stop the tracker from serving clicks.
 */
export async function ensureIndexes() {
  for (const model of MODELS) {
    try {
      await repairIndexes(model);
      await model.createIndexes();
    } catch (err) {
      logger.warn(`index build failed for ${model.modelName}: ${err.message}`);
    }
  }
  logger.info(`Indexes ensured for ${MODELS.length} collections`);
}

export default ensureIndexes;
