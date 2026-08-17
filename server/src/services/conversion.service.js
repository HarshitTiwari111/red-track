import Click from '../models/Click.js';
import Conversion from '../models/Conversion.js';
import { DUPLICATE_MODES } from '../models/AffiliateNetwork.js';
import { PostbackLog } from '../models/Logs.js';
import { getOffer, getNetworkById, getCampaignById, getSource } from './cache.service.js';
import { incConversion } from './stats.service.js';
import { fireForwards } from './forward.service.js';
import { forwardConversionToMeta } from './meta.service.js';
import { buildMacroContext } from './macro.service.js';
import { getSettingsSync } from './settings.service.js';
import { str, num, oneOf } from '../utils/validate.js';
import logger from '../utils/logger.js';

export const CONV_STATUSES = ['approved', 'pending', 'rejected'];
export const CONV_TYPES = ['lead', 'sale', 'deposit', 'custom'];

export const SUB_INDEXES = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Sub values sent with the postback itself. Accepts `convSub1=` (explicit) or a
 * plain `sub1=` on the postback URL, which is what most networks send.
 */
function extractConvSubs(query = {}) {
  return SUB_INDEXES.map((i) => str(query?.[`convSub${i}`] ?? query?.[`sub${i}`], 255));
}

/**
 * Rejected conversions contribute nothing to counters; approved and pending both
 * count (pending revenue is money in flight, shown as-is in reports).
 */
const effective = (status, payout) =>
  status === 'rejected' ? { conv: 0, rev: 0 } : { conv: 1, rev: Number(payout) || 0 };

export function logPostback(doc) {
  PostbackLog.create(doc).catch(() => {});
}

/**
 * Core postback/pixel handler. Always resolves - callers respond 200 regardless
 * so a network never sees an error and retries forever.
 * @returns {{ok:boolean, reason?:string, conversion?:object, duplicate?:boolean, updated?:boolean}}
 */
