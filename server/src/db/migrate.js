import User from '../models/User.js';
import Campaign from '../models/Campaign.js';
import Offer from '../models/Offer.js';
import Lander from '../models/Lander.js';
import TrafficSource from '../models/TrafficSource.js';
import AffiliateNetwork from '../models/AffiliateNetwork.js';
import FunnelTemplate from '../models/FunnelTemplate.js';
import MetaPixel from '../models/MetaPixel.js';
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

  /**
   * Pixels used to be typed into each channel and offer. They now live in one
   * list, so each embedded copy becomes a real pixel - or joins the one that
   * already has its id - and the record keeps a reference instead. Nothing is
   * thrown away: the embedded array is only cleared once its rows have a home.
   */
  let lifted = 0;
  for (const Model of [TrafficSource, Offer]) {
    // eslint-disable-next-line no-await-in-loop
    const docs = await Model.find({ 'capiPixels.0': { $exists: true } });
    for (const doc of docs) {
      const ids = [...(doc.capiPixelIds || [])];
      for (const p of doc.capiPixels) {
        if (!p.pixelId) continue;
        // eslint-disable-next-line no-await-in-loop
        let pixel = await MetaPixel.findOne({ pixelId: p.pixelId });
        if (!pixel) {
          // eslint-disable-next-line no-await-in-loop
          pixel = await MetaPixel.create({
            ownerId: doc.ownerId || admin._id,
            title: p.label || `Pixel ${p.pixelId}`,
            pixelId: p.pixelId,
            apiKey: p.accessToken || '',
            testEventCode: p.testEventCode || '',
            status: p.enabled === false ? 'paused' : 'active',
          });
          lifted += 1;
        }
        if (!ids.some((x) => String(x) === String(pixel._id))) ids.push(pixel._id);
      }
      doc.capiPixelIds = ids;
      doc.capiPixels = [];
      // eslint-disable-next-line no-await-in-loop
      await doc.save();
    }
  }
  if (lifted) logger.info(`migrate: ${lifted} embedded pixel(s) moved into CAPI Integrations`);
}

export default runMigrations;
