import Click from '../models/Click.js';
import { ClickErrorLog } from '../models/Logs.js';
import { getLander, getSource } from './cache.service.js';
import { selectPathIndex, selectOffer, selectLander } from './rotation.service.js';
import { replaceMacros, buildMacroContext } from './macro.service.js';
import { fireForwards } from './forward.service.js';
import { lookupGeo, clientIp } from './geo.service.js';
import { parseUa } from './ua.service.js';
import { isBlockedIp, isBotUa } from './bot.service.js';
import { markAndCheckUnique } from './uniques.service.js';
import { incClick } from './stats.service.js';
import { newClickId } from '../utils/ids.js';
import { str, num } from '../utils/validate.js';
import { getSettingsSync } from './settings.service.js';
import { localHour } from '../utils/time.js';
import logger from '../utils/logger.js';

export const CLICK_COOKIE = 'kap_clickid';

const SUBS = Array.from({ length: 20 }, (_, i) => `sub${i + 1}`);

/**
 * UTM-style parameters. Each entry accepts a couple of common spellings so the
 * usual ad-platform templates land in the right column without extra config.
 */
const UTM_PARAMS = {
  source: ['utm_source'],
  medium: ['utm_medium'],
  campaign: ['utm_campaign'],
  adgroup: ['utm_adgroup', 'utm_adset', 'adgroup'],
  ad: ['utm_content', 'utm_ad', 'ad'],
  placement: ['utm_placement', 'placement'],
  keyword: ['utm_term', 'utm_keyword', 'keyword'],
};

/** Pull sub1..sub20, UTM parameters and platform click ids out of the query string. */
export function extractParams(query) {
  const out = {};
  for (const s of SUBS) out[s] = str(query[s], 255);

  const utm = {};
  for (const [field, aliases] of Object.entries(UTM_PARAMS)) {
    let v = '';
    for (const a of aliases) {
      if (query[a]) {
        v = str(query[a], 255);
        break;
      }
    }
    utm[field] = v;
  }
  out.utm = utm;

  out.gclid = str(query.gclid, 512);
  out.fbclid = str(query.fbclid, 512);
  out.ttclid = str(query.ttclid, 512);
  return out;
}

/**
 * A traffic source can give a parameter a role ("this one is the keyword"), which
 * routes its value into the matching utm slot so it shows up in reports and the
 * Rt columns instead of only living in a subID.
 */
const UTM_ROLES = [
  'source',
  'medium',
  'campaign',
  'adgroup',
  'ad',
  'placement',
  'keyword',
  'campaignId',
  'adgroupId',
  'adId',
  'placementId',
  'pubId',
  'placementHashed',
  'role1',
  'role2',
];

/**
 * The click reference the traffic source sends back. Its parameter name is
 * configured per source; templates store it the way the platform documents it
 * ("{gclid}"), so the braces come off before the lookup.
 */
export function resolveClickRef(query, source) {
  const param = str(source?.clickIdParam, 64).replace(/[{}]/g, '');
  if (param && query[param]) return str(query[param], 512);
  return str(query.gclid || query.fbclid || query.ttclid, 512);
}

export function applyParamRoles(click, query, source) {
  if (!source?.params?.length) return;
  for (const p of source.params) {
    if (!p.role || !UTM_ROLES.includes(p.role)) continue;
    const value = str(query[p.param], 255);
    if (value) click.utm[p.role] = value;
  }
}

/** Resolve the click cost from the campaign's cost model. */
export function resolveCost(campaign, source, query) {
  switch (campaign.costModel) {
    case 'cpc':
      return num(campaign.costValue, 0);
    case 'cpm':
      return num(campaign.costValue, 0) / 1000;
    case 'fromToken': {
      const param = source?.costParam || 'cost';
      return num(query[param] ?? query.cost ?? query.cpc, 0);
    }
    case 'manual':
    default:
      return 0;
  }
}

/**
 * Synchronous part of a click: everything needed to produce the 302.
 * Does no I/O beyond in-memory lookups + the local geoip database.
 */
export function buildClick(campaign, req, { entry = 'redirect' } = {}) {
  const query = req.query || {};
  const ua = req.get('user-agent') || '';
  const ip = clientIp(req);
  const uaParsed = parseUa(ua);
  const geo = lookupGeo(ip);
  const source = campaign.trafficSourceId ? getSource(campaign.trafficSourceId) : null;
  const settings = getSettingsSync();
  const now = new Date();

  const blocked = isBlockedIp(ip);
  const badUa = isBotUa(ua);
  const botFlag = blocked || badUa;
  const pathIndex = selectPathIndex(campaign, {
    country: geo.country,
    device: uaParsed.device,
    os: uaParsed.os,
    browser: uaParsed.browser,
    hour: localHour(now, settings.reportTimezone),
  });

  const path = pathIndex >= 0 ? campaign.paths[pathIndex] : null;
  const offer = path ? selectOffer(path) : null;
  const lander = selectLander(path);

  const hadCookie = Boolean(req.cookies?.[CLICK_COOKIE]);
  const isUnique = !hadCookie && markAndCheckUnique(String(campaign._id), ip);

  const click = {
    clickid: newClickId(),
    campaignId: campaign._id,
    ts: now,
    ip,
    ua,
    uaParsed,
    geo,
    referer: str(req.get('referer'), 1024),
    // "en-GB,en;q=0.9" -> "en-GB"
    language: str(req.get('accept-language'), 64).split(',')[0].trim(),
    ...extractParams(query),
    clickRef: resolveClickRef(query, source),
    cost: resolveCost(campaign, source, query),
    pathIndex: pathIndex >= 0 ? pathIndex : 0,
    landerId: lander?._id || null,
    offerId: offer?._id || null,
    botFlag,
    botReason: blocked ? 'ip' : badUa ? 'ua' : '',
    isUnique,
    lpClick: false,
    source: source?.name || '',
    entry,
  };

  applyParamRoles(click, query, source);

  // Direct-linking paths (and any path without a lander) go straight to the offer.
  const target = lander ? lander.url : offer?.url || '';
  const finalUrl = target
    ? replaceMacros(target, buildMacroContext(click, campaign, { payout: offer?.defaultPayout ?? '' }))
    : '';
  click.finalUrl = finalUrl;

  return { click, offer, lander, path, finalUrl };
}

/** Async tail: persist the click, bump stats, fire click forwarding. Never awaited. */
export function persistClick(click, campaign = null) {
  Click.create(click)
    .then(() => {
      incClick(click);
      if (!click.botFlag && campaign?.clickForwarding?.length) {
        fireForwards(campaign.clickForwarding, buildMacroContext(click, campaign), 'click-forward');
      }
    })
    .catch((err) => {
      logger.warn(`click insert failed (${click.clickid}): ${err.message}`);
      logClickError({
        route: 'persist',
        reason: err.message,
        slug: '',
        ip: click.ip,
        query: { clickid: click.clickid },
      });
    });
}

export function logClickError(doc) {
  ClickErrorLog.create(doc).catch(() => {});
}

export { SUBS };
