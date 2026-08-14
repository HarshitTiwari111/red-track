import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import { api, errMsg } from '../api/client.js';

const STORAGE = 'kap.reports';
const DENSITIES = ['compact', 'standard', 'comfortable'];

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
  { id: '30d', label: 'Last 30 days', range: () => ({ from: shift(29), to: toKey(new Date()) }) },
  { id: 'month', label: 'This month', range: () => ({ from: toKey(new Date(new Date().setDate(1))), to: toKey(new Date()) }) },
];

/** Offered in the timezone picker; the report falls back to the configured one. */
const TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

/** Every grouping the report endpoint understands, in the order worth offering. */
const GROUPS = [
  { id: 'day', label: 'Date' },
  { id: 'hour', label: 'Hour' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'offer', label: 'Offer' },
  { id: 'lander', label: 'Lander' },
  { id: 'source', label: 'Traffic channel' },
  { id: 'network', label: 'Offer source' },
  { id: 'country', label: 'Country' },
  { id: 'device', label: 'Device' },
  { id: 'os', label: 'OS' },
  { id: 'browser', label: 'Browser' },
  { id: 'ip', label: 'IP' },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `sub${i + 1}`, label: `Sub ${i + 1}` })),
];

const SUBS = Array.from({ length: 10 }, (_, i) => `sub${i + 1}`);

const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtMoney = (n) => `$ ${Number(n || 0).toFixed(2)}`;
const fmtPct = (n) => `${Number(n || 0).toFixed(2)}%`;

/** Column order copied from the reference tracker so the table reads the same. */
const COLUMNS = [
  { key: 'label', label: 'Date', total: () => 'Total:' },
  { key: 'clicks', label: 'Clicks', num: true, fmt: fmtNum },
  { key: 'lpViews', label: 'LP Views', num: true, fmt: fmtNum },
  { key: 'lpClicks', label: 'LP Clicks', num: true, fmt: fmtNum },
  { key: 'lpCtr', label: 'LP CTR', num: true, fmt: fmtPct },
  { key: 'conversions', label: 'conversion', num: true, fmt: fmtNum, hint: 'Number of conversions of type conversion' },
  { key: 'cr', label: 'CR', num: true, fmt: fmtPct },
  { key: 'revenue', label: 'Total Revenue', num: true, fmt: fmtMoney },
  { key: 'cost', label: 'Cost', num: true, fmt: fmtMoney, hint: 'Click cost recorded on the click, plus manual cost entries' },
  { key: 'profit', label: 'Profit', num: true, fmt: fmtMoney, tone: true },
  { key: 'roi', label: 'Total ROI', num: true, fmt: fmtPct, tone: true },
  { key: 'epc', label: 'EPC', num: true, fmt: (n) => `$ ${Number(n || 0).toFixed(2)}` },
  { key: 'cpc', label: 'CPC', num: true, fmt: (n) => `$ ${Number(n || 0).toFixed(2)}` },
  { key: 'uniques', label: 'Uniques', num: true, fmt: fmtNum },
];

const DEFAULT_HIDDEN = new Set(['cpc', 'uniques']);

const TABS = [
  { id: 'popular', label: 'Popular reports' },
  { id: 'campaign', label: 'Campaign', entity: { label: 'Campaign', path: '/campaigns', param: 'campaignId' } },
  { id: 'offers', label: 'Offers', entity: { label: 'Offers', path: '/offers', param: 'offerId' } },
  {
    id: 'channels',
    label: 'Traffic channels',
    entity: { label: 'Traffic channels', path: '/sources', param: 'trafficSourceId' },
  },
  { id: 'sources', label: 'Offer sources', entity: { label: 'Offer sources', path: '/networks', param: 'networkId' } },
  { id: 'ip', label: 'IP report', group: 'ip' },
];

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}');
  } catch {
    return {};
  }
};

