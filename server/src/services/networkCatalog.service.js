/**
 * Prebuilt offer-source (affiliate network) templates.
 *
 * The parameter names below are the ones THIS tracker reads off the postback -
 * they are ours to define. The `macro` column is deliberately left blank: the
 * token a network substitutes (e.g. its own click id placeholder) differs per
 * network and only its documentation can say what it is. Inventing macros here
 * would produce postback URLs that silently deliver empty values.
 */

const p = (param, role, name) => ({ param, macro: '', name, role });

export const NETWORK_CATALOG = [
  {
    id: 'generic',
    name: 'Generic postback',
    description: 'Click id and payout only — the smallest postback that attributes a conversion.',
    verticals: ['Any'],
    recommended: true,
    template: {
      currency: 'USD',
      duplicateMode: 'ignore',
      params: [p('clickid', 'clickid', 'Click ID'), p('payout', 'payout', 'Payout')],
      paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
    },
  },
  {
    id: 'txid-dedupe',
    name: 'Transaction ID dedupe',
    description: 'Adds a transaction id so a repeated postback cannot double-count a sale.',
    verticals: ['E-commerce', 'Leadgen'],
    recommended: true,
    template: {
      currency: 'USD',
      duplicateMode: 'ignore',
      params: [
        p('clickid', 'clickid', 'Click ID'),
        p('payout', 'payout', 'Payout'),
        p('txid', 'txid', 'Transaction ID'),
      ],
      paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
    },
  },
  {
    id: 'status-flow',
    name: 'Pending → approved flow',
    description: 'Conversions arrive pending and are updated later. Duplicate mode is set to update.',
    verticals: ['Leadgen', 'Dating'],
    recommended: true,
    template: {
      currency: 'USD',
      defaultConversionStatus: 'pending',
      duplicateMode: 'update',
      params: [
        p('clickid', 'clickid', 'Click ID'),
        p('payout', 'payout', 'Payout'),
        p('txid', 'txid', 'Transaction ID'),
        p('status', 'status', 'Status'),
      ],
      paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
    },
  },
  {
    id: 'multi-event',
    name: 'Multi-event (lead / sale / deposit)',
    description: 'Carries an event type so each conversion kind can be reported separately.',
    verticals: ['Gambling', 'Finance'],
    recommended: false,
    template: {
      currency: 'USD',
      duplicateMode: 'create',
      params: [
        p('clickid', 'clickid', 'Click ID'),
        p('payout', 'payout', 'Payout'),
        p('txid', 'txid', 'Transaction ID'),
        p('type', 'type', 'Conversion type'),
        p('event', 'event', 'Event name'),
      ],
      paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
    },
  },
  {
    id: 'revshare',
    name: 'Revshare',
    description: 'Reports both your payout and the publisher revenue on each postback.',
    verticals: ['Gambling', 'Adult'],
    recommended: false,
    template: {
      currency: 'USD',
      duplicateMode: 'create',
      params: [
        p('clickid', 'clickid', 'Click ID'),
        p('sum', 'payout', 'Payout (sum)'),
        p('pub_revenue', 'pubrevenue', 'Publisher revenue'),
        p('txid', 'txid', 'Transaction ID'),
      ],
      paramMapping: { clickid: 'clickid', payout: 'sum', txid: 'txid', status: 'status', type: 'type' },
    },
  },
  {
    id: 'protected',
    name: 'Protected postback',
    description: 'Security key required and an IP allow-list enabled — fill the IPs your network posts from.',
    verticals: ['Any'],
    recommended: true,
    template: {
      currency: 'USD',
      duplicateMode: 'ignore',
      postbackProtection: { enabled: true },
      whitelistedIps: { enabled: true, ips: [] },
      params: [
        p('clickid', 'clickid', 'Click ID'),
        p('payout', 'payout', 'Payout'),
        p('txid', 'txid', 'Transaction ID'),
      ],
      paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
    },
  },
  {
    id: 'windowed',
    name: '30-day attribution window',
    description: 'Rejects conversions that arrive more than 30 days after the click.',
    verticals: ['E-commerce'],
    recommended: false,
    template: {
      currency: 'USD',
      duplicateMode: 'ignore',
      clickExpiration: { enabled: true, days: 30 },
      params: [
        p('clickid', 'clickid', 'Click ID'),
        p('payout', 'payout', 'Payout'),
        p('txid', 'txid', 'Transaction ID'),
      ],
      paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
    },
  },
];

export const getNetworkTemplate = (id) => NETWORK_CATALOG.find((c) => c.id === id) || null;

export const networkCatalogSummary = () =>
  NETWORK_CATALOG.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    verticals: c.verticals,
    recommended: c.recommended,
    paramCount: c.template.params.length,
    protected: Boolean(c.template.postbackProtection?.enabled),
    duplicateMode: c.template.duplicateMode,
  }));
