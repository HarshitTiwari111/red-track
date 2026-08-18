import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import Field from '../components/Field.jsx';
import { api, errMsg } from '../api/client.js';

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  return toKey(new Date(y, m - 1, d + days));
};
const todayKey = () => toKey(new Date());

const STORAGE = 'kap.clicks.table';
const DENSITIES = ['compact', 'standard', 'comfortable'];

const time = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : '—';

const txt = (v) => (v === 0 ? '0' : v || <span className="mute">—</span>);
const mono = (v, width = 160) =>
  v ? (
    <span className="mono truncate" style={{ maxWidth: width, display: 'inline-block' }} title={v}>
      {v}
    </span>
  ) : (
    <span className="mute">—</span>
  );

/**
 * Every column, in the order the reference lists them. A few report something
 * this tracker does not record - they are marked `missing` so the header can
 * say why rather than showing an empty column that looks broken.
 */
const ALL_COLUMNS = [
  { key: 'index', label: '#', num: true, width: 54, always: true },
  { key: 'clickid', label: 'Click ID', always: true, render: (r) => mono(r.clickid, 130) },
  { key: 'type', label: 'Type', render: (r) => (r.entry === 'pageview' ? 'pageview' : 'redirect') },
  {
    key: 'uniqueness',
    label: 'Uniqueness',
    render: (r) => <span className={`badge ${r.isUnique ? 'approved' : 'neutral'}`}>{r.isUnique ? 'unique' : 'repeat'}</span>,
  },
  { key: 'ts', label: 'Clicks Time', render: (r) => <span className="nowrap">{time(r.ts)}</span> },
  { key: 'campaignName', label: 'Campaign', render: (r) => txt(r.campaignName) },
  { key: 'campaignId', label: 'Campaign ID', render: (r) => mono(r.campaignId, 150) },
  { key: 'prelanding', label: 'Pre-Landing', missing: 'This tracker has one landing page per funnel step, so there is no separate pre-lander.', render: () => <span className="mute">—</span> },
  { key: 'offerName', label: 'Offer', render: (r) => txt(r.offerName) },
  { key: 'source', label: 'Traffic channel', render: (r) => txt(r.source) },
  { key: 'networkName', label: 'Offer source', render: (r) => txt(r.networkName) },
  { key: 'isp', label: 'ISP', missing: 'Needs an IP-to-ISP database; the bundled geo database has country, region and city only.', render: () => <span className="mute">—</span> },
  { key: 'landerName', label: 'Landings', render: (r) => txt(r.landerName) },
  { key: 'finalUrl', label: 'Deeplink', render: (r) => mono(r.finalUrl, 220) },
  { key: 'connection', label: 'Connection type', missing: 'Needs an IP-to-connection database, which is not bundled.', render: () => <span className="mute">—</span> },
  { key: 'country', label: 'Country', render: (r) => txt(r.geo?.country) },
  { key: 'city', label: 'City', render: (r) => txt(r.geo?.city) },
  { key: 'os', label: 'OS', render: (r) => txt(r.uaParsed?.os) },
  { key: 'browser', label: 'Browser', render: (r) => txt(r.uaParsed?.browser) },
  { key: 'device', label: 'Device', render: (r) => txt(r.uaParsed?.device) },
  { key: 'ip', label: 'IP', render: (r) => mono(r.ip, 130) },
  { key: 'ua', label: 'User agent', render: (r) => mono(r.ua, 240) },
  { key: 'referer', label: 'Ref ID', render: (r) => mono(r.referer, 200) },
  { key: 'cost', label: 'Cost', num: true, render: (r) => Number(r.cost || 0).toFixed(4) },
  ...Array.from({ length: 20 }, (_, i) => ({
    key: `sub${i + 1}`,
    label: `Sub${i + 1}`,
    render: (r) => mono(r[`sub${i + 1}`], 140),
  })),
  { key: 'rtSource', label: 'Rt source', render: (r) => txt(r.utm?.source) },
  { key: 'rtMedium', label: 'Rt medium', render: (r) => txt(r.utm?.medium) },
  { key: 'rtCampaign', label: 'Rt campaign', render: (r) => txt(r.utm?.campaign) },
  { key: 'rtAdgroup', label: 'Rt adgroup', render: (r) => txt(r.utm?.adgroup) },
  { key: 'rtAd', label: 'Rt ad', render: (r) => txt(r.utm?.ad) },
  { key: 'rtPlacement', label: 'Rt placement', render: (r) => txt(r.utm?.placement) },
  { key: 'rtKeyword', label: 'Rt keyword', render: (r) => txt(r.utm?.keyword) },
  {
    key: 'okFlag',
    label: 'OK',
    render: (r) => <span className={`badge ${r.botFlag ? 'rejected' : 'approved'}`}>{r.botFlag ? 'no' : 'yes'}</span>,
  },
  { key: 'datacenter', label: 'Datacenter', missing: 'Needs a datacenter IP range list, which is not bundled.', render: () => <span className="mute">—</span> },
  {
    key: 'blacklist',
    label: 'Black list',
    render: (r) => (r.botReason === 'ip' ? <span className="badge rejected">blocked IP</span> : <span className="mute">—</span>),
  },
  {
    key: 'badDevice',
    label: 'Bad device',
    render: (r) => (r.botReason === 'ua' ? <span className="badge rejected">bad UA</span> : <span className="mute">—</span>),
  },
  {
    key: 'attribution',
    label: 'Attribution',
    render: (r) =>
      r.converted ? (
        <span className="badge approved">converted</span>
      ) : r.lpClick ? (
        <span className="badge neutral">LP click</span>
      ) : (
        <span className="mute">—</span>
      ),
  },
];

