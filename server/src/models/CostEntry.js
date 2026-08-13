import mongoose from 'mongoose';

/**
 * Audit trail for manual cost pushes. The actual numbers land in stats_hourly;
 * this collection just records what the operator entered and when.
 */
const costEntrySchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    totalCost: { type: Number, required: true },
    distributedRows: { type: Number, default: 0 },
    note: { type: String, default: '' },
    createdBy: { type: String, default: '' },
  },
  { collection: 'cost_entries', versionKey: false, timestamps: true }
);

export const CostEntry = mongoose.model('CostEntry', costEntrySchema);
export default CostEntry;
