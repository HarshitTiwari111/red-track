import { useCallback, useEffect, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import Field from '../components/Field.jsx';
import { api, errMsg } from '../api/client.js';

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toKey(d);
};

const RANGES = [
  { id: 'today', label: 'Today', range: () => ({ from: toKey(new Date()), to: toKey(new Date()) }) },
  { id: 'yesterday', label: 'Yesterday', range: () => ({ from: shift(1), to: shift(1) }) },
  { id: '7d', label: 'Last 7 days', range: () => ({ from: shift(6), to: toKey(new Date()) }) },
  { id: '14d', label: 'Last 14 days', range: () => ({ from: shift(13), to: toKey(new Date()) }) },
];

const dt = (v) => (v ? new Date(v).toLocaleString() : '—');

/**
 * A postback is stored with the exact query the caller sent. That object is the
 * whole point of this screen - an empty clickid or a missing sum names the bug
 * immediately - so it is rendered in full rather than summarised into a column.
 */
function QueryView({ query }) {
  const entries = Object.entries(query || {});
  if (!entries.length) return <span className="mute">no parameters sent</span>;
  return (
    <div className="pb-query">
      {entries.map(([k, v]) => (
        <span className="pb-param" key={k}>
          <span className="pb-key">{k}</span>
          <span className={`pb-val ${String(v) === '' ? 'empty' : ''}`}>{String(v) === '' ? '(empty)' : String(v)}</span>
        </span>
      ))}
    </div>
  );
}

export default function Postbacks() {
  const [preset, setPreset] = useState('7d');
  const [from, setFrom] = useState(shift(6));
  const [to, setTo] = useState(toKey(new Date()));
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [clickid, setClickid] = useState('');

  const [data, setData] = useState({ items: [], failed: 0, retentionDays: 14 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from, to, limit: 500 };
      if (onlyFailed) params.ok = false;
      if (clickid.trim()) params.clickid = clickid.trim();
      const { data: d } = await api.get('/logs/postbacks', { params });
      setData(d);
    } catch (err) {
      setError(errMsg(err, 'Could not load postbacks'));
      setData({ items: [], failed: 0, retentionDays: 14 });
    } finally {
      setLoading(false);
    }
  }, [from, to, onlyFailed, clickid]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (id) => {
    const p = RANGES.find((r) => r.id === id);
    if (!p) return;
    const r = p.range();
    setPreset(id);
    setFrom(r.from);
    setTo(r.to);
  };

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Page title="Postbacks">
      {error && <div className="alert error">{error}</div>}

      <div className="page-note">
        Every conversion postback the tracker was called with — accepted or refused. When a conversion is missing, this
        is where you find out whether the network called at all, and what it sent. Kept for {data.retentionDays} days.
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="report-controls">
            <Field label="Date">
              <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
                {RANGES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Click ID" hint="Partial is fine.">
              <input
                type="text"
                className="mono"
                value={clickid}
                placeholder="any"
                onChange={(e) => setClickid(e.target.value)}
              />
            </Field>

            <button
              type="button"
              className={`tool-btn ${onlyFailed ? 'on' : ''}`}
              onClick={() => setOnlyFailed((v) => !v)}
            >
              {onlyFailed ? '✕ Failed only' : '⚑ Failed only'}
            </button>

            <button type="button" className="btn primary" onClick={load} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Refresh'}
            </button>

            <span className="mute" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {data.items.length} postback{data.items.length === 1 ? '' : 's'}
              {data.failed > 0 && !onlyFailed && <> · {data.failed} failed</>}
            </span>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="no-sort" style={{ width: 34 }} />
                <th className="no-sort" style={{ width: 170 }}>
                  Time
                </th>
                <th className="no-sort" style={{ width: 90 }}>
                  Result
                </th>
                <th className="no-sort" style={{ width: 80 }}>
                  Kind
                </th>
                <th className="no-sort" style={{ width: 130 }}>
                  Click ID
                </th>
                <th className="no-sort">Reason</th>
                <th className="no-sort" style={{ width: 130 }}>
                  Offer source
                </th>
                <th className="no-sort" style={{ width: 120 }}>
                  From IP
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="table-empty">
                    <span className="spinner" /> Loading…
                  </td>
                </tr>
              )}
              {!loading && !data.items.length && (
                <tr>
                  <td colSpan={8} className="table-empty">
                    {onlyFailed ? 'No failed postbacks in this period' : 'No postbacks in this period'}
                  </td>
                </tr>
              )}
              {!loading &&
                data.items.map((r) => {
                  const id = String(r._id);
                  const isOpen = open.has(id);
                  return [
                    <tr key={id} onClick={() => toggle(id)} style={{ cursor: 'pointer' }}>
                      <td className="num">
                        <span className="pb-caret">{isOpen ? '▾' : '▸'}</span>
                      </td>
                      <td className="nowrap">{dt(r.ts)}</td>
                      <td>
                        <span className={`badge ${r.ok ? 'approved' : 'rejected'}`}>{r.ok ? 'ok' : 'failed'}</span>
                      </td>
                      <td>{r.kind}</td>
                      <td className="mono">{r.clickid || <span className="mute">—</span>}</td>
                      <td>{r.reason || <span className="mute">—</span>}</td>
                      <td>{r.networkName || <span className="mute">—</span>}</td>
                      <td className="mono">{r.ip || <span className="mute">—</span>}</td>
                    </tr>,
                    isOpen && (
                      <tr key={`${id}-q`} className="pb-detail">
                        <td />
                        <td colSpan={7}>
                          <div className="pb-detail-label">What the caller sent</div>
                          <QueryView query={r.query} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        Click a row to see the raw parameters. An empty <span className="mono">clickid</span> means the offer URL never
        passed it on; <span className="mono">unknown clickid</span> means it was passed but changed on the way.
      </div>
    </Page>
  );
}
