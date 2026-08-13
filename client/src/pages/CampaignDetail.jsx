import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import DataTable from '../components/DataTable.jsx';
import CopyField from '../components/CopyField.jsx';
import StatCard, { fmtMoney, fmtNum, fmtPct, toneOf } from '../components/StatCard.jsx';
import DateRangePicker, { useDateRange } from '../components/DateRangePicker.jsx';
import { METRIC_COLUMNS, labelColumn } from '../components/metricColumns.jsx';
import { campaignsApi, reportApi, costApi, errMsg } from '../api/client.js';

const DRILLDOWNS = [
  { id: 'country', label: 'Country' },
  { id: 'device', label: 'Device' },
  { id: 'os', label: 'OS' },
  { id: 'browser', label: 'Browser' },
  { id: 'offer', label: 'Offer' },
  { id: 'lander', label: 'Lander' },
  { id: 'day', label: 'Day' },
  { id: 'hour', label: 'Hour' },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `sub${i + 1}`, label: `Sub${i + 1}` })),
];

export default function CampaignDetail() {
  const { id } = useParams();
  const { range } = useDateRange();
  const [campaign, setCampaign] = useState(null);
  const [links, setLinks] = useState(null);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('country');
  const [report, setReport] = useState({ rows: [], totals: null });
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState('');
  const [cost, setCost] = useState({ totalCost: '', note: '' });
  const [costMsg, setCostMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([campaignsApi.get(id), campaignsApi.links(id)])
      .then(([c, l]) => {
        if (!alive) return;
        setCampaign(c);
        setLinks(l);
      })
      .catch((err) => alive && setError(errMsg(err, 'Could not load the campaign')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const loadSummary = useCallback(() => {
    reportApi
      .summary({ from: range.from, to: range.to, campaignId: id })
      .then(setSummary)
      .catch(() => {});
  }, [id, range.from, range.to]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    let alive = true;
    setTabLoading(true);
    reportApi
      .report({ groupBy: tab, from: range.from, to: range.to, campaignId: id })
      .then((r) => alive && setReport(r))
      .catch((err) => alive && setError(errMsg(err)))
      .finally(() => alive && setTabLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, id, range.from, range.to]);

  const pushCost = async () => {
    setCostMsg(null);
    try {
      const res = await costApi.push({
        campaignId: id,
        from: range.from,
        to: range.to,
        totalCost: Number(cost.totalCost),
        note: cost.note,
      });
      setCostMsg({
        type: 'success',
        text: `Distributed ${cost.totalCost} across ${res.clicks} clicks (${res.perClick} per click, ${res.buckets} hourly buckets).`,
      });
      setCost({ totalCost: '', note: '' });
      loadSummary();
    } catch (err) {
      setCostMsg({ type: 'error', text: errMsg(err) });
    }
  };

  if (loading) {
    return (
      <Page title="Campaign">
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </Page>
    );
  }

  if (!campaign) {
    return (
      <Page title="Campaign">
        <div className="alert error">{error || 'Campaign not found'}</div>
      </Page>
    );
  }

  return (
    <Page
      title={
        <>
          <Link to="/campaigns" className="mute">
            Campaigns
          </Link>{' '}
          <span className="mute">/</span> {campaign.name}
        </>
      }
      actions={<DateRangePicker />}
    >
      {error && <div className="alert error">{error}</div>}

      <div className="page-section">
        <div className="stat-grid">
          <StatCard label="Clicks" value={fmtNum(summary?.clicks)} sub={`${fmtNum(summary?.uniques)} unique`} />
          <StatCard label="LP Clicks" value={fmtNum(summary?.lpClicks)} sub={`LP CTR ${fmtPct(summary?.lpCtr)}`} />
          <StatCard label="Conversions" value={fmtNum(summary?.conversions)} sub={`CR ${fmtPct(summary?.cr)}`} />
          <StatCard label="Revenue" value={fmtMoney(summary?.revenue)} />
          <StatCard label="Cost" value={fmtMoney(summary?.cost)} />
          <StatCard label="Profit" value={fmtMoney(summary?.profit)} tone={toneOf(summary?.profit)} sub={`ROI ${fmtPct(summary?.roi)}`} />
        </div>
      </div>

      {/* --------------------------------------------------- tracking links */}
      <div className="page-section">
        <div className="panel">
          <div className="panel-head">
            <h3>Tracking links</h3>
            <span className={`badge ${campaign.status}`}>{campaign.status}</span>
          </div>
          <div className="panel-body">
            <CopyField
              label={`Campaign URL${links?.source ? ` — params pre-filled for ${links.source.name}` : ''}`}
              value={links?.campaignUrl}
            />
            <CopyField label="Bare campaign URL (no source params)" value={links?.bareUrl} />
            <CopyField label="Lander → offer link (use on your lander's CTA)" value={links?.goUrl} />
            <CopyField label="Conversion pixel" value={links?.pixelUrl} />
            <CopyField label="No-redirect script tag (Google Ads safe)" value={links?.scriptTag} />

            <details style={{ marginTop: 10 }}>
              <summary className="dim" style={{ cursor: 'pointer', fontSize: 13 }}>
                Available macros
              </summary>
              <div className="mono mute" style={{ marginTop: 8, lineHeight: 1.9 }}>
                {(links?.macros || []).map((m) => (
                  <span key={m} style={{ marginRight: 10 }}>{`{${m}}`}</span>
                ))}
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------ manual cost */}
      <div className="page-section">
        <div className="panel">
          <div className="panel-head">
            <h3>Push manual cost</h3>
            <span className="mute" style={{ fontSize: 12 }}>
              spread across {range.from} → {range.to}
            </span>
          </div>
          <div className="panel-body">
            {costMsg && <div className={`alert ${costMsg.type}`}>{costMsg.text}</div>}
            <div className="field-row">
              <label className="field">
                <span>Total cost for the selected range</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cost.totalCost}
                  onChange={(e) => setCost({ ...cost, totalCost: e.target.value })}
                  placeholder="e.g. 250.00"
                />
              </label>
              <label className="field">
                <span>Note</span>
                <input type="text" value={cost.note} onChange={(e) => setCost({ ...cost, note: e.target.value })} placeholder="Google Ads invoice" />
              </label>
            </div>
            <button type="button" className="btn primary" onClick={pushCost} disabled={!cost.totalCost}>
              Distribute cost
            </button>
            <div className="hint">Cost is spread evenly per click across every non-bot click in the period.</div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- drilldowns */}
      <div className="page-section">
        <div className="panel">
          <div className="panel-head">
            <h3>Drilldown</h3>
            <span className="mute" style={{ fontSize: 12 }}>
              source: {report.source || '—'}
            </span>
          </div>
          <div className="panel-body" style={{ paddingBottom: 0 }}>
            <div className="tabs">
              {DRILLDOWNS.map((d) => (
                <button key={d.id} type="button" className={tab === d.id ? 'active' : ''} onClick={() => setTab(d.id)}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={[labelColumn(DRILLDOWNS.find((d) => d.id === tab)?.label || 'Value'), ...METRIC_COLUMNS]}
            rows={report.rows}
            totals={report.totals}
            loading={tabLoading}
            rowKey={(r, i) => `${r.key}-${i}`}
            defaultSort={{ key: 'clicks', dir: 'desc' }}
          />
        </div>
      </div>
    </Page>
  );
}
