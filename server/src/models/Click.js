import mongoose from 'mongoose';

const clickSchema = new mongoose.Schema(
  {
    clickid: { type: String, required: true, unique: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
    ts: { type: Date, default: Date.now, index: true },
    ip: { type: String, default: '' },
    ua: { type: String, default: '' },
    uaParsed: {
      device: { type: String, default: 'unknown' },
      os: { type: String, default: 'unknown' },
      browser: { type: String, default: 'unknown' },
      osVersion: { type: String, default: '' },
      browserVersion: { type: String, default: '' },
      brand: { type: String, default: '' },
      model: { type: String, default: '' },
    },
    // Primary language from the Accept-Language header, e.g. "en-GB"
    language: { type: String, default: '' },
    geo: {
      country: { type: String, default: 'XX' },
      region: { type: String, default: '' },
      city: { type: String, default: '' },
    },
    referer: { type: String, default: '' },
    // sub1..sub10 stored flat for cheap indexing/aggregation
    sub1: { type: String, default: '' },
    sub2: { type: String, default: '' },
    sub3: { type: String, default: '' },
    sub4: { type: String, default: '' },
    sub5: { type: String, default: '' },
    sub6: { type: String, default: '' },
    sub7: { type: String, default: '' },
    sub8: { type: String, default: '' },
    sub9: { type: String, default: '' },
    sub10: { type: String, default: '' },
    sub11: { type: String, default: '' },
    sub12: { type: String, default: '' },
    sub13: { type: String, default: '' },
    sub14: { type: String, default: '' },
    sub15: { type: String, default: '' },
    sub16: { type: String, default: '' },
    sub17: { type: String, default: '' },
    sub18: { type: String, default: '' },
    sub19: { type: String, default: '' },
    sub20: { type: String, default: '' },
    // UTM-style parameters captured straight off the click URL
    utm: {
      source: { type: String, default: '' },
      medium: { type: String, default: '' },
      campaign: { type: String, default: '' },
      adgroup: { type: String, default: '' },
      ad: { type: String, default: '' },
      placement: { type: String, default: '' },
      keyword: { type: String, default: '' },
      // The platform's own ids for the same three things. Kept alongside the
      // names because the names change while the ids do not, and the ids are
      // what the platform's API and its reports key on.
      campaignId: { type: String, default: '' },
      adgroupId: { type: String, default: '' },
      adId: { type: String, default: '' },
      placementId: { type: String, default: '' },
      pubId: { type: String, default: '' },
      placementHashed: { type: String, default: '' },
      // Spare named slots for networks whose values fit none of the above
      role1: { type: String, default: '' },
      role2: { type: String, default: '' },
    },
    gclid: { type: String, default: '' },
    fbclid: { type: String, default: '' },
    ttclid: { type: String, default: '' },
    cost: { type: Number, default: 0 },
    pathIndex: { type: Number, default: 0 },
    landerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lander', default: null },
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
    finalUrl: { type: String, default: '' },
    botFlag: { type: Boolean, default: false, index: true },
    /**
     * Why it was flagged. The flag alone cannot tell an operator whether to
     * widen a blocklist or loosen a user-agent rule, which is the only reason
     * anyone looks at it.
     */
    botReason: { type: String, enum: ['', 'ua', 'ip'], default: '' },
    isUnique: { type: Boolean, default: true },
    lpClick: { type: Boolean, default: false },
    converted: { type: Boolean, default: false },
    source: { type: String, default: '' }, // traffic source name snapshot
    entry: { type: String, enum: ['redirect', 'pageview'], default: 'redirect' },
  },
  { collection: 'clicks', versionKey: false }
);

clickSchema.index({ campaignId: 1, ts: -1 });
clickSchema.index({ ts: -1 });

export const Click = mongoose.model('Click', clickSchema);
export default Click;