export async function recordConversion({
  clickid,
  payout,
  txid,
  status,
  type,
  network,
  rawQuery,
  source = 'postback',
  ip = '',
  url = '',
}) {
  const cid = str(clickid, 64);

  /**
   * Every log line below carries whatever context is known at that point. The
   * context grows as the click and offer resolve, so it is held in one object
   * and merged in rather than repeated at each of the fourteen call sites.
   */
  const ctx = {
    ip,
    query: rawQuery,
    kind: source,
    url: str(url, 2048),
    refId: str(txid, 128),
    type: str(type, 60),
  };
  const log = (fields) => logPostback({ ...ctx, ...fields });

  if (!cid) {
    log({ ok: false, reason: 'missing clickid' });
    return { ok: false, reason: 'missing clickid' };
  }

  // --- per-network guards ------------------------------------------------------
  if (network?.whitelistedIps?.enabled) {
    const allowed = network.whitelistedIps.ips || [];
    if (allowed.length && !allowed.includes(ip)) {
      log({ ok: false, reason: `ip ${ip} not whitelisted`, clickid: cid, networkId: network._id });
      return { ok: false, reason: 'ip not allowed' };
    }
  }

  const click = await Click.findOne({ clickid: cid }).lean();
  if (!click) {
    log({ ok: false, reason: 'unknown clickid', clickid: cid });
    return { ok: false, reason: 'unknown clickid' };
  }

  // From here on every log line can name the campaign, offer and channel it hit
  Object.assign(ctx, {
    campaignId: click.campaignId || null,
    offerId: click.offerId || null,
    source: click.source || '',
  });

  // Attribution window: a conversion arriving long after the click is not ours
  if (network?.clickExpiration?.enabled && network.clickExpiration.days > 0 && click.ts) {
    const ageDays = (Date.now() - new Date(click.ts).getTime()) / 86400000;
    if (ageDays > network.clickExpiration.days) {
      log({
        ok: false,
        reason: `click expired (${Math.floor(ageDays)}d > ${network.clickExpiration.days}d)`,
        clickid: cid,
        networkId: network._id,
      });
      return { ok: false, reason: 'click expired' };
    }
  }

  const offer = click.offerId ? getOffer(click.offerId) : null;
  const networkId = network?._id || offer?.networkId || null;

  /* A postback with no valid key still reaches here, because the key is optional
   * by default. If the offer's own network demands protection, refuse it. */
  if (!network && networkId) {
    const owner = getNetworkById(networkId);
    if (owner?.postbackProtection?.enabled) {
      log({
        ok: false,
        reason: 'security key required by this offer source',
        clickid: cid,
        networkId,
      });
      return { ok: false, reason: 'security key required' };
    }
  }

  let finalPayout = num(payout, 0);
  if (!finalPayout && offer?.payoutType === 'fixed') finalPayout = num(offer.defaultPayout, 0);

  // No status sent: the offer's default wins, then the network's.
  const fallbackStatus = oneOf(
    offer?.defaultConversionStatus || network?.defaultConversionStatus,
    CONV_STATUSES,
    'approved'
  );
  const finalStatus = oneOf(str(status, 24).toLowerCase(), CONV_STATUSES, fallbackStatus);

  /**
   * Event naming has two modes. With no declared list - the normal case - the
   * name the network sends is kept as-is. Once a list IS declared, it becomes
   * the allowed set and anything outside it lands on the default event rather
   * than being stored under a name nobody configured; a network misspelling its
   * goal should cost a label, not a conversion.
   */
  const settings = getSettingsSync();
  const declared = (settings.conversionTypes || []).filter((t) => t?.name);
  const asked = str(type, 60).toLowerCase();
  const matched = declared.find((t) => t.name.toLowerCase() === asked);
  const defaultType = settings.conversionDefault?.name || 'conversion';
  const finalType = matched ? matched.name : declared.length ? defaultType : asked || defaultType;

  let tx = str(txid, 128);

  // --- dedupe / status update -------------------------------------------------
  // The matched event may override how repeats are treated for that event only
  const networkMode = DUPLICATE_MODES.includes(network?.duplicateMode) ? network.duplicateMode : 'update';
  const duplicateMode = matched && DUPLICATE_MODES.includes(matched.mode) ? matched.mode : networkMode;

  if (tx && networkId) {
    const existing = await Conversion.findOne({ networkId, txid: tx });

    // "create" records every repeat as its own conversion. The txid is suffixed
    // so the (network, txid) unique index still holds and the origin stays visible.
    if (existing && duplicateMode === 'create') {
      const suffixed = `${tx}#${(existing.duplicateHits || 0) + 2}`;
      await Conversion.updateOne({ _id: existing._id }, { $inc: { duplicateHits: 1 } });
      tx = suffixed;
    } else if (existing) {
      const before = effective(existing.status, existing.payout);
      const after = effective(finalStatus, finalPayout || existing.payout);
      // "ignore" never rewrites an existing conversion, whatever the postback says
      const changed =
        duplicateMode !== 'ignore' && (existing.status !== finalStatus || before.rev !== after.rev);

      if (!changed) {
        // Count the repeat so the grid can show a real "duplicate" status
        existing.duplicateHits = (existing.duplicateHits || 0) + 1;
        await existing.save();
        log({
          ok: true,
          reason: 'duplicate ignored',
          clickid: cid,
          networkId,
        });
        return { ok: true, duplicate: true, conversion: existing.toObject() };
      }

      existing.status = finalStatus;
      existing.payout = finalPayout || existing.payout;
      existing.type = finalType || existing.type;
      existing.rawQuery = rawQuery;
      await existing.save();

      incConversion({
        click,
        convDelta: after.conv - before.conv,
        revenueDelta: after.rev - before.rev,
      });

      log({
        ok: true,
        reason: `status updated -> ${finalStatus}`,
        clickid: cid,
        networkId,
      });
      return { ok: true, updated: true, conversion: existing.toObject() };
    }
  }

  // --- new conversion ---------------------------------------------------------
  let created;
  try {
    created = await Conversion.create({
      clickid: cid,
      campaignId: click.campaignId,
      networkId,
      offerId: click.offerId || null,
      ts: new Date(),
      type: finalType,
      payout: finalPayout,
      txid: tx,
      status: finalStatus,
      // click snapshot
      country: click.geo?.country || 'XX',
      city: click.geo?.city || '',
      device: click.uaParsed?.device || 'unknown',
      os: click.uaParsed?.os || '',
      browser: click.uaParsed?.browser || '',
      ip: click.ip || '',
      ua: click.ua || '',
      cost: click.cost || 0,
      landerId: click.landerId || null,
      deeplink: click.finalUrl || '',
      clickTs: click.ts,
      clickSubs: SUB_INDEXES.map((i) => click[`sub${i}`] || ''),
      utm: click.utm || {},
      // postback-side values
      convSubs: extractConvSubs(rawQuery),
      postbackIp: ip,
      event: str(rawQuery?.event, 80),
      coupon: str(rawQuery?.coupon, 80),
      refId: str(rawQuery?.ref_id ?? rawQuery?.refid ?? rawQuery?.ref, 120),
      publisherRevenue: num(rawQuery?.pub_revenue ?? rawQuery?.publisher_revenue, 0),
      rawQuery,
      source,
    });
  } catch (err) {
    if (err.code === 11000) {
      log({ ok: true, reason: 'duplicate txid', clickid: cid, networkId });
      return { ok: true, duplicate: true };
    }
    logger.warn('conversion insert failed:', err.message);
    log({ ok: false, reason: err.message, clickid: cid, networkId });
    return { ok: false, reason: err.message };
  }

  const eff = effective(finalStatus, finalPayout);
  incConversion({ click, convDelta: eff.conv, revenueDelta: eff.rev });
  Click.updateOne({ clickid: cid }, { $set: { converted: true } }).catch(() => {});

  // Push the conversion back to the traffic source. The campaign's own list wins;
  // otherwise the traffic channel's S2S postback template is used.
  const campaign = click.campaignId ? getCampaignById(click.campaignId) : null;
  const channel = campaign?.trafficSourceId ? getSource(campaign.trafficSourceId) : null;
  const forwards = campaign?.postbackForwarding?.length
    ? campaign.postbackForwarding
    : channel?.s2sPostbackTemplate
      ? [{ name: channel.name, url: channel.s2sPostbackTemplate, enabled: true }]
      : [];

  if (forwards.length) {
    fireForwards(
      forwards,
      buildMacroContext(click, campaign, {
        payout: finalPayout,
        txid: tx,
        status: finalStatus,
        type: finalType,
      }),
      'postback-forward'
    );
  }

  /*
   * Mirror the conversion to Meta's Conversions API. Deliberately not awaited:
   * the conversion is already saved and the caller owes the network a fast 200,
   * so a slow or unhappy Graph API must not hold the response open.
   */
  if (channel?.capiPixels?.length) {
    forwardConversionToMeta(channel, {
      // Meta collapses this with the browser pixel event of the same id, so a
      // site running both the pixel and this postback is not counted twice.
      eventId: String(created._id),
      eventName: finalType,
      time: created.ts,
      value: finalPayout,
      currency: channel.currency || 'USD',
      url: str(url, 2048),
      ip: click.ip || '',
      userAgent: click.ua || '',
      fbclid: click.fbclid || '',
      clickTime: click.ts,
    }).catch((e) => logger.warn('meta capi forward failed:', e.message));
  }

  log({ ok: true, reason: 'conversion recorded', clickid: cid, networkId });
  return { ok: true, conversion: created.toObject() };
}

