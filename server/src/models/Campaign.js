import mongoose from 'mongoose';

const pathOfferSchema = new mongoose.Schema(
  {
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true },
    weight: { type: Number, default: 100, min: 0 },
  },
  { _id: false }
);

const pathLanderSchema = new mongoose.Schema(
  {
    landerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lander', required: true },
    weight: { type: Number, default: 100, min: 0 },
  },
  { _id: false }
);

const pathSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    weight: { type: Number, default: 100, min: 0 },
    directLinking: { type: Boolean, default: false },
    // Single-lander form kept for backward compatibility; `landers` wins when set
    landerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lander', default: null },
    landers: { type: [pathLanderSchema], default: [] },
    offers: { type: [pathOfferSchema], default: [] },
  },
  { _id: false }
);

const ruleSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    conditions: {
      country: { type: [String], default: [] }, // ISO-2, upper case
      device: { type: [String], default: [] }, // desktop | mobile | tablet
      os: { type: [String], default: [] },
      browser: { type: [String], default: [] },
      // Hour-of-day window in the report timezone, inclusive; null disables it
      timeRange: {
        from: { type: Number, default: null, min: 0, max: 23 },
        to: { type: Number, default: null, min: 0, max: 23 },
      },
    },
    pathIndex: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/** An outbound URL fired server-side when a click or conversion happens. */
const forwardSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    url: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
  {
    /**
     * Who this belongs to. Admins see every record; a user sees only their own,
     * so scoping happens on this one field rather than per-route.
     */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    trafficSourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrafficSource', default: null },
    // Tracking domain the click links are built on. Null falls back to the
    // default domain, and then to BASE_URL.
    domainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', default: null },
    costModel: {
      type: String,
      enum: ['cpc', 'cpm', 'manual', 'fromToken'],
      default: 'cpc',
    },
    costValue: { type: Number, default: 0 },
    paths: { type: [pathSchema], default: [] },
    rules: { type: [ruleSchema], default: [] },
    tags: { type: [String], default: [], index: true },
    // 302 = normal redirect; meta = HTML meta-refresh, which hides the referrer
    redirectType: { type: String, enum: ['302', 'meta'], default: '302' },
    // Conversion postbacks forwarded back to the traffic source
    postbackForwarding: { type: [forwardSchema], default: [] },
    // Fired on every non-bot click
    clickForwarding: { type: [forwardSchema], default: [] },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'campaigns' }
);

export const Campaign = mongoose.model('Campaign', campaignSchema);
export default Campaign;
