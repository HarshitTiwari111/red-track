import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import useConfirm from '../components/ConfirmModal.jsx';
import Field from '../components/Field.jsx';
import SourceModal, {
  blankSource,
  sourceToForm,
  GOOGLE_TOKEN_KEYS,
  PENDING_GOOGLE_CHANNEL,
} from '../components/SourceModal.jsx';
import SourceCatalogModal from '../components/SourceCatalogModal.jsx';
import { fmtMoney, fmtNum, fmtPct } from '../components/StatCard.jsx';
import { api, errMsg } from '../api/client.js';

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  return toKey(new Date(y, m - 1, d + days));
};
const todayKey = () => toKey(new Date());

const STORAGE = 'kap.sources.table';
const DENSITIES = ['compact', 'standard', 'comfortable'];
const money = (v) => `$ ${fmtMoney(v)}`;

const ALL_COLUMNS = [
  { key: 'index', label: '#', num: true, width: 54, always: true },
  { key: 'name', label: 'Title', always: true },
  { key: 'status', label: 'Status' },
  { key: 'currency', label: 'Currency' },
  { key: 'paramCount', label: 'Parameters', num: true },
  { key: 'clicks', label: 'Clicks', num: true },
  { key: 'lpViews', label: 'LP Views', num: true },
  { key: 'uniques', label: 'Uniques', num: true },
  { key: 'conversions', label: 'conversion', num: true },
  { key: 'cr', label: 'CR', num: true },
  { key: 'cpa', label: 'Total CPA', num: true },
  { key: 'epc', label: 'EPC', num: true },
  { key: 'revenue', label: 'Total Revenue', num: true },
  { key: 'cost', label: 'Cost', num: true },
  { key: 'profit', label: 'Profit', num: true },
  { key: 'roi', label: 'Total ROI', num: true },
];

const DEFAULT_HIDDEN = ['uniques', 'currency'];

function cellValue(row, key, { onEdit }) {
  switch (key) {
    case 'index':
      return row.index;
    case 'name':
      return (
        <>
          <button type="button" className="cell-link" onClick={() => onEdit(row)}>
            {row.name}
          </button>
          {row.aliasChannel ? <span className="cell-sub">{row.aliasChannel}</span> : null}
        </>
      );
    case 'status':
      return <span className={`badge ${row.status}`}>{row.status}</span>;
    case 'currency':
      return row.currency || 'USD';
    case 'cr':
    case 'roi':
      return fmtPct(row[key]);
    case 'epc':
      return Number(row[key] || 0).toFixed(4);
    case 'revenue':
    case 'cost':
    case 'cpa':
      return money(row[key]);
    case 'profit':
      return <span className={row.profit > 0 ? 'pos' : row.profit < 0 ? 'neg' : ''}>{money(row.profit)}</span>;
    default:
      return fmtNum(row[key]);
  }
}

function totalValue(totals, key) {
  switch (key) {
    case 'index':
      return '';
    case 'name':
      return 'Total:';
    case 'status':
    case 'currency':
    case 'paramCount':
      return '';
    case 'cr':
    case 'roi':
      return fmtPct(totals[key]);
    case 'epc':
      return Number(totals[key] || 0).toFixed(4);
    case 'revenue':
    case 'cost':
    case 'profit':
    case 'cpa':
      return money(totals[key]);
    default:
      return fmtNum(totals[key]);
  }
}

