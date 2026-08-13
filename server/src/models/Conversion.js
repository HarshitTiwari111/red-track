import mongoose from 'mongoose';

const conversionSchema = new mongoose.Schema(
  {
    clickid: { type: String, required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
    networkId: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateNetwork', default: null },
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
    ts: { type: Date, default: Date.now, index: true },
    type: { type: String, default: 'lead' }, // lead | sale | deposit | custom
    payout: { type: Number, default: 0 },
    txid: { type: String, default: '' },
    status: {
      type: String,
      enum: ['approved', 'pending', 'rejected'],
      default: 'approved',
      index: true,
    },
    // ---------------------------------------------------------------------
    // Snapshot of the click, taken when the conversion is recorded. Keeping it
    // here means the conversions grid renders from one collection with no joins,
    // and stats can be rebuilt even after the raw click is pruned by retention.
    // ---------------------------------------------------------------------
    country: { type: String, default: 'XX' },
    city: { type: String, default: '' },
    device: { type: String, default: 'unknown' },
    os: { type: String, default: '' },
    browser: { type: String, default: '' },
    ip: { type: String, default: '' },
    ua: { type: String, default: '' },
    cost: { type: Number, default: 0 },
    landerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lander', default: null },
    deeplink: { type: String, default: '' }, // the offer URL the visitor was sent to
    clickTs: { type: Date, default: null },
    // sub1..sub20 of the click, stored positionally to avoid 20 schema fields
    clickSubs: { type: [String], default: [] },
    utm: {
      source: { type: String, default: '' },
      medium: { type: String, default: '' },
      campaign: { type: String, default: '' },
      adgroup: { type: String, default: '' },
      ad: { type: String, default: '' },
      placement: { type: String, default: '' },
      keyword: { type: String, default: '' },
    },

    // ---------------------------------------------------------------------
    // Values that arrive with the postback itself
    // ---------------------------------------------------------------------
    convSubs: { type: [String], default: [] }, // convSub1..convSub20 (or sub1..sub20)
    postbackIp: { type: String, default: '' },
    event: { type: String, default: '' },
    coupon: { type: String, default: '' },
    refId: { type: String, default: '' },
    publisherRevenue: { type: Number, default: 0 },
    // How many further postbacks arrived for the same (network, txid)
    duplicateHits: { type: Number, default: 0 },

    rawQuery: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, default: 'postback' }, // postback | pixel | manual
  },
  { collection: 'conversions', versionKey: false, timestamps: true }
);

// Dedupe: one txid per network. The partial filter keeps blank txids out of the
// index entirely, so conversions without a transaction id never collide.
conversionSchema.index(
  { networkId: 1, txid: 1 },
  { unique: true, partialFilterExpression: { txid: { $type: 'string', $gt: '' } } }
);
conversionSchema.index({ campaignId: 1, ts: -1 });

export const Conversion = mongoose.model('Conversion', conversionSchema);
export default Conversion;
