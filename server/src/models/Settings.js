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

const settingsSchema = new mongoose.Schema(
  {
    // Single-document collection, always _id: 'global'
    _id: { type: String, default: 'global' },
    botUaPatterns: { type: [String], default: DEFAULT_BOT_UA_PATTERNS },
    blockedIpRanges: { type: [String], default: [] }, // CIDR or plain IP
    rawClickRetentionDays: { type: Number, default: 90 },
    reportTimezone: { type: String, default: 'Asia/Kolkata' },
    telegramEnabled: { type: Boolean, default: true },
  },
  { collection: 'settings', versionKey: false, timestamps: true, _id: false }
);

export const Settings = mongoose.model('Settings', settingsSchema);
export default Settings;