export default function Sources() {
  const [confirm, confirmUI] = useConfirm();
  const navigate = useNavigate();

  const [draft, setDraft] = useState({
    from: todayKey(),
    to: todayKey(),
    connectedFrom: '',
    connectedTo: '',
    title: '',
    status: 'all',
  });
  const [filters, setFilters] = useState(draft);

  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'clicks', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);

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

  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const menuRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from: filters.from, to: filters.to };
      if (filters.title) params.title = filters.title;
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.connectedFrom) params.connectedFrom = filters.connectedFrom;
      if (filters.connectedTo) params.connectedTo = filters.connectedTo;

      const { data } = await api.get('/sources/table', { params });
      setRows(data.rows);
      setTotals(data.totals);
      setSelected(new Set());
    } catch (err) {
      setError(errMsg(err, 'Could not load traffic channels'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = useCallback((row) => {
    setFormError('');
    setEditing(sourceToForm(row));
  }, []);

  /**
   * Catch the refresh token the OAuth proxy appends to this page's address on
   * the way back from Google.
   *
   * It travels in the URL because the proxy returns the browser here rather
   * than calling the API, so it is stripped from the address bar before
   * anything else - a refresh token has no business sitting in history. The
   * channel it belongs to was left behind when the sign-in started, since the
   * proxy carries nothing through but the token itself.
   */
  useEffect(() => {
    const { search, hash } = window.location;
    const params = new URLSearchParams(search.replace(/^\?/, ''));
    if (hash.includes('?')) {
      for (const [k, v] of new URLSearchParams(hash.slice(hash.indexOf('?') + 1))) params.set(k, v);
    }

    const key = GOOGLE_TOKEN_KEYS.find((k) => params.get(k));
    const oauthError = params.get('error') || params.get('oauth_error');
    if (!key && !oauthError) return;

    const token = key ? params.get(key) : '';
    const channelId = localStorage.getItem(PENDING_GOOGLE_CHANNEL);
    localStorage.removeItem(PENDING_GOOGLE_CHANNEL);
    window.history.replaceState({}, '', window.location.pathname);

    if (oauthError) return setError(oauthError);
    if (!channelId) return setError('Signed in, but the channel this was for is no longer known.');

    api
      .post(`/sources/${channelId}/integration/google/token`, { refresh_token: token })
      .then(({ data }) => {
        if (data.ok) {
          setNotice(`Google connected — ${data.integration.accountName}`);
          setTimeout(() => setNotice(''), 6000);
        } else {
          setError(data.integration.lastError || 'Google rejected the connection.');
        }
        load();
      })
      .catch((err) => setError(errMsg(err, 'Could not save the Google connection')));
    // load is stable for the initial filters, and this must run exactly once
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
    });
  }, [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const visible = sorted.slice((page - 1) * perPage, page * perPage);
  const selectedIds = [...selected];
  const one = selectedIds.length === 1 ? rows.find((r) => String(r._id) === selectedIds[0]) : null;
  const allOnPageSelected = visible.length > 0 && visible.every((r) => selected.has(String(r._id)));

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyFilters = () => {
    setPage(1);
    setFilters(draft);
  };

  const stepDates = (dir) => {
    const span = Math.round((new Date(draft.to) - new Date(draft.from)) / 86400000) + 1;
    const next = { ...draft, from: shiftKey(draft.from, dir * span), to: shiftKey(draft.to, dir * span) };
    setDraft(next);
    setFilters(next);
    setPage(1);
  };

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (editing._id) await api.put(`/sources/${editing._id}`, editing);
      else await api.post('/sources', editing);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save the channel'));
    } finally {
      setSaving(false);
    }
  };

  const bulk = async (body, message) => {
    try {
      await api.post('/sources/bulk', { ids: selectedIds, ...body });
      setNotice(message);
      setTimeout(() => setNotice(''), 3000);
      setMenu(null);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const clone = async () => {
    try {
      const { data } = await api.post(`/sources/${selectedIds[0]}/clone`);
      setNotice(`Cloned as "${data.name}" — starts paused.`);
      setTimeout(() => setNotice(''), 4000);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const removeSelected = async () => {
    const n = selectedIds.length;
    const ok = await confirm({
      title: 'Confirm delete',
      message: `Are you sure you want to delete ${n} traffic channel${n === 1 ? '' : 's'}?`,
      note: 'This cannot be undone. Recorded clicks and stats are kept.',
    });
    if (!ok) return;
    bulk({ action: 'delete' }, `${selectedIds.length} channel(s) deleted.`);
  };

  const exportCsv = () => {
    const header = columns.map((c) => c.label);
    const body = sorted.map((r) =>
      columns.map((c) => {
        const s = String(r[c.key] ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
    );
    const csv = [header, ...body].map((l) => l.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `traffic-channels-${filters.from}_${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetTable = () => {
    savePrefs({ hidden: DEFAULT_HIDDEN, density: 'standard' });
    setSort({ key: 'clicks', dir: 'desc' });
    setPerPage(100);
    setPage(1);
    setMenu(null);
  };

  const toggleSort = (key) =>
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      return prev.dir === 'desc' ? { key, dir: 'asc' } : null;
    });

  return (
    <Page
      title="Traffic Channels"
      actions={
        <>
          <button type="button" className="btn primary" onClick={() => setCatalogOpen(true)}>
            + New From Template
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setFormError('');
              setEditing(blankSource());
            }}
          >
            + New From Scratch
          </button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="filter-bar">
        <Field label={`Date ${filters.from} — ${filters.to}`} className="span-2">
          <div className="date-step">
            <button type="button" className="step-btn" onClick={() => stepDates(-1)} title="Previous period">
              ‹
            </button>
            <input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            <input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            <button type="button" className="step-btn" onClick={() => stepDates(1)} title="Next period">
              ›
            </button>
          </div>
        </Field>

        <Field
          label={draft.connectedFrom || draft.connectedTo ? 'Date connected' : 'Date connected — no date selected'}
          className="span-2"
        >
          <div className="date-step">
            <input
              type="date"
              value={draft.connectedFrom}
              onChange={(e) => setDraft({ ...draft, connectedFrom: e.target.value })}
            />
            <input
              type="date"
              value={draft.connectedTo}
              onChange={(e) => setDraft({ ...draft, connectedTo: e.target.value })}
            />
            <button
              type="button"
              className="step-btn"
              onClick={() => setDraft({ ...draft, connectedFrom: '', connectedTo: '' })}
              title="Clear"
            >
              ×
            </button>
          </div>
        </Field>

        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            placeholder="Title"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </Field>

        <Field label="Status">
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="all">All but deleted</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </Field>

        <div className="filter-actions">
          <button type="button" className="btn primary" onClick={applyFilters} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Apply'}
          </button>
        </div>
      </div>

      <div className="action-bar" ref={menuRef}>
        <button type="button" className="action-btn" onClick={() => setCatalogOpen(true)}>
          <span className="ico">＋</span> New From Template
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={!one}
          onClick={() => {
            setFormError('');
            setEditing(sourceToForm(one));
          }}
        >
          <span className="ico">✎</span> Edit
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={!one}
          onClick={() => navigate(`/campaigns?trafficSourceId=${one._id}`)}
        >
          <span className="ico">▥</span> Report
        </button>
        <button type="button" className="action-btn" disabled={!one} onClick={clone}>
          <span className="ico">⧉</span> Clone
        </button>

        <div className="popover-wrap">
          <button
            type="button"
            className="action-btn"
            disabled={selectedIds.length === 0}
            onClick={() => setMenu(menu === 'status' ? null : 'status')}
          >
            <span className="ico">◉</span> Change status ⌄
          </button>
          {menu === 'status' && (
            <div className="popover">
              <label onClick={() => bulk({ action: 'status', status: 'active' }, 'Channels activated.')}>Activate</label>
              <label onClick={() => bulk({ action: 'status', status: 'paused' }, 'Channels paused.')}>Pause</label>
            </div>
          )}
        </div>

        <div className="action-sep" />

        <button type="button" className="action-btn" disabled={selectedIds.length === 0} onClick={removeSelected}>
          <span className="ico">🗑</span> Delete
        </button>

        <span className="mute" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {selectedIds.length ? `${selectedIds.length} selected` : `${rows.length} channels`}
        </span>
      </div>

      <div className="panel">
        <div className="table-tools">
          <button type="button" className="tool-btn" onClick={exportCsv} disabled={!rows.length}>
            ⭱ Export
          </button>

          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'columns' ? null : 'columns')}>
              ▥ Columns
            </button>
            {menu === 'columns' && (
              <div className="popover">
                {ALL_COLUMNS.map((c) => (
                  <label key={c.key}>
                    <input
                      type="checkbox"
                      disabled={c.always}
                      checked={c.always || !prefs.hidden.includes(c.key)}
                      onChange={(e) =>
                        savePrefs({
                          ...prefs,
                          hidden: e.target.checked
                            ? prefs.hidden.filter((k) => k !== c.key)
                            : [...prefs.hidden, c.key],
                        })
                      }
                    />
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
                  <label key={d} onClick={() => savePrefs({ ...prefs, density: d })}>
                    <input type="radio" readOnly checked={prefs.density === d} style={{ width: 'auto' }} />
                    {d}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="tool-btn" onClick={resetTable}>
            ↺ Table reset
          </button>
        </div>

        <div className="table-wrap">
          <table className={`data density-${prefs.density}`}>
            <thead>
              <tr>
                <th className="check no-sort">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        visible.forEach((r) =>
                          e.target.checked ? next.add(String(r._id)) : next.delete(String(r._id))
                        );
                        return next;
                      })
                    }
                  />
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={c.num ? 'num' : ''}
                    style={c.width ? { width: c.width } : undefined}
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}
                    {sort?.key === c.key && <span className="sort-caret">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
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
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="table-empty">
                    No traffic channels match these filters
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((r) => {
                  const id = String(r._id);
                  return (
                    <tr
                      key={id}
                      className={selected.has(id) ? 'row-selected' : ''}
                      onDoubleClick={() => openEdit(r)}
                    >
                      <td className="check">
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                      {columns.map((c) => (
                        <td key={c.key} className={c.num ? 'num' : ''}>
                          {cellValue(r, c.key, { onEdit: openEdit })}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
            {totals && !loading && visible.length > 0 && (
              <tfoot>
                <tr>
                  <td className="check" />
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : ''}>
                      {totalValue(totals, c.key)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="pager">
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <div className="pager-mid">
            <span>Page</span>
            <input
              type="number"
              min="1"
              max={pageCount}
              value={page}
              onChange={(e) => setPage(Math.min(Math.max(1, Number(e.target.value) || 1), pageCount))}
            />
            <span>of {pageCount}</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {[25, 50, 100, 250].map((n) => (
                <option key={n} value={n}>
                  {n} rows
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        Double-click a row to edit it. Metrics are matched by the channel name stored on each click, so renaming a
        channel splits its history.
      </div>

      {catalogOpen && (
        <SourceCatalogModal
          onClose={() => setCatalogOpen(false)}
          onAdded={(draft) => {
            setCatalogOpen(false);
            setFormError('');
            // A draft, not a row - nothing to reload until Save writes it.
            setEditing(sourceToForm(draft));
          }}
        />
      )}

      {editing && (
        <SourceModal
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          error={formError}
        />
      )}
      {confirmUI}
    </Page>
  );
}
