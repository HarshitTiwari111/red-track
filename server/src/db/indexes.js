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
import RateLimit from '../models/RateLimit.js';

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
  RateLimit,
];

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Indexes a previous version declared under a key that no longer exists. The
 * repair below only reconciles indexes whose key still matches something in the
 * schema, so a renamed key would otherwise leave the old one enforcing a
 * constraint nothing declares any more.
 */
const RETIRED = {
  // Superseded by { networkId, txid, dupeSeq }, which lets an offer source keep
  // the network's transaction id on every repeat instead of suffixing it.
  Conversion: ['networkId_1_txid_1'],
};

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

  for (const name of RETIRED[model.modelName] || []) {
    if (!existing.some((i) => i.name === name)) continue;
    try {
      await model.collection.dropIndex(name);
      logger.info(`index ${model.modelName}.${name} dropped (retired)`);
    } catch (err) {
      logger.warn(`could not drop retired ${model.modelName}.${name}: ${err.message}`);
    }
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