export default function Reports() {
  const [tab, setTab] = useState('popular');
  const [reportTz, setReportTz] = useState('Asia/Kolkata');

  useEffect(() => {
    api
      .get('/report/dimensions')
      .then(({ data }) => setReportTz(data.reportTimezone || 'Asia/Kolkata'))
      .catch(() => {});
  }, []);

  const active = TABS.find((t) => t.id === tab);

  return (
    <Page title="Reports">
      <div className="rt-tabs report-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'popular' ? (
        <PopularReports onOpen={(id) => setTab(id)} />
      ) : (
        <ReportTab key={active.id} tab={active} reportTz={reportTz} />
      )}
    </Page>
  );
}

/* ------------------------------------------------------------ popular tab */

function PopularReports({ onOpen }) {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [preset, setPreset] = useState('today');

  useEffect(() => {
    api
      .get('/campaigns')
      .then(({ data }) => setCampaigns(data.items || []))
      .catch(() => {});
  }, []);

  const range = RANGES.find((r) => r.id === preset).range();

  return (
    <>
      <div className="panel">
        <div className="panel-body">
          <div className="popular-report">
            <div>
              <h3>Campaign performance report</h3>
              <p className="rt-hint">
                Every campaign broken down by date, with clicks, lander flow, conversions and ROI.
                <br />
                Grouping, sub filters and columns are all adjustable once the report is open.
              </p>
            </div>

            <label className="field">
              <span>Select campaign</span>
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Date</span>
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {RANGES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const prefs = loadPrefs();
                prefs.campaign = { ...(prefs.campaign || {}), entityId: campaignId, preset, from: range.from, to: range.to };
                localStorage.setItem(STORAGE, JSON.stringify(prefs));
                onOpen('campaign');
              }}
            >
              Create a report
            </button>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h3>The other tabs</h3>
        </div>
        <div className="panel-body">
          <div className="report-shortcuts">
            {TABS.filter((t) => t.id !== 'popular').map((t) => (
              <button key={t.id} type="button" className="report-shortcut" onClick={() => onOpen(t.id)}>
                <strong>{t.label}</strong>
                <span className="rt-hint">
                  {t.id === 'ip'
                    ? 'Traffic grouped by IP address — useful for spotting a single source of junk clicks.'
                    : `Pick one ${t.label.toLowerCase().replace(/s$/, '')} and break its traffic down any way you like.`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- report tab */

function ReportTab({ tab, reportTz }) {
  const saved = loadPrefs()[tab.id] || {};

  const [entities, setEntities] = useState([]);
  const [entityId, setEntityId] = useState(saved.entityId || '');
  const [preset, setPreset] = useState(saved.preset || 'today');
  const [from, setFrom] = useState(saved.from || toKey(new Date()));
  const [to, setTo] = useState(saved.to || toKey(new Date()));
  const [tz, setTz] = useState(saved.tz || reportTz);
  const [group, setGroup] = useState(saved.group || tab.group || 'day');
  const [subFilters, setSubFilters] = useState(saved.subFilters || {});
  const [sortBy, setSortBy] = useState(saved.sortBy || 'clicks');
  const [sortDir, setSortDir] = useState(saved.sortDir || 'desc');

  const [hidden, setHidden] = useState(() => new Set(saved.hidden || [...DEFAULT_HIDDEN]));
  const [density, setDensity] = useState(saved.density || 'standard');

  const [data, setData] = useState({ rows: [], totals: null, source: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(null);
  // Two separate popover hosts - one ref cannot cover both, and sharing one made
  // the outside-click handler blind to whichever mounted first.
  const controlsRef = useRef(null);
  const toolsRef = useRef(null);

  // Only the tz the report actually used is known after a run; before the first
  // load the settings value is the honest default.
  useEffect(() => {
    if (!saved.tz) setTz(reportTz);
  }, [reportTz]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tab.entity) return;
    api
      .get(tab.entity.path)
      .then(({ data: d }) => setEntities(d.items || []))
      .catch(() => {});
  }, [tab.entity]);

  useEffect(() => {
    const onDoc = (e) => {
      const inside =
        controlsRef.current?.contains(e.target) || toolsRef.current?.contains(e.target);
      if (!inside) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const persist = useCallback(
    (patch) => {
      const prefs = loadPrefs();
      prefs[tab.id] = {
        entityId,
        preset,
        from,
        to,
        tz,
        group,
        subFilters,
        sortBy,
        sortDir,
        hidden: [...hidden],
        density,
        ...patch,
      };
      localStorage.setItem(STORAGE, JSON.stringify(prefs));
    },
    [tab.id, entityId, preset, from, to, tz, group, subFilters, sortBy, sortDir, hidden, density]
  );

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { groupBy: group, from, to, tz, sortBy, sortDir, limit: 1000 };
      if (tab.entity && entityId) params[tab.entity.param] = entityId;
      for (const [k, v] of Object.entries(subFilters)) if (v) params[k] = v;
      const { data: d } = await api.get('/report', { params });
      setData(d);
    } catch (err) {
      setError(errMsg(err, 'Could not run the report'));
      setData({ rows: [], totals: null, source: '' });
    } finally {
      setLoading(false);
    }
  }, [group, from, to, tz, sortBy, sortDir, entityId, subFilters, tab.entity]);

  useEffect(() => {
    run();
  }, [run]);

  const applyPreset = (id) => {
    const p = RANGES.find((r) => r.id === id);
    if (!p) return;
    const r = p.range();
    setPreset(id);
    setFrom(r.from);
    setTo(r.to);
    persist({ preset: id, from: r.from, to: r.to });
  };

  /** Step the whole window back or forward by its own length. */
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
  const groupLabel = GROUPS.find((g) => g.id === group)?.label || group;
  const activeSubs = Object.entries(subFilters).filter(([, v]) => v);
  const entityName = entities.find((e) => String(e._id) === String(entityId))?.name;

  const toggleColumn = (key) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist({ hidden: [...next] });
      return next;
    });
  };

  const sortOn = (key) => {
    const dir = sortBy === key && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(key);
    setSortDir(dir);
    persist({ sortBy: key, sortDir: dir });
  };

  const exportCsv = () => {
    const head = columns.map((c) => c.label).join(',');
    const body = data.rows
      .map((r) => columns.map((c) => `"${String(c.key === 'label' ? r.label || r.key : r[c.key] ?? '')}"`).join(','))
      .join('\n');
    const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tab.id}-report-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const reset = () => {
    setGroup(tab.group || 'day');
    setSubFilters({});
    setSortBy('clicks');
    setSortDir('desc');
    setHidden(new Set(DEFAULT_HIDDEN));
    setDensity('standard');
    setEntityId('');
    applyPreset('today');
    persist({
      group: tab.group || 'day',
      subFilters: {},
      sortBy: 'clicks',
      sortDir: 'desc',
      hidden: [...DEFAULT_HIDDEN],
      density: 'standard',
      entityId: '',
    });
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="panel">
        <div className="panel-body">
          <div className="report-controls" ref={controlsRef}>
            {tab.entity && (
              <label className="field">
                <span>{tab.entity.label}</span>
                <select
                  value={entityId}
                  onChange={(e) => {
                    setEntityId(e.target.value);
                    persist({ entityId: e.target.value });
                  }}
                >
                  <option value="">None</option>
                  {entities.map((e) => (
                    <option key={e._id} value={e._id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="field">
              <span>Date</span>
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
            </label>

            <label className="field">
              <span>Time zone</span>
              <select
                value={tz}
                onChange={(e) => {
                  setTz(e.target.value);
                  persist({ tz: e.target.value });
                }}
              >
                {[...new Set([reportTz, ...TIMEZONES])].map((z) => (
                  <option key={z} value={z}>
                    {z}
                    {z === reportTz ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="popover-wrap">
              <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'group' ? null : 'group')}>
                ⚭ Grouping
              </button>
              {menu === 'group' && (
                <div className="popover scroll">
                  {GROUPS.map((g) => (
                    <label
                      key={g.id}
                      onClick={() => {
                        setGroup(g.id);
                        persist({ group: g.id });
                        setMenu(null);
                      }}
                    >
                      <input type="radio" readOnly checked={group === g.id} style={{ width: 'auto' }} />
                      {g.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="popover-wrap">
              <button
                type="button"
                className={`tool-btn ${activeSubs.length ? 'on' : ''}`}
                onClick={() => setMenu(menu === 'subs' ? null : 'subs')}
              >
                ⛃ Subs filter{activeSubs.length ? ` (${activeSubs.length})` : ''}
              </button>
              {menu === 'subs' && (
                <div className="popover scroll" style={{ minWidth: 230, padding: 10 }}>
                  {SUBS.map((s) => (
                    <label key={s} className="sub-filter">
                      <span>{s}</span>
                      <input
                        type="text"
                        value={subFilters[s] || ''}
                        placeholder="any"
                        onChange={(e) => {
                          const next = { ...subFilters, [s]: e.target.value };
                          setSubFilters(next);
                          persist({ subFilters: next });
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button type="button" className="btn primary" onClick={run} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Apply'}
            </button>
          </div>

          <div className="report-chips">
            <Chip label={`Group: ${groupLabel}`} />
            <Chip label={`Sort by: ${sortBy} ${sortDir}`} />
            <Chip label={`Timezone: ${tz}`} />
            {entityName && <Chip label={`${tab.entity.label}: ${entityName}`} onClear={() => setEntityId('')} />}
            {activeSubs.map(([k, v]) => (
              <Chip
                key={k}
                label={`${k}: ${v}`}
                onClear={() => {
                  const next = { ...subFilters, [k]: '' };
                  setSubFilters(next);
                  persist({ subFilters: next });
                }}
              />
            ))}
            <button type="button" className="link-btn" onClick={reset}>
              Clear all
            </button>
            {data.source && (
              <span className="mute" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
                served from {data.source === 'stats' ? 'hourly rollups' : data.source === 'stats_subs' ? 'sub rollups' : 'raw clicks'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="table-tools" ref={toolsRef}>
          <button type="button" className="tool-btn" onClick={exportCsv} disabled={!data.rows.length}>
            ⭱ Export
          </button>
          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'cols' ? null : 'cols')}>
              ◫ Columns
            </button>
            {menu === 'cols' && (
              <div className="popover scroll" style={{ minWidth: 170 }}>
                {COLUMNS.filter((c) => c.key !== 'label').map((c) => (
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
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={c.num ? 'num' : ''}
                    title={c.hint || 'Click to sort'}
                    onClick={() => sortOn(c.key)}
                    style={{ cursor: 'pointer' }}
                  >
                    {c.key === 'label' ? groupLabel : c.label}
                    {sortBy === c.key && <span className="sort-caret">{sortDir === 'desc' ? ' ▾' : ' ▴'}</span>}
                  </th>
                ))}
              </tr>
              {data.totals && (
                <tr className="total-row">
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : ''}>
                      {c.key === 'label' ? 'Total:' : c.fmt(data.totals[c.key])}
                    </td>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length} className="table-empty">
                    <span className="spinner" /> Loading…
                  </td>
                </tr>
              )}
              {!loading && !data.rows.length && (
                <tr>
                  <td colSpan={columns.length} className="table-empty">
                    No traffic in this period
                  </td>
                </tr>
              )}
              {!loading &&
                data.rows.map((r) => (
                  <tr key={r.key || r.label}>
                    {columns.map((c) => {
                      if (c.key === 'label') {
                        return (
                          <td key={c.key} title={r.label || r.key}>
                            {r.label || r.key || '(none)'}
                          </td>
                        );
                      }
                      const v = r[c.key];
                      const tone = c.tone ? (Number(v) > 0 ? 'pos' : Number(v) < 0 ? 'neg' : '') : '';
                      return (
                        <td key={c.key} className={`num ${tone}`}>
                          {c.fmt(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Chip({ label, onClear }) {
  return (
    <span className="report-chip">
      {label}
      {onClear && (
        <button type="button" onClick={onClear} aria-label={`Clear ${label}`}>
          ×
        </button>
      )}
    </span>
  );
}
