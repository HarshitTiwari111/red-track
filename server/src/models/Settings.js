import mongoose from 'mongoose';

export const DEFAULT_BOT_UA_PATTERNS = [
  'bot',
  'crawl',
  'spider',
  'slurp',
  'headless',
  'phantomjs',
  'puppeteer',
  'playwright',
  'selenium',
  'curl/',
  'wget',
  'python-requests',
  'axios/',
  'go-http-client',
  'java/',
  'okhttp',
  'facebookexternalhit',
  'ahrefs',
  'semrush',
  'mj12bot',
  'dotbot',
  'bingpreview',
  'google-read-aloud',
  'adsbot-google',
  'apis-google',
  'lighthouse',
  'pingdom',
  'uptimerobot',
];

/**
 * How a repeat postback for a click that already converted is treated. These map
 * straight onto the duplicateMode the conversion service already implements.
 */
export const CONVERSION_MODES = [
  { id: 'create', label: 'Create new conversion: new or repeated' },
  { id: 'update', label: 'Update the existing conversion' },
  { id: 'ignore', label: 'Ignore repeated conversions' },
];

/** Optional reporting role a custom event name is counted as. */
export const CONVERSION_ROLES = ['', 'lead', 'sale', 'deposit', 'upsell', 'rebill', 'custom'];

const conversionTypeSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    mode: { type: String, enum: CONVERSION_MODES.map((m) => m.id), default: 'create' },
    role: { type: String, default: '' },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    // Single-document collection, always _id: 'global'
    _id: { type: String, default: 'global' },
    /**
     * Event names a postback may carry. The first entry is the default: anything
     * arriving with an unrecognised type is recorded under it rather than being
     * dropped, so a network misspelling its goal never loses a conversion.
     */
    conversionDefault: { type: conversionTypeSchema, default: () => ({ name: 'conversion', mode: 'create', role: '' }) },
    conversionTypes: { type: [conversionTypeSchema], default: () => [] },
    // Domain used when building the postback URLs shown on the tracking page
    postbackDomainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', default: null },
    botUaPatterns: { type: [String], default: DEFAULT_BOT_UA_PATTERNS },
    blockedIpRanges: { type: [String], default: [] }, // CIDR or plain IP
    rawClickRetentionDays: { type: Number, default: 90 },
    reportTimezone: { type: String, default: 'Asia/Kolkata' },
    telegramEnabled: { type: Boolean, default: true },
    /**
     * The Meta app "Connect Meta" signs in through. One app serves the whole
     * install; the secret is write-only and never returned by the settings
     * route, the same rule every other stored credential follows.
     */
    metaAppId: { type: String, default: '' },
    metaAppSecret: { type: String, default: '' },
  },
  { collection: 'settings', versionKey: false, timestamps: true, _id: false }
);

export const Settings = mongoose.model('Settings', settingsSchema);
export default Settings;
