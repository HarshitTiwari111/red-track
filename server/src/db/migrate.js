import User from '../models/User.js';
import Campaign from '../models/Campaign.js';
import Offer from '../models/Offer.js';
import Lander from '../models/Lander.js';
import TrafficSource from '../models/TrafficSource.js';
import AffiliateNetwork from '../models/AffiliateNetwork.js';
import FunnelTemplate from '../models/FunnelTemplate.js';
import logger from '../utils/logger.js';

const OWNED = [Campaign, Offer, Lander, TrafficSource, AffiliateNetwork, FunnelTemplate];

/**
 * Small forward-only migrations, run on boot. Each one is a no-op once applied,
 * so a restart costs a handful of counted queries and nothing else.
 */
export async function runMigrations() {
  /* The second role was called "member" before it was called "user". */
  const renamed = await User.updateMany({ role: 'member' }, { $set: { role: 'user' } });
  if (renamed.modifiedCount) logger.info(`migrate: ${renamed.modifiedCount} user(s) renamed from member to user`);

  /**
   * Records created before ownership existed have no owner, which would make
   * them invisible to everyone but an admin. Give them to the first admin so
   * nothing disappears from an existing install.
   */
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean();
  if (!admin) return;

  let adopted = 0;
  for (const Model of OWNED) {
    // eslint-disable-next-line no-await-in-loop
    const r = await Model.updateMany({ ownerId: null }, { $set: { ownerId: admin._id } });
    adopted += r.modifiedCount || 0;
  }
  if (adopted) logger.info(`migrate: ${adopted} unowned record(s) assigned to ${admin.email}`);
}

export default runMigrations;
