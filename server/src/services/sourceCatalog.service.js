/**
 * Prebuilt traffic-channel templates offered by the "New from template" catalog.
 *
 * Each entry only pre-fills parameters and macros - this tracker has no ad
 * platform API integrations, so nothing here pauses campaigns or pulls cost
 * automatically. Cost still arrives through the cost parameter on the click or
 * through a manual cost push.
 */

const sub = (n, macro, name, role = '') => ({ param: `sub${n}`, macro, name, role });

export const SOURCE_CATALOG = [
  {
    id: 'other',
    name: 'Other',
    description: 'Use it to capture unattributed traffic.',
    recommended: true,
    template: {
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: '',
      params: [sub(1, '', 'Sub 1'), sub(2, '', 'Sub 2'), sub(3, '', 'Sub 3')],
    },
  },
  {
    id: 'google-ads',
    name: 'Google Ads (No-redirect tracking)',
    description: 'ValueTrack parameters plus gclid. Pair it with /track.js for no-redirect tracking.',
    recommended: true,
    template: {
      name: 'Google Ads (No-redirect tracking)',
      aliasChannel: 'google',
      currency: 'USD',
      costParam: 'cost',
      // Google appends gclid to the final URL itself; the macro form is stored
      // so the campaign link builder can also write it explicitly when asked.
      clickIdParam: '{gclid}',
      costUpdateDepth: 'adset',
      costUpdateFrequency: 5,
      integration: { provider: 'google' },
      params: [
        // {replace} is a placeholder, not a Google macro: the campaign name is
        // the one value Google has no ValueTrack token for.
        { param: 'utm_campaign', macro: '{replace}', name: 'Campaign name', role: 'campaign' },
        sub(2, '{keyword}', 'Bidded keyword', 'keyword'),
        sub(3, '{matchtype}', 'Keyword match type'),
        sub(4, '{adgroupid}', 'Ad group ID', 'adgroupId'),
        sub(5, '{creative}', 'Creative ID', 'adId'),
        sub(6, '{campaignid}', 'Campaign ID', 'campaignId'),
        sub(7, '{device}', 'Device type'),
        sub(8, '{adposition}', 'Ad position'),
        sub(9, '{network}', 'Network type'),
        sub(10, '{placement}', 'Website placement', 'placementId'),
        { param: 'utm_source', macro: 'Google', name: 'Source', role: 'source' },
        // Google sends these instead of gclid on iOS and in some PMax cases,
        // so they are captured alongside it rather than in place of it.
        { param: 'wbraid', macro: '{wbraid}', name: 'Web-to-app click id' },
        { param: 'gbraid', macro: '{gbraid}', name: 'App-to-web click id' },
      ],
    },
  },
  {
    id: 'google-pmax',
    name: 'Google (PMax only)',
    description: 'Performance Max sends a reduced macro set — campaign id and gclid only.',
    recommended: false,
    template: {
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: 'gclid',
      params: [
        sub(1, '{campaignid}', 'Campaign id', 'campaign'),
        sub(2, '{device}', 'Device'),
        { param: 'gclid', macro: '{gclid}', name: 'Google click id', role: 'clickref' },
      ],
    },
  },
  {
    id: 'facebook',
    name: 'Meta (ex Facebook)',
    description: 'Meta dynamic URL parameters plus fbclid.',
    recommended: true,
    template: {
      name: 'Meta (ex Facebook)',
      aliasChannel: 'facebook',
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: 'fbclid',
      costUpdateDepth: 'adset',
      costUpdateFrequency: 5,
      // Marks the channel as a Meta one, which is what makes the modal offer the
      // Graph API and Conversions API sections
      integration: { provider: 'meta' },
      params: [
        sub(1, '{{ad.id}}', 'ad_id', 'adId'),
        sub(2, '{{adset.id}}', 'adset_id', 'adgroupId'),
        sub(3, '{{campaign.id}}', 'campaign_id', 'campaignId'),
        sub(4, '{{ad.name}}', 'ad_name', 'ad'),
        sub(5, '{{adset.name}}', 'adset_name', 'adgroup'),
        sub(6, '{{campaign.name}}', 'campaign_name', 'campaign'),
        sub(7, '{{placement}}', 'Placement', 'placement'),
        sub(8, '{{site_source_name}}', 'Site source name'),
        { param: 'utm_source', macro: 'facebook', name: 'UTM source', role: 'source' },
        { param: 'utm_medium', macro: 'paid', name: 'UTM medium', role: 'medium' },
        // Meta appends fbclid to the landing URL itself, so there is no macro
        // to write here - the row exists to name it and to route it.
        { param: 'fbclid', macro: '', name: 'Facebook click ID', role: '' },
      ],
    },
  },
  {
    id: 'tiktok',
    name: 'TikTok Ads',
    description: 'TikTok macro set plus ttclid.',
    recommended: true,
    template: {
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: 'ttclid',
      params: [
        sub(1, '__CAMPAIGN_ID__', 'Campaign id', 'campaign'),
        sub(2, '__AID__', 'Ad group id', 'adgroup'),
        sub(3, '__CID__', 'Creative id', 'ad'),
        sub(4, '__PLACEMENT__', 'Placement', 'placement'),
        { param: 'ttclid', macro: '__CLICKID__', name: 'TikTok click id', role: 'clickref' },
      ],
    },
  },
  {
    id: 'push-pop',
    name: 'Push / Pop network',
    description: 'Generic subid + cost token, which most push and pop networks accept.',
    recommended: false,
    template: {
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: '',
      params: [
        sub(1, '{subid}', 'Sub id'),
        sub(2, '{site_id}', 'Site id', 'placement'),
        sub(3, '{creative_id}', 'Creative id', 'ad'),
        { param: 'cost', macro: '{cpc}', name: 'Click cost', role: 'cost' },
      ],
    },
  },
  {
    id: 'microsoft',
    name: 'Microsoft Ads',
    description: 'Bing UET parameters plus msclkid.',
    recommended: false,
    template: {
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: 'msclkid',
      params: [
        sub(1, '{keyword}', 'Keyword', 'keyword'),
        sub(2, '{MatchType}', 'Match type'),
        sub(3, '{Device}', 'Device'),
        sub(4, '{CampaignId}', 'Campaign id', 'campaign'),
        sub(5, '{AdGroupId}', 'Ad group id', 'adgroup'),
        { param: 'msclkid', macro: '{msclkid}', name: 'Microsoft click id', role: 'clickref' },
      ],
    },
  },
  {
    id: 'organic',
    name: 'Organic / Direct',
    description: 'Untracked or free traffic — no macros, nothing to pre-fill.',
    recommended: false,
    template: {
      currency: 'USD',
      costParam: '',
      clickIdParam: '',
      params: [sub(1, 'organic', 'Channel')],
    },
  },
];

/**
 * Which templates the picker actually offers. The rest stay defined above
 * rather than deleted: their parameter names and macros are the fiddly part,
 * and turning one back on is then a single id here.
 */
const OFFERED = new Set(['google-ads', 'facebook']);

/** Creating from a template is limited to the same set as the picker. */
export const getCatalogEntry = (id) =>
  (OFFERED.has(id) && SOURCE_CATALOG.find((c) => c.id === id)) || null;

/** Catalog list for the picker - the full template stays server-side. */
export const catalogSummary = () =>
  SOURCE_CATALOG.filter((c) => OFFERED.has(c.id)).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    recommended: c.recommended,
    paramCount: c.template.params.length,
    clickIdParam: c.template.clickIdParam,
    costParam: c.template.costParam,
  }));