/**
 * "Add conversions" bulk entry: one `clickid, payout` per line (payout optional).
 * Each line goes through the normal recording path, so dedupe, payout fallback
 * and stats all behave exactly like a real postback.
 */
export async function addManualConversions(text, { type = 'lead', status = 'approved', ip = '' } = {}) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results = { added: 0, duplicates: 0, failed: 0, errors: [] };

  for (const line of lines) {
    const [rawId, rawPayout] = line.split(',');
    const clickid = str(rawId, 64);
    if (!clickid) {
      results.failed += 1;
      results.errors.push(`${line} — no click id`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const res = await recordConversion({
      clickid,
      payout: rawPayout,
      txid: '',
      status,
      type,
      network: null,
      rawQuery: { manual: true, line },
      source: 'manual',
      ip,
    });

    if (!res.ok) {
      results.failed += 1;
      results.errors.push(`${clickid} — ${res.reason}`);
    } else if (res.duplicate) results.duplicates += 1;
    else results.added += 1;
  }

  return results;
}

/** Dashboard-side status edit; keeps stats in sync with the same delta logic. */
export async function updateConversionStatus(conversionId, patch) {
  const conv = await Conversion.findById(conversionId);
  if (!conv) return null;
  const click = await Click.findOne({ clickid: conv.clickid }).lean();

  const before = effective(conv.status, conv.payout);
  if (patch.status) conv.status = oneOf(patch.status, CONV_STATUSES, conv.status);
  if (patch.payout !== undefined) conv.payout = num(patch.payout, conv.payout);
  if (patch.type) conv.type = str(patch.type, 24);
  await conv.save();
  const after = effective(conv.status, conv.payout);

  if (click) {
    incConversion({ click, convDelta: after.conv - before.conv, revenueDelta: after.rev - before.rev });
  }
  return conv.toObject();
}

export { effective as effectiveConversion, getNetworkById };
