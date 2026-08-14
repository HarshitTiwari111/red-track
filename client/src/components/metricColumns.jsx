import { fmtMoney, fmtNum, fmtPct } from './StatCard.jsx';

/** The metric columns shared by every report table. */
export const METRIC_COLUMNS = [
  { key: 'clicks', label: 'Clicks', num: true, render: (r) => fmtNum(r.clicks) },
  { key: 'uniques', label: 'Uniques', num: true, render: (r) => fmtNum(r.uniques) },
  { key: 'lpViews', label: 'LP Views', num: true, render: (r) => fmtNum(r.lpViews) },
  { key: 'lpClicks', label: 'LP Clicks', num: true, render: (r) => fmtNum(r.lpClicks) },
  { key: 'lpCtr', label: 'LP CTR', num: true, render: (r) => fmtPct(r.lpCtr) },
  { key: 'conversions', label: 'Conv', num: true, render: (r) => fmtNum(r.conversions) },
  { key: 'cr', label: 'CR', num: true, render: (r) => fmtPct(r.cr) },
  { key: 'revenue', label: 'Revenue', num: true, render: (r) => fmtMoney(r.revenue) },
  { key: 'cost', label: 'Cost', num: true, render: (r) => fmtMoney(r.cost) },
  {
    key: 'profit',
    label: 'Profit',
    num: true,
    render: (r) => (
      <span className={r.profit > 0 ? 'pos' : r.profit < 0 ? 'neg' : ''}>{fmtMoney(r.profit)}</span>
    ),
  },
  {
    key: 'roi',
    label: 'ROI',
    num: true,
    render: (r) => <span className={r.roi > 0 ? 'pos' : r.roi < 0 ? 'neg' : ''}>{fmtPct(r.roi)}</span>,
  },
  { key: 'epc', label: 'EPC', num: true, render: (r) => Number(r.epc || 0).toFixed(4) },
  { key: 'cpc', label: 'CPC', num: true, render: (r) => Number(r.cpc || 0).toFixed(4) },
];

export const labelColumn = (label = 'Name', render) => ({
  key: 'label',
  label,
  render: render || ((r) => r.label || '(none)'),
});