/* Forty-odd columns is unreadable by default, so most start hidden. */
const DEFAULT_VISIBLE = [
  'index', 'clickid', 'type', 'uniqueness', 'ts', 'campaignName', 'offerName',
  'source', 'country', 'city', 'os', 'browser', 'device', 'cost', 'okFlag', 'attribution',
];
const DEFAULT_HIDDEN = ALL_COLUMNS.filter((c) => !DEFAULT_VISIBLE.includes(c.key)).map((c) => c.key);

export default function ClicksLog() {
  const [draft, setDraft] = useState({
    from: todayKey(), to: todayKey(), clickid: '',
    campaignId: '', trafficSourceId: '', networkId: '', offerId: '',
  });
  const [filters, setFilters] = useState(draft);

  const [rows, setRows] = useState([]);
  const [refs, setRefs] = useState({ campaigns: [], sources: [], networks: [], offers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(false);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);

  const [prefs, setPrefs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      return { hidden: saved.hidden || DEFAULT_HIDDEN, density: saved.density || 'standard' };
    } catch {
      return { hidden: DEFAULT_HIDDEN, density: 'standard' };
    }
  });
  const savePrefs = (next) => {
    setPrefs(next);
    localStorage.setItem(STORAGE, JSON.stringify(next));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from: filters.from, to: filters.to, limit: 500 };
      for (const k of ['clickid', 'campaignId', 'trafficSourceId', 'networkId', 'offerId']) {
        if (filters[k]) params[k] = filters[k];
      }
      const { data } = await api.get('/clicks', { params });
      setRows(data.items || []);
    } catch (err) {
      setError(errMsg(err, 'Could not load clicks'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [auto, load]);

  useEffect(() => {
    Promise.all([
      api.get('/campaigns'), api.get('/sources'), api.get('/networks'), api.get('/offers'),
    ])
      .then(([c, s, n, o]) =>
        setRefs({
          campaigns: c.data.items || [], sources: s.data.items || [],
          networks: n.data.items || [], offers: o.data.items || [],
        })
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const columns = useMemo(
    () => ALL_COLUMNS.filter((c) => c.always || !prefs.hidden.includes(c.key)),
    [prefs.hidden]
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const visible = rows.slice((page - 1) * perPage, page * perPage);

  const apply = () => {
    setPage(1);
    setFilters(draft);
  };
  const clearAll = () => {
    const empty = { from: todayKey(), to: todayKey(), clickid: '', campaignId: '', trafficSourceId: '', networkId: '', offerId: '' };
    setDraft(empty);
    setFilters(empty);
    setPage(1);
  };

  const exportCsv = () => {
    const head = columns.map((c) => c.label).join(',');
    const body = rows
      .map((r, i) =>
        columns
          .map((c) => {
            if (c.key === 'index') return i + 1;
            const raw = c.csv ? c.csv(r) : r[c.key];
            const v = raw === undefined || raw === null ? '' : String(raw);
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(',')
      )
      .join('\n');
    const url = URL.createObjectURL(new Blob([`${head}\n${body}`], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `clicks-${filters.from}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page
      title="Clicks"
      actions={
        <label className="dim" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ width: 'auto' }} />
          auto-refresh 10s
        </label>
      }
    >
      {error && <div className="alert error">{error}</div>}

      <div className="filter-bar">
        <Field label={`Date ${filters.from} — ${filters.to}`} className="span-2">
          <div className="filter-date">
            <div className="date-steps">
              <button type="button" onClick={() => setDraft({ ...draft, from: shiftKey(draft.from, -1), to: shiftKey(draft.to, -1) })}>
                ‹
              </button>
            </div>
            <Field>
              <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </Field>
            <Field>
              <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </Field>
            <div className="date-steps">
              <button type="button" onClick={() => setDraft({ ...draft, from: shiftKey(draft.from, 1), to: shiftKey(draft.to, 1) })}>
                ›
              </button>
            </div>
          </div>
        </Field>

        <Field label="Click ID">
          <input
            type="text"
            className="mono"
            value={draft.clickid}
            onChange={(e) => setDraft({ ...draft, clickid: e.target.value })}
            placeholder="Click ID"
          />
        </Field>

        <Field label="Campaign">
          <select value={draft.campaignId} onChange={(e) => setDraft({ ...draft, campaignId: e.target.value })}>
            <option value="">None</option>
            {refs.campaigns.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Traffic channel">
          <select value={draft.trafficSourceId} onChange={(e) => setDraft({ ...draft, trafficSourceId: e.target.value })}>
            <option value="">None</option>
            {refs.sources.map((s) => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Offer source">
          <select value={draft.networkId} onChange={(e) => setDraft({ ...draft, networkId: e.target.value })}>
            <option value="">None</option>
            {refs.networks.map((n) => (
              <option key={n._id} value={n._id}>{n.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Offer">
          <select value={draft.offerId} onChange={(e) => setDraft({ ...draft, offerId: e.target.value })}>
            <option value="">None</option>
            {refs.offers.map((o) => (
              <option key={o._id} value={o._id}>{o.name}</option>
            ))}
          </select>
        </Field>

        <div className="filter-actions">
          <button type="button" className="btn primary" onClick={apply} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Apply'}
          </button>
          <button type="button" className="btn" onClick={clearAll}>Clear</button>
        </div>
      </div>

      <div className="panel">
        <div className="table-tools" ref={menuRef}>
          <button type="button" className="tool-btn" onClick={exportCsv} disabled={!rows.length}>
            ⭱ Export
          </button>

          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'cols' ? null : 'cols')}>
              ▥ Columns
            </button>
            {menu === 'cols' && (
              <div className="popover popover-tall">
                {ALL_COLUMNS.filter((c) => !c.always).map((c) => (
                  <label
                    key={c.key}
                    title={c.missing || undefined}
                    onClick={(e) => {
                      // The label forwards its click to the checkbox, so without
                      // this the toggle fires twice and cancels itself
                      e.preventDefault();
                      const hidden = prefs.hidden.includes(c.key)
                        ? prefs.hidden.filter((k) => k !== c.key)
                        : [...prefs.hidden, c.key];
                      savePrefs({ ...prefs, hidden });
                    }}
                  >
                    <input type="checkbox" readOnly checked={!prefs.hidden.includes(c.key)} style={{ width: 'auto' }} />
                    {c.label}
                    {c.missing && <span className="mute"> · not recorded</span>}
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
                  <label key={d} onClick={() => savePrefs({ ...prefs, density: d })}>
                    <input type="radio" readOnly checked={prefs.density === d} style={{ width: 'auto' }} />
                    {d}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="tool-btn" onClick={() => savePrefs({ hidden: DEFAULT_HIDDEN, density: 'standard' })}>
            ↺ Table reset
          </button>
        </div>

        <div className="table-wrap">
          <table className={`data density-${prefs.density}`}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined}
                      title={c.missing || undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length} className="table-empty">Loading…</td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="table-empty">No clicks match these filters</td>
                </tr>
              )}
              {!loading &&
                visible.map((r, i) => (
                  <tr key={r.clickid}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.num ? 'num' : ''}>
                        {c.key === 'index' ? (page - 1) * perPage + i + 1 : c.render(r)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="table-foot">
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="dim" style={{ fontSize: 13 }}>
            Page{' '}
            <input
              type="number"
              min="1"
              max={pageCount}
              value={page}
              onChange={(e) => setPage(Math.min(pageCount, Math.max(1, Number(e.target.value) || 1)))}
              style={{ width: 64, display: 'inline-block' }}
            />{' '}
            of {pageCount}
          </span>
          <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} style={{ width: 120 }}>
            {[25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>{n} rows</option>
            ))}
          </select>
          <button type="button" className="btn sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </div>

      <div className="form-note" style={{ marginTop: 12 }}>
        Most columns start hidden — use <strong>Columns</strong> to show the rest, including Sub1 to
        Sub20 and the Rt fields. Four of them are marked &quot;not recorded&quot;: this tracker does
        not capture ISP, connection type, datacenter ranges, or a separate pre-lander.
      </div>
    </Page>
  );
}
