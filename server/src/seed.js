import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import mongoose from 'mongoose';

import config from './config/env.js';
import logger from './utils/logger.js';
import { connectDb } from './db/connect.js';
import { ensureIndexes } from './db/indexes.js';
import User from './models/User.js';
import TrafficSource from './models/TrafficSource.js';
import AffiliateNetwork from './models/AffiliateNetwork.js';
import Offer from './models/Offer.js';
import Lander from './models/Lander.js';
import Campaign from './models/Campaign.js';
import Settings from './models/Settings.js';
import { newApiKey, newSecurityKey } from './utils/ids.js';

const SOURCE_TEMPLATES = [
  {
    name: 'Google Ads',
    slug: 'google-ads',
    paramTemplate:
      'sub1={keyword}&sub2={matchtype}&sub3={device}&sub4={network}&sub5={placement}&sub6={campaignid}&gclid={gclid}',
    tokens: {
      sub1: '{keyword}',
      sub2: '{matchtype}',
      sub3: '{device}',
      sub4: '{network}',
      sub5: '{placement}',
      sub6: '{campaignid}',
      gclid: '{gclid}',
    },
    costParam: 'cost',
    clickIdParam: 'gclid',
    notes: 'ValueTrack parameters. Use the no-redirect /track.js script on landers to keep the real URL visible.',
  },
  {
    name: 'Facebook Ads',
    slug: 'facebook-ads',
    paramTemplate: 'sub1={{ad.id}}&sub2={{adset.id}}&sub3={{campaign.id}}&sub4={{placement}}&fbclid={fbclid}',
    tokens: {
      sub1: '{{ad.id}}',
      sub2: '{{adset.id}}',
      sub3: '{{campaign.id}}',
      sub4: '{{placement}}',
      fbclid: '{fbclid}',
    },
    costParam: 'cost',
    clickIdParam: 'fbclid',
    notes: 'Meta dynamic URL parameters.',
  },
  {
    name: 'TikTok Ads',
    slug: 'tiktok-ads',
    paramTemplate: 'sub1=__CAMPAIGN_ID__&sub2=__AID__&sub3=__CID__&sub4=__PLACEMENT__&ttclid=__CLICKID__',
    tokens: {
      sub1: '__CAMPAIGN_ID__',
      sub2: '__AID__',
      sub3: '__CID__',
      sub4: '__PLACEMENT__',
      ttclid: '__CLICKID__',
    },
    costParam: 'cost',
    clickIdParam: 'ttclid',
    notes: 'TikTok macro set.',
  },
  {
    name: 'Push / Pop Network',
    slug: 'push-pop',
    paramTemplate: 'sub1={subid}&sub2={site_id}&sub3={creative_id}&cost={cpc}',
    tokens: { sub1: '{subid}', sub2: '{site_id}', sub3: '{creative_id}', cost: '{cpc}' },
    costParam: 'cost',
    clickIdParam: '',
    notes: 'Generic subid + cost token template - works with most push/pop networks.',
  },
  {
    name: 'Organic / Direct',
    slug: 'organic-direct',
    paramTemplate: 'sub1=organic',
    tokens: { sub1: 'organic' },
    costParam: '',
    clickIdParam: '',
    notes: 'Untracked / free traffic.',
  },
];

async function seed() {
  await connectDb();
  await ensureIndexes();

  /* ------------------------------------------------------------- settings */
  await Settings.findByIdAndUpdate('global', {}, { upsert: true, setDefaultsOnInsert: true, new: true });

  /* ----------------------------------------------------------- admin user */
  let adminPassword = null;
  let admin = await User.findOne({ email: config.seedAdminEmail.toLowerCase() });
  if (!admin) {
    adminPassword = config.seedAdminPassword || `kap-${nanoid(12)}`;
    admin = await User.create({
      email: config.seedAdminEmail.toLowerCase(),
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'admin',
      apiKey: newApiKey(),
    });
  }

  /* -------------------------------------------------------- traffic sources */
  for (const t of SOURCE_TEMPLATES) {
    await TrafficSource.updateOne(
      { name: t.name },
      { $setOnInsert: { ...t, status: 'active' } },
      { upsert: true }
    );
  }

  /* ------------------------------------------------------------ demo data */
  let network = await AffiliateNetwork.findOne({ name: 'Demo Network' });
  if (!network) {
    network = await AffiliateNetwork.create({
      name: 'Demo Network',
      postbackSecurityKey: newSecurityKey(),
      paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
      notes: 'Seeded example network. Send postbacks to /postback?clickid={clickid}&payout={payout}&key=<securityKey>',
    });
  }

  let offer = await Offer.findOne({ name: 'Demo Offer - Sweepstakes' });
  if (!offer) {
    offer = await Offer.create({
      name: 'Demo Offer - Sweepstakes',
      networkId: network._id,
      url: 'https://example.com/offer?click_id={clickid}&s1={sub1}&geo={country}&dev={device}',
      payoutType: 'fixed',
      defaultPayout: 25,
      geo: ['IN', 'US'],
      status: 'active',
      notes: 'Seeded demo offer - replace the URL with a real one.',
    });
  }

  let lander = await Lander.findOne({ name: 'Demo Lander - Quiz' });
  if (!lander) {
    lander = await Lander.create({
      name: 'Demo Lander - Quiz',
      url: 'https://example.com/quiz?clickid={clickid}&country={country}',
      status: 'active',
      notes: 'Seeded demo lander. Its CTA should link to /go.',
    });
  }

  const googleSource = await TrafficSource.findOne({ name: 'Google Ads' });

  let campaign = await Campaign.findOne({ slug: 'demo-campaign' });
  if (!campaign) {
    campaign = await Campaign.create({
      name: 'Demo Campaign',
      slug: 'demo-campaign',
      trafficSourceId: googleSource?._id || null,
      costModel: 'cpc',
      costValue: 0.15,
      status: 'active',
      paths: [
        {
          name: 'Lander path',
          weight: 70,
          directLinking: false,
          landerId: lander._id,
          offers: [{ offerId: offer._id, weight: 100 }],
        },
        {
          name: 'Direct link path',
          weight: 30,
          directLinking: true,
          landerId: null,
          offers: [{ offerId: offer._id, weight: 100 }],
        },
      ],
      rules: [
        {
          name: 'India mobile -> direct link',
          pathIndex: 1,
          conditions: {
            country: ['IN'],
            device: ['mobile'],
            os: [],
            browser: [],
            timeRange: { from: null, to: null },
          },
        },
      ],
      notes: 'Seeded demo campaign used by TEST_CHECKLIST.md',
    });
  }

  /* ------------------------------------------------------------- summary */
  const line = '='.repeat(64);
  console.log(`\n${line}`);
  console.log('  KAP Tracker - seed complete');
  console.log(line);
  console.log(`  Admin email    : ${admin.email}`);
  if (adminPassword) {
    console.log(`  Admin password : ${adminPassword}    <-- shown once, save it now`);
  } else {
    console.log('  Admin password : (unchanged - user already existed)');
  }
  console.log(`  Admin API key  : ${admin.apiKey}`);
  console.log(line);
  console.log(`  Demo campaign  : ${config.baseUrl}/c/${campaign.slug}`);
  console.log(`  Demo network   : ${network.name}  key=${network.postbackSecurityKey}`);
  console.log(`  Postback URL   : ${config.baseUrl}/postback?clickid={clickid}&payout={payout}&txid={txid}&status=approved&key=${network.postbackSecurityKey}`);
  console.log(`${line}\n`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  logger.error('seed failed:', err);
  process.exit(1);
});
