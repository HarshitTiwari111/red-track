import mongoose from 'mongoose';

/**
 * Pre-aggregated hourly counters, incremented on every click/conversion.
 * hourBucket is the UTC hour truncated to the hour (Date).
 */
const statsHourlySchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    hourBucket: { type: Date, required: true },
    country: { type: String, default: 'XX' },
    device: { type: String, default: 'unknown' },
    clicks: { type: Number, default: 0 },
    uniques: { type: Number, default: 0 },
    lpClicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    bots: { type: Number, default: 0 },
  },
  { collection: 'stats_hourly', versionKey: false }
);

statsHourlySchema.index(
  { campaignId: 1, hourBucket: 1, country: 1, device: 1 },
  { unique: true, name: 'stats_hourly_key' }
);
statsHourlySchema.index({ hourBucket: 1 });

export const StatsHourly = mongoose.model('StatsHourly', statsHourlySchema);

/**
 * Per-subID daily aggregates. subKey looks like "sub1:organic-kw".
 */
const statsSubsSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    subKey: { type: String, required: true },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
  },
  { collection: 'stats_subs', versionKey: false }
);

statsSubsSchema.index({ campaignId: 1, day: 1, subKey: 1 }, { unique: true, name: 'stats_subs_key' });
statsSubsSchema.index({ day: 1 });

export const StatsSubs = mongoose.model('StatsSubs', statsSubsSchema);
