import mongoose from 'mongoose';

/**
 * Who changed what, and from where.
 *
 * Everything else in this tracker records what visitors did. Nothing recorded
 * what operators did - so a campaign silently repointed at another offer, a
 * payout edited after the fact, or a user quietly granted admin left no trace
 * at all. On an install where several people share a login-shaped surface,
 * that is the difference between an incident you can explain and one you
 * cannot.
 *
 * Deliberately append-only: there is no route that edits or deletes a row.
 */
const auditLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now, index: true },

    // Who. Email is copied in rather than joined, so a deleted user still reads
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    userEmail: { type: String, default: '' },
    role: { type: String, default: '' },

    // What: 'create' | 'update' | 'delete' | 'login' | 'login_failed' | ...
    action: { type: String, required: true, index: true },
    // Which collection, and which document in it
    entity: { type: String, default: '', index: true },
    entityId: { type: String, default: '' },
    entityName: { type: String, default: '' },

    /*
     * Only the fields that actually changed, and only their names plus the new
     * value. Storing the whole document would put payouts, tokens and keys in a
     * second place, and this one is never redacted on read.
     */
    changes: { type: mongoose.Schema.Types.Mixed, default: null },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { collection: 'audit_logs', versionKey: false }
);

auditLogSchema.index({ ts: -1 });
auditLogSchema.index({ entity: 1, entityId: 1, ts: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
