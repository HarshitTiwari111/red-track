import mongoose from 'mongoose';

const TTL_DAYS = 14;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

const postbackLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now },
    ok: { type: Boolean, default: true, index: true },
    reason: { type: String, default: '' },
    clickid: { type: String, default: '' },
    networkId: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateNetwork', default: null },
    ip: { type: String, default: '' },
    query: { type: mongoose.Schema.Types.Mixed, default: {} },
    kind: { type: String, default: 'postback' }, // postback | pixel
    /**
     * Copied off the click the postback resolved to, so the log can be read and
     * filtered on its own. Denormalised on purpose: a click older than the raw
     * retention window is gone, and the log still has to make sense afterwards.
     */
    refId: { type: String, default: '' }, // the network's own transaction id
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
    source: { type: String, default: '' }, // traffic channel name snapshot
    type: { type: String, default: '' }, // conversion event name
    url: { type: String, default: '' }, // the full URL the caller hit
  },
  { collection: 'postback_logs', versionKey: false }
);
postbackLogSchema.index({ ts: 1 }, { expireAfterSeconds: TTL_SECONDS });

export const PostbackLog = mongoose.model('PostbackLog', postbackLogSchema);

const clickErrorLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now },
    route: { type: String, default: '' },
    reason: { type: String, default: '' },
    slug: { type: String, default: '' },
    ip: { type: String, default: '' },
    query: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { collection: 'click_error_logs', versionKey: false }
);
clickErrorLogSchema.index({ ts: 1 }, { expireAfterSeconds: TTL_SECONDS });

export const ClickErrorLog = mongoose.model('ClickErrorLog', clickErrorLogSchema);
