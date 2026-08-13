/**
 * Remove the throwaway objects created while smoke-testing:
 *   node server/src/tools/cleanup-testdata.cli.js
 *
 * Deletes the cap-test campaign and its clicks, the "Capped Test Offer*" offers,
 * the forwarding-probe clicks/conversions, clears any test forwarding config,
 * then rebuilds the affected stats buckets so reports stay clean.
 */
import mongoose from 'mongoose';
import { connectDb } from '../db/connect.js';
import { getSettings } from '../services/settings.service.js';
import { reconcileStats } from '../jobs/reconcile.job.js';
import Campaign from '../models/Campaign.js';
import Offer from '../models/Offer.js';
import Click from '../models/Click.js';
import Conversion from '../models/Conversion.js';
import { StatsHourly, StatsSubs } from '../models/Stats.js';
import logger from '../utils/logger.js';

// sub1 values used only by smoke tests
const TEST_SUB1 = ['fwd-test', 'fwd2', 'origin', 'FORWARD-PROOF', 'meta', 'noredirect-test', 'macrotest', 'cs1', 'geocheck', 'nettest', 'rot', 'funneltest', 'AD123'];
const TEST_TXIDS = ['TX-FWD-1', 'TX-FWD-2', 'TX-PROOF', 'TX-COLS-1', 'NT-1', 'EXP-1', 'EXP-2', 'WL-1', 'DUP-9', 'DUP-9#2', 'DUP-9#3', 'E2E-1'];

async function main() {
  await connectDb();
  await getSettings({ force: true });

  const campaign = await Campaign.findOne({ slug: 'cap-test' });
  if (campaign) {
    const clicks = await Click.deleteMany({ campaignId: campaign._id });
    await StatsHourly.deleteMany({ campaignId: campaign._id });
    await StatsSubs.deleteMany({ campaignId: campaign._id });
    await Campaign.deleteOne({ _id: campaign._id });
    console.log(`removed campaign "${campaign.name}" and ${clicks.deletedCount} clicks`);
  }

  const offers = await Offer.deleteMany({ name: /^Capped Test Offer/ });
  if (offers.deletedCount) console.log(`removed ${offers.deletedCount} test offers`);

  const convs = await Conversion.deleteMany({ txid: { $in: TEST_TXIDS } });
  if (convs.deletedCount) console.log(`removed ${convs.deletedCount} test conversions`);

  // Conversions added by hand during testing have no txid, so match them by the
  // clicks they hang off before those clicks are deleted.
  const probeClicks = await Click.find({ sub1: { $in: TEST_SUB1 } }, { clickid: 1 }).lean();
  if (probeClicks.length) {
    const manual = await Conversion.deleteMany({ clickid: { $in: probeClicks.map((c) => c.clickid) } });
    if (manual.deletedCount) console.log(`removed ${manual.deletedCount} conversions on probe clicks`);
  }

  const testClicks = await Click.deleteMany({ sub1: { $in: TEST_SUB1 } });
  if (testClicks.deletedCount) console.log(`removed ${testClicks.deletedCount} probe clicks`);

  const cleared = await Campaign.updateMany(
    { $or: [{ 'postbackForwarding.name': /proof|test/i }, { 'clickForwarding.name': /proof|test/i }] },
    { $set: { postbackForwarding: [], clickForwarding: [] } }
  );
  if (cleared.modifiedCount) console.log(`cleared forwarding config on ${cleared.modifiedCount} campaign(s)`);

  await StatsSubs.deleteMany({ subKey: { $in: TEST_SUB1.map((s) => `sub1:${s}`) } });

  const res = await reconcileStats({ hours: 4 });
  console.log(`rebuilt ${res.buckets} stats buckets`);

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error('cleanup failed:', err);
  process.exit(1);
});
