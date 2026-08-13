import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Page } from '../components/Layout.jsx';
import { fmtMoney, fmtNum } from '../components/StatCard.jsx';
import { useChartColors } from '../context/ThemeContext.jsx';
import { dashboardApi, errMsg } from '../api/client.js';

/* Card icons */
const SpendIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 12 15.5 8.5" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);
const RevenueIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z" />
  </svg>
);
const RoasIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="m7 15 3.5-3.5 2.5 2.5L17 9" />
  </svg>
);

const PERIODS = [
  ['today', 'Today:'],
  ['yesterday', 'Yesterday:'],
  ['thisMonth', 'This month:'],
  ['lastMonth', 'Last month:'],
];

/** One of the three headline cards — same 2×2 period grid in each. */
function MetricCard({ tone, icon, title, summary, render }) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-head">
        <span className="metric-icon">{icon}</span>
        <h3>{title}</h3>
      </div>
      <div className="metric-body">
        {PERIODS.map(([id, label]) => (
          <div className="metric-cell" key={id}>
            <span>{label}</span>
            <b>{render(summary?.[id])}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Best performing …" panel: a today block and a yesterday block, 3 rows each. */
function TopPanel({ title, data }) {
  const block = (label, rows) => (
    <>
      <tr>
        <th>{label}</th>
        <th className="num">Revenue</th>
        <th className="num">Conversions</th>
      </tr>
      {(rows || []).map((r, i) => (
        <tr key={`${label}-${i}`}>
          <td className={`rank ${r.label === '-' ? 'empty' : ''}`} title={r.label}>
            {i + 1}. {r.label}
          </td>
          <td className="num">$ {fmtMoney(r.revenue)}</td>
          <td className="num">{fmtNum(r.conversions)}</td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="panel top-panel">
      <div className="panel-head">
        <h3>{title}</h3>
      </div>
      <table className="top-table">
        <tbody>
          {block('Today:', data?.today)}
          <tr className="spacer">
            <td colSpan={3} />
          </tr>
          {block('Yesterday:', data?.yesterday)}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const chart = useChartColors();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await dashboardApi.get());
    } catch (err) {
      setError(errMsg(err, 'Could not load the dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;
  const stamp = data?.lastUpdate
    ? new Date(data.lastUpdate).toLocaleString('sv-SE').replace('T', ' ').slice(0, 19)
    : '—';

  return (
    <Page>
      {error && <div className="alert error">{error}</div>}

      <div className="dash-headline">
        <h2>Dashboard</h2>
        <div className="dash-lastupdate">
          <span>Last update</span>
          {stamp}
        </div>
        <div className="grow" />
        <button type="button" className="btn" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : '↻'} Refresh
        </button>
        <Link to="/campaigns" className="btn primary">
          Discover more
        </Link>
      </div>

      <div className="dash-metrics">
        <MetricCard
          tone="blue"
          icon={<SpendIcon />}
          title="Ad spend"
          summary={s}
          render={(p) => `$ ${fmtMoney(p?.cost)}`}
        />
        <MetricCard
          tone="green"
          icon={<RevenueIcon />}
          title="Revenue"
          summary={s}
          render={(p) => `$ ${fmtMoney(p?.revenue)}`}
        />
        <MetricCard
          tone="orange"
          icon={<RoasIcon />}
          title="ROAS"
          summary={s}
          render={(p) => (
            <>
              $ {fmtMoney(p?.roas)} / {fmtMoney(p?.roasPct)} <span className="unit">%</span>
            </>
          )}
        />
      </div>

      <div className="dash-top">
        <TopPanel title="Best performing campaigns:" data={data?.top?.campaign} />
        <TopPanel title="Best performing offers:" data={data?.top?.offer} />
        <TopPanel title="Best traffic sources:" data={data?.top?.source} />
      </div>

      <div className="panel dash-chart">
        <div className="panel-head">
          <h3>Metrics chart</h3>
          <span className="mute" style={{ fontSize: 12 }}>
            today, hourly · {data?.timezone || ''}
          </span>
        </div>
        <div className="dash-chart-body">
          {!data?.chart?.length ? (
            <div className="loading-block">{loading ? 'Loading…' : 'No traffic yet today'}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.chart} margin={{ top: 6, right: 14, bottom: 4, left: -14 }}>
                <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  stroke={chart.axis}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => String(v).slice(11, 16)}
                />
                <YAxis stroke={chart.axis} tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: chart.tooltipBg,
                    border: `1px solid ${chart.tooltipBorder}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: chart.label }}
                />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                <Line name="Clicks" type="monotone" dataKey="clicks" stroke={chart.clicks} strokeWidth={2} dot={{ r: 3 }} />
                <Line
                  name="conversion"
                  type="monotone"
                  dataKey="conversions"
                  stroke={chart.conversions}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Page>
  );
}
