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
    name: 'Google Ads',
    description: 'ValueTrack parameters plus gclid. Pair it with /track.js for no-redirect tracking.',
    recommended: true,
    template: {
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: 'gclid',
      params: [
        sub(1, '{keyword}', 'Keyword', 'keyword'),
        sub(2, '{matchtype}', 'Match type'),
        sub(3, '{device}', 'Device'),
        sub(4, '{network}', 'Network', 'medium'),
        sub(5, '{placement}', 'Placement', 'placement'),
        sub(6, '{campaignid}', 'Campaign id', 'campaign'),
        sub(7, '{adgroupid}', 'Ad group id', 'adgroup'),
        sub(8, '{creative}', 'Creative id', 'ad'),
        { param: 'gclid', macro: '{gclid}', name: 'Google click id', role: 'clickref' },
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
    name: 'Facebook Ads',
    description: 'Meta dynamic URL parameters plus fbclid.',
    recommended: true,
    template: {
      currency: 'USD',
      costParam: 'cost',
      clickIdParam: 'fbclid',
      params: [
        sub(1, '{{ad.id}}', 'Ad id', 'ad'),
        sub(2, '{{adset.id}}', 'Ad set id', 'adgroup'),
        sub(3, '{{campaign.id}}', 'Campaign id', 'campaign'),
        sub(4, '{{placement}}', 'Placement', 'placement'),
        { param: 'fbclid', macro: '{{fbclid}}', name: 'Facebook click id', role: 'clickref' },
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
