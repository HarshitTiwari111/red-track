import mongoose from 'mongoose';

/**
 * A Meta pixel, defined once and then chosen wherever conversions should be
 * sent to it.
 *
 * Keeping pixels here rather than typing an id and a token into every channel
 * and every offer is what makes "configure it in one place" possible: a token
 * rotates in one row, and everything pointing at that pixel follows.
 */

/** Meta's action_source values, plus the tracker's own default. */
export const ACTION_SOURCES = [
  'store_tracking_url',
  'website',
  'app',
  'email',
  'phone_call',
  'chat',
  'physical_store',
  'system_generated',
  'business_messaging',
  'other',
];

/**
 * Sends a conversion type under a different event name than the tracker uses.
 * Without it every conversion arrives at Meta under whatever the postback said,
 * which rarely matches the event names an ad account optimises on.
 */
const conversionMatchSchema = new mongoose.Schema(
  { conversionType: { type: String, default: '', trim: true }, eventName: { type: String, default: '', trim: true } },
  { _id: false }
);

/** Overrides the value sent for one conversion type. */
const payoutRuleSchema = new mongoose.Schema(
  { conversionType: { type: String, default: '', trim: true }, value: { type: Number, default: 0 } },
  { _id: false }
);

const metaPixelSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    title: { type: String, required: true, trim: true },
    pixelId: { type: String, required: true, trim: true, index: true },
    // Meta calls it the Conversions API access token; the UI calls it API key
    apiKey: { type: String, default: '', trim: true },
    // Used when a conversion carries no event name of its own
    defaultEventName: { type: String, default: '', trim: true },
    // Sent as event_source_url when the conversion has no URL of its own
    eventUrl: { type: String, default: '', trim: true },
    actionSource: { type: String, enum: ACTION_SOURCES, default: 'store_tracking_url' },
    dataQualityToken: { type: String, default: '', trim: true },
    // Meta's test console instead of the real event stream
    testEventCode: { type: String, default: '', trim: true },

    customConversionMatching: { type: Boolean, default: false },
    conversionMatching: { type: [conversionMatchSchema], default: [] },
    payoutRules: { type: [payoutRuleSchema], default: [] },

    /*
     * What actually happened, so the list can say more than "configured". Meta
     * is the only one who knows whether an event was any good, but whether it
     * left here at all is ours to report.
     */
    eventsSent: { type: Number, default: 0 },
    lastEventAt: { type: Date, default: null },
    lastError: { type: String, default: '' },

    status: { type: String, enum: ['active', 'paused'], default: 'active' },
  },
  { timestamps: true, collection: 'meta_pixels' }
);

metaPixelSchema.index({ title: 1 });

/** The API key is write-only, as every other credential in this tracker is. */
export function sanitizeMetaPixel(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const { apiKey, dataQualityToken, ...rest } = out;
  return { ...rest, hasApiKey: !!apiKey, hasDataQualityToken: !!dataQualityToken };
}

export const MetaPixel = mongoose.model('MetaPixel', metaPixelSchema);
export default MetaPixel;
