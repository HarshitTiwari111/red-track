import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import Field from '../components/Field.jsx';
import { api, errMsg } from '../api/client.js';

const STORAGE = 'kap.postbacks';
const DENSITIES = ['compact', 'standard', 'comfortable'];
const PAGE_SIZES = [25, 50, 100, 250];

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
const dash = <span className="mute">—</span>;

const COLUMNS = [
  { key: 'index', label: '#', width: 54, num: true },
  { key: 'refId', label: 'Ref ID', width: 150, mono: true },
  { key: 'ts', label: 'Date Created', width: 168, nowrap: true },
  { key: 'result', label: 'Result', width: 92 },
  { key: 'source', label: 'Traffic channel', width: 140 },
  { key: 'campaignName', label: 'Campaign', width: 150 },
  { key: 'offerName', label: 'Offer', width: 150 },
  { key: 'networkName', label: 'Offer source', width: 140 },
  { key: 'clickid', label: 'Click ID', width: 140, mono: true },
  { key: 'type', label: 'Type', width: 110 },
  { key: 'reason', label: 'Reason', width: 190 },
  { key: 'url', label: 'URL', width: 260, mono: true },
  { key: 'ip', label: 'From IP', width: 120, mono: true },
];

const DEFAULT_HIDDEN = new Set(['ip']);

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}');
  } catch {
    return {};
  }
};

/**
 * A postback is stored with the exact query the caller sent. That object is the
 * whole point of this screen - an empty clickid or a missing sum names the bug
 * immediately - so it is rendered in full rather than summarised into a column.
 */
