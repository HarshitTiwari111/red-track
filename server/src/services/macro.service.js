import { getOffer, getLander, getNetworkById, getSource } from './cache.service.js';

/**
 * Macro/token replacement for offer + lander URLs.
 * Every known macro is URL-encoded; unknown macros collapse to an empty string.
 *
 * Only data this tracker actually records is exposed here. Macros for things it
 * does not collect (ISP, connection type, pre-landers) are deliberately absent -
 * see ASSUMPTIONS.md (N3) - because a macro that always resolves to an empty
 * string silently breaks the destination URL.
 */

export const MACRO_LIST = [
  // identity
  'clickid',
  'campaign_id',
  'campaign_name',
  'campaign_slug',
  // traffic source
  'source',
  'source_id',
  // sub ids
  'sub1',
  'sub2',
  'sub3',
  'sub4',
  'sub5',
  'sub6',
  'sub7',
  'sub8',
  'sub9',
  'sub10',
  // geo
  'country',
  'country_name',
  'region',
  'city',
  'ip',
  // device
  'device',
  'device_brand',
  'device_model',
  'os',
  'os_version',
  'browser',
  'browser_version',
  'useragent',
  'language',
  // context
  'referrer',
  'referrer_domain',
  'gclid',
  'fbclid',
  'ttclid',
  // funnel entities
  'lander_id',
  'lander_name',
  'offer_id',
  'offer_name',
  'network_id',
  'network_name',
  // money + time
  'cost',
  'payout',
  'timestamp',
  'click_time',
  'random',
];

const MACRO_RE = /\{([a-z0-9_]+)\}/gi;

let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  regionNames = null;
}

/** "IN" -> "India"; falls back to the code when it is unknown or a placeholder. */
export function countryName(code) {
  const c = String(code || '').toUpperCase();
  if (!c || c === 'XX' || !regionNames) return c;
  try {
    return regionNames.of(c) || c;
  } catch {
    return c;
  }
}

function hostOf(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * @param {string} url  target URL containing {macros}
 * @param {object} ctx  values keyed by macro name (missing keys => '')
 */
export function replaceMacros(url, ctx) {
  if (!url) return '';
  return String(url).replace(MACRO_RE, (_match, rawName) => {
    const name = rawName.toLowerCase();
    let value;
    if (name === 'timestamp') value = Math.floor(Date.now() / 1000);
    else if (name === 'random') value = Math.floor(Math.random() * 1e9);
    else value = ctx[name];

    if (value === undefined || value === null) return '';
    return encodeURIComponent(String(value));
  });
}

/** Build the macro context from a click document + its campaign. */
export function buildMacroContext(click, campaign, extra = {}) {
  const offer = click.offerId ? getOffer(click.offerId) : null;
  const lander = click.landerId ? getLander(click.landerId) : null;
  const network = offer?.networkId ? getNetworkById(offer.networkId) : null;
  const source = campaign?.trafficSourceId ? getSource(campaign.trafficSourceId) : null;

  return {
    clickid: click.clickid,
    campaign_id: campaign ? String(campaign._id) : '',
    campaign_name: campaign?.name || '',
    campaign_slug: campaign?.slug || '',

    source: click.source || source?.name || '',
    source_id: source ? String(source._id) : '',

    sub1: click.sub1,
    sub2: click.sub2,
    sub3: click.sub3,
    sub4: click.sub4,
    sub5: click.sub5,
    sub6: click.sub6,
    sub7: click.sub7,
    sub8: click.sub8,
    sub9: click.sub9,
    sub10: click.sub10,

    country: click.geo?.country || '',
    country_name: countryName(click.geo?.country),
    region: click.geo?.region || '',
    city: click.geo?.city || '',
    ip: click.ip || '',

    device: click.uaParsed?.device || '',
    device_brand: click.uaParsed?.brand || '',
    device_model: click.uaParsed?.model || '',
    os: click.uaParsed?.os || '',
    os_version: click.uaParsed?.osVersion || '',
    browser: click.uaParsed?.browser || '',
    browser_version: click.uaParsed?.browserVersion || '',
    useragent: click.ua || '',
    language: click.language || '',

    referrer: click.referer || '',
    referrer_domain: hostOf(click.referer),
    gclid: click.gclid || '',
    fbclid: click.fbclid || '',
    ttclid: click.ttclid || '',

    lander_id: click.landerId ? String(click.landerId) : '',
    lander_name: lander?.name || '',
    offer_id: click.offerId ? String(click.offerId) : '',
    offer_name: offer?.name || '',
    network_id: network ? String(network._id) : '',
    network_name: network?.name || '',

    cost: click.cost ?? 0,
    payout: extra.payout ?? '',
    click_time: click.ts ? new Date(click.ts).toISOString() : '',
    ...extra,
  };
}
