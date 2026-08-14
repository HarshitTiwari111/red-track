import { StatsHourly, StatsSubs } from '../models/Stats.js';
import { getSettingsSync } from './settings.service.js';
import { localHourBucket, localDayKey } from '../utils/time.js';
import logger from '../utils/logger.js';

const tz = () => getSettingsSync().reportTimezone || 'Asia/Kolkata';

const SUB_FIELDS = ['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'sub6', 'sub7', 'sub8', 'sub9', 'sub10'];

function subKeys(click) {
  const keys = [];
  for (const f of SUB_FIELDS) {
    const v = click[f];
    if (v) keys.push(`${f}:${String(v).slice(0, 120)}`);
  }
  return keys;
}

/** Fire-and-forget $inc upsert; a stats failure must never break tracking. */
function safe(promise, label) {
  return promise.catch((err) => logger.warn(`stats ${label} failed: ${err.message}`));
}

export function incClick(click) {
  const bucket = localHourBucket(click.ts || new Date(), tz());
  const day = localDayKey(click.ts || new Date(), tz());
  const bot = Boolean(click.botFlag);

  const inc = bot
    ? { bots: 1 }
    : {
        clicks: 1,
        uniques: click.isUnique ? 1 : 0,
        lpViews: click.landerId ? 1 : 0,
        cost: Number(click.cost) || 0,
      };

  safe(
    StatsHourly.updateOne(
      {
        campaignId: click.campaignId,
        hourBucket: bucket,
        country: click.geo?.country || 'XX',
        device: click.uaParsed?.device || 'unknown',
      },
      { $inc: inc },
      { upsert: true }
    ),
    'incClick.hourly'
  );

  if (bot) return;

  const keys = subKeys(click);
  if (keys.length) {
    safe(
      StatsSubs.bulkWrite(
        keys.map((subKey) => ({
          updateOne: {
            filter: { campaignId: click.campaignId, day, subKey },
            update: { $inc: { clicks: 1, cost: Number(click.cost) || 0 } },
            upsert: true,
          },
        })),
        { ordered: false }
      ),
      'incClick.subs'
    );
  }
}

export function incLpClick(click) {
  if (click.botFlag) return;
  const bucket = localHourBucket(click.ts || new Date(), tz());
  safe(
    StatsHourly.updateOne(
      {
        campaignId: click.campaignId,
        hourBucket: bucket,
        country: click.geo?.country || 'XX',
        device: click.uaParsed?.device || 'unknown',
      },
      { $inc: { lpClicks: 1 } },
      { upsert: true }
    ),
    'incLpClick'
  );
}

/**
 * Conversions are attributed to the CLICK's hour bucket so that ROI lines up with
 * the traffic that produced them (this is how RedTrack-style reports are read).
 * convDelta/revenueDelta may be negative when a conversion is rejected or edited.
 */
export function incConversion({ click, convDelta = 1, revenueDelta = 0 }) {
  if (!click || click.botFlag) return;
  const at = click.ts || new Date();
  const bucket = localHourBucket(at, tz());
  const day = localDayKey(at, tz());

  safe(
    StatsHourly.updateOne(
      {
        campaignId: click.campaignId,
        hourBucket: bucket,
        country: click.geo?.country || 'XX',
        device: click.uaParsed?.device || 'unknown',
      },
      { $inc: { conversions: convDelta, revenue: revenueDelta } },
      { upsert: true }
    ),
    'incConversion.hourly'
  );

  const keys = subKeys(click);
  if (keys.length) {
    safe(
      StatsSubs.bulkWrite(
        keys.map((subKey) => ({
          updateOne: {
            filter: { campaignId: click.campaignId, day, subKey },
            update: { $inc: { conversions: convDelta, revenue: revenueDelta } },
            upsert: true,
          },
        })),
        { ordered: false }
      ),
      'incConversion.subs'
    );
  }
}

export { SUB_FIELDS };
