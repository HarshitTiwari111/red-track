import mongoose from 'mongoose';

/**
 * One row, holding a number that goes up every time configuration changes.
 *
 * The click path reads only from the in-memory cache, and each cluster worker
 * has its own. A change made through one worker was therefore invisible to the
 * others until their next 30s refresh - so a conversion arriving right after a
 * change was a coin toss between the new setting and the old one.
 *
 * Workers watch this counter instead of the whole configuration: one tiny read
 * on a timer, never on the click path, and a refresh only when something has
 * actually changed.
 */
const appMetaSchema = new mongoose.Schema(
  { _id: { type: String }, version: { type: Number, default: 0 }, at: { type: Date, default: Date.now } },
  { collection: 'app_meta', versionKey: false }
);

export const AppMeta = mongoose.model('AppMeta', appMetaSchema);
export default AppMeta;