function QueryView({ query, url }) {
  const entries = Object.entries(query || {});
  return (
    <>
      <div className="pb-detail-label">What the caller sent</div>
      {entries.length ? (
        <div className="pb-query">
          {entries.map(([k, v]) => (
            <span className="pb-param" key={k}>
              <span className="pb-key">{k}</span>
              <span className={`pb-val ${String(v) === '' ? 'empty' : ''}`}>
                {String(v) === '' ? '(empty)' : String(v)}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <span className="mute">no parameters sent</span>
      )}
      {url && (
        <>
          <div className="pb-detail-label" style={{ marginTop: 12 }}>
            Full URL
          </div>
          <div className="pb-url mono">{url}</div>
        </>
      )}
    </>
  );
}

export default function Postbacks() {
  const saved = loadPrefs();

  const [preset, setPreset] = useState(saved.preset || '7d');
  const [from, setFrom] = useState(saved.from || shift(6));
  const [to, setTo] = useState(saved.to || toKey(new Date()));
  const [refId, setRefId] = useState('');
  const [clickid, setClickid] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [channel, setChannel] = useState('');
  const [convType, setConvType] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);

  const [campaigns, setCampaigns] = useState([]);
  const [data, setData] = useState({ items: [], failed: 0, retentionDays: 14, types: [], sources: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [hidden, setHidden] = useState(() => new Set(saved.hidden || [...DEFAULT_HIDDEN]));
  const [density, setDensity] = useState(saved.density || 'standard');
  const [pageSize, setPageSize] = useState(saved.pageSize || 100);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(() => new Set());
  const [menu, setMenu] = useState(null);
  const toolsRef = useRef(null);

  useEffect(() => {
    api
      .get('/campaigns')
      .then(({ data: d }) => setCampaigns(d.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const persist = (patch) => {
    localStorage.setItem(
      STORAGE,
      JSON.stringify({ preset, from, to, hidden: [...hidden], density, pageSize, ...patch })
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from, to, limit: 1000 };
      if (onlyFailed) params.ok = false;
      if (clickid.trim()) params.clickid = clickid.trim();
      if (refId.trim()) params.refId = refId.trim();
      if (campaignId) params.campaignId = campaignId;
      if (channel) params.source = channel;
      if (convType) params.type = convType;
      const { data: d } = await api.get('/logs/postbacks', { params });
      setData(d);
      setPage(1);
    } catch (err) {
      setError(errMsg(err, 'Could not load postbacks'));
      setData({ items: [], failed: 0, retentionDays: 14, types: [], sources: [] });
    } finally {
      setLoading(false);
    }
  }, [from, to, onlyFailed, clickid, refId, campaignId, channel, convType]);

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
    persist({ preset: id, from: r.from, to: r.to });
  };

  /** Step the window back or forward by its own length. */
  const nudge = (dir) => {
    const f = new Date(from);
    const t = new Date(to);
    const days = Math.round((t - f) / 86400000) + 1;
    f.setDate(f.getDate() + dir * days);
    t.setDate(t.getDate() + dir * days);
    setPreset(null);
    setFrom(toKey(f));
    setTo(toKey(t));
    persist({ preset: null, from: toKey(f), to: toKey(t) });
  };

  const columns = useMemo(() => COLUMNS.filter((c) => !hidden.has(c.key)), [hidden]);

  const toggleColumn = (key) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist({ hidden: [...next] });
      return next;
    });

  const toggleRow = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reset = () => {
    setHidden(new Set(DEFAULT_HIDDEN));
    setDensity('standard');
    setPageSize(100);
    setRefId('');
    setClickid('');
    setCampaignId('');
    setChannel('');
    setConvType('');
    setOnlyFailed(false);
    persist({ hidden: [...DEFAULT_HIDDEN], density: 'standard', pageSize: 100 });
  };

  const exportCsv = () => {
    const head = columns.map((c) => c.label).join(',');
    const body = data.items
      .map((r, i) => columns.map((c) => `"${String(cellValue(c, r, i)).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `postbacks-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totalPages = Math.max(1, Math.ceil(data.items.length / pageSize));
  const pageRows = data.items.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Page title="S2S postbacks">
      {error && <div className="alert error">{error}</div>}

      <div className="page-note">
        Every conversion postback the tracker was called with — accepted or refused. When a conversion is missing, this
        is where you find out whether the network called at all, and what it sent. Kept for {data.retentionDays} days.
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="report-controls">
            <Field label="Date">
              <div className="date-nudge">
                <select value={preset || ''} onChange={(e) => applyPreset(e.target.value)}>
                  {!preset && <option value="">{`${from} → ${to}`}</option>}
                  {RANGES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => nudge(-1)} title="Previous period">
                  ‹
                </button>
                <button type="button" onClick={() => nudge(1)} title="Next period">
                  ›
                </button>
              </div>
            </Field>

            <Field label="Ref ID" hint="Partial is fine.">
              <input type="text" className="mono" value={refId} placeholder="any" onChange={(e) => setRefId(e.target.value)} />
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

            <Field label="Campaign">
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Traffic channel">
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">None</option>
                {(data.sources || []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <select value={convType} onChange={(e) => setConvType(e.target.value)}>
                <option value="">None</option>
                {(data.types || []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <button
              type="button"
              className={`tool-btn ${onlyFailed ? 'on' : ''}`}
              onClick={() => setOnlyFailed((v) => !v)}
            >
              ⚑ Failed only
            </button>

            <button type="button" className="btn primary" onClick={load} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Apply'}
            </button>

            <span className="mute" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {data.items.length} postback{data.items.length === 1 ? '' : 's'}
              {data.failed > 0 && !onlyFailed && <> · {data.failed} failed</>}
            </span>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="table-tools" ref={toolsRef}>
          <button type="button" className="tool-btn" onClick={exportCsv} disabled={!data.items.length}>
            ⭱ Export
          </button>
          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'cols' ? null : 'cols')}>
              ◫ Columns
            </button>
            {menu === 'cols' && (
              <div className="popover scroll" style={{ minWidth: 176 }}>
                {COLUMNS.filter((c) => c.key !== 'index').map((c) => (
                  /* preventDefault stops the browser forwarding the click to the
                     checkbox, which would fire this handler twice and undo itself */
                  <label
                    key={c.key}
                    onClick={(e) => {
                      e.preventDefault();
                      toggleColumn(c.key);
                    }}
                  >
                    <input type="checkbox" readOnly checked={!hidden.has(c.key)} style={{ width: 'auto' }} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'density' ? null : 'density')}>
              ☰ Density
            </button>
            {menu === 'density' && (
              <div className="popover" style={{ minWidth: 150 }}>
                {DENSITIES.map((d) => (
                  <label
                    key={d}
                    onClick={() => {
                      setDensity(d);
                      persist({ density: d });
                    }}
                  >
                    <input type="radio" readOnly checked={density === d} style={{ width: 'auto' }} />
                    {d}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="tool-btn" onClick={reset}>
            ↺ Table reset
          </button>
        </div>

        <div className="table-wrap">
          <table className={`data density-${density}`}>
            <thead>
              <tr>
                <th className="no-sort" style={{ width: 34 }} />
                {columns.map((c) => (
                  <th key={c.key} className={`no-sort ${c.num ? 'num' : ''}`} style={{ width: c.width }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length + 1} className="table-empty">
                    <span className="spinner" /> Loading…
                  </td>
                </tr>
              )}
              {!loading && !pageRows.length && (
                <tr>
                  <td colSpan={columns.length + 1} className="table-empty">
                    {onlyFailed ? 'No failed postbacks in this period' : 'No postbacks in this period'}
                  </td>
                </tr>
              )}
              {!loading &&
                pageRows.map((r, i) => {
                  const id = String(r._id);
                  const isOpen = open.has(id);
                  const rowNo = (page - 1) * pageSize + i + 1;
                  return [
                    <tr key={id} onClick={() => toggleRow(id)} style={{ cursor: 'pointer' }}>
                      <td className="num">
                        <span className="pb-caret">{isOpen ? '▾' : '▸'}</span>
                      </td>
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={`${c.num ? 'num' : ''} ${c.mono ? 'mono' : ''} ${c.nowrap ? 'nowrap' : ''}`}
                          title={c.key === 'url' ? r.url : undefined}
                        >
                          {renderCell(c, r, rowNo)}
                        </td>
                      ))}
                    </tr>,
                    isOpen && (
                      <tr key={`${id}-q`} className="pb-detail">
                        <td />
                        <td colSpan={columns.length}>
                          <QueryView query={r.query} url={r.url} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
            </tbody>
          </table>
        </div>

        <div className="table-foot">
          <button type="button" className="tool-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="mute" style={{ fontSize: 12.5 }}>
            Page {page} of {totalPages}
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
              persist({ pageSize: Number(e.target.value) });
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} rows
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tool-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        Click a row to see the raw parameters. An empty <span className="mono">clickid</span> means the offer URL never
        passed it on; <span className="mono">unknown clickid</span> means it was passed but changed on the way.
      </div>
    </Page>
  );
}

/** Plain value, used by the CSV export where JSX would be useless. */
function cellValue(c, r, i) {
  if (c.key === 'index') return i + 1;
  if (c.key === 'ts') return dt(r.ts);
  if (c.key === 'result') return r.ok ? 'ok' : 'failed';
  return r[c.key] ?? '';
}

function renderCell(c, r, rowNo) {
  if (c.key === 'index') return rowNo;
  if (c.key === 'ts') return dt(r.ts);
  if (c.key === 'result') return <span className={`badge ${r.ok ? 'approved' : 'rejected'}`}>{r.ok ? 'ok' : 'failed'}</span>;
  if (c.key === 'url') {
    return r.url ? (
      <span className="truncate" style={{ maxWidth: 240 }}>
        {r.url}
      </span>
    ) : (
      dash
    );
  }
  return r[c.key] || dash;
}
