import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import Modal from '../components/Modal.jsx';
import Field from '../components/Field.jsx';
import LanderModal, { blankLander, landerToForm, LANDER_TYPES } from '../components/LanderModal.jsx';
import { fmtMoney, fmtNum, fmtPct } from '../components/StatCard.jsx';
import { api, errMsg } from '../api/client.js';

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  return toKey(new Date(y, m - 1, d + days));
};
const todayKey = () => toKey(new Date());

const STORAGE = 'kap.landers.table';

const ALL_COLUMNS = [
  { key: 'index', label: '#', num: true, width: 54, always: true },
  { key: 'name', label: 'Title', always: true },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'lpViews', label: 'LP views', num: true },
  { key: 'lpClicks', label: 'LP clicks', num: true },
  { key: 'lpCtr', label: 'LP CTR', num: true },
  { key: 'uniques', label: 'Uniques', num: true },
  { key: 'conversions', label: 'Conversions', num: true },
  { key: 'cr', label: 'CR', num: true },
  { key: 'cpa', label: 'Total CPA', num: true },
  { key: 'epc', label: 'EPC', num: true },
  { key: 'revenue', label: 'Total revenue', num: true },
  { key: 'cost', label: 'Cost', num: true },
  { key: 'profit', label: 'Profit', num: true },
  { key: 'roi', label: 'Total ROI', num: true },
  { key: 'tags', label: 'Tags' },
];

const DEFAULT_HIDDEN = ['uniques'];
const DENSITIES = ['compact', 'standard', 'comfortable'];
const money = (v) => `$ ${fmtMoney(v)}`;
const typeLabel = (id) => LANDER_TYPES.find((t) => t.id === id)?.label || 'Landing';

function cellValue(row, key) {
  switch (key) {
    case 'index':
      return row.index;
    case 'name':
      return (
        <>
          {row.name}
          <span className="cell-sub" title={row.url}>
            {row.url}
          </span>
        </>
      );
    case 'type':
      return <span className="badge neutral">{typeLabel(row.type)}</span>;
    case 'status':
      return <span className={`badge ${row.status}`}>{row.status}</span>;
    case 'tags':
      return row.tags?.length ? (
        <span className="chips">
          {row.tags.map((t) => (
            <span className="chip" key={t}>
              {t}
            </span>
          ))}
        </span>
      ) : (
        <span className="mute">—</span>
      );
    case 'cr':
    case 'roi':
    case 'lpCtr':
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
    case 'type':
    case 'status':
    case 'tags':
      return '';
    case 'cr':
    case 'roi':
    case 'lpCtr':
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

export default function Landers() {
  const [draft, setDraft] = useState({ from: todayKey(), to: todayKey(), title: '', tags: '', type: 'all' });
  const [filters, setFilters] = useState(draft);

  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [knownTags, setKnownTags] = useState([]);
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'lpViews', dir: 'desc' });
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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [tagModal, setTagModal] = useState(null);
  const menuRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from: filters.from, to: filters.to };
      if (filters.title) params.title = filters.title;
      if (filters.tags) params.tags = filters.tags;
      if (filters.type !== 'all') params.type = filters.type;

      const { data } = await api.get('/landers/table', { params });
      setRows(data.rows);
      setTotals(data.totals);
      setKnownTags(data.tags);
      setSelected(new Set());
    } catch (err) {
      setError(errMsg(err, 'Could not load landers'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  // The modal builds its click URL and script snippet on one of these
  useEffect(() => {
    api
      .get('/domains')
      .then((r) => setDomains(r.data.items || []))
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
      if (editing._id) await api.put(`/landers/${editing._id}`, editing);
      else await api.post('/landers', editing);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save the lander'));
    } finally {
      setSaving(false);
    }
  };

  const bulk = async (body, message) => {
    try {
      await api.post('/landers/bulk', { ids: selectedIds, ...body });
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
      const res = await api.post(`/landers/${selectedIds[0]}/clone`);
      setNotice(`Cloned as "${res.data.name}" — starts paused.`);
      setTimeout(() => setNotice(''), 4000);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const removeSelected = () => {
    if (!window.confirm(`Delete ${selectedIds.length} lander(s)? Recorded clicks and stats are kept.`)) return;
    bulk({ action: 'delete' }, `${selectedIds.length} lander(s) deleted.`);
  };

  const exportCsv = () => {
    const header = columns.map((c) => c.label);
    const body = sorted.map((r) =>
      columns.map((c) => {
        const v = c.key === 'tags' ? (r.tags || []).join(' ') : r[c.key];
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
    );
    const csv = [header, ...body].map((l) => l.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `landers-${filters.from}_${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetTable = () => {
    savePrefs({ hidden: DEFAULT_HIDDEN, density: 'standard' });
    setSort({ key: 'lpViews', dir: 'desc' });
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
      title="Landers"
      actions={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormError('');
            setEditing(blankLander());
          }}
        >
          + Create new lander
        </button>
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

        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            placeholder="Title"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </Field>

        <Field label="Tags">
          <select value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })}>
            <option value="">All tags</option>
            {knownTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Type">
          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="all">All types</option>
            {LANDER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="filter-actions">
          <button type="button" className="btn primary" onClick={applyFilters} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Apply'}
          </button>
        </div>
      </div>

      <div className="action-bar" ref={menuRef}>
        <button
          type="button"
          className="action-btn"
          onClick={() => {
            setFormError('');
            setEditing(blankLander());
          }}
        >
          <span className="ico">＋</span> New
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={!one}
          onClick={() => {
            setFormError('');
            setEditing(landerToForm(one));
          }}
        >
          <span className="ico">✎</span> Edit
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
              <label onClick={() => bulk({ action: 'status', status: 'active' }, 'Landers activated.')}>Activate</label>
              <label onClick={() => bulk({ action: 'status', status: 'paused' }, 'Landers paused.')}>Pause</label>
            </div>
          )}
        </div>

        <div className="action-sep" />

        <button
          type="button"
          className="action-btn"
          disabled={selectedIds.length === 0}
          onClick={() => setTagModal({ tags: '', mode: 'addTags' })}
        >
          <span className="ico">🏷</span> Edit tags
        </button>
        <button type="button" className="action-btn" disabled={selectedIds.length === 0} onClick={removeSelected}>
          <span className="ico">🗑</span> Delete
        </button>

        <span className="mute" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {selectedIds.length ? `${selectedIds.length} selected` : `${rows.length} landers`}
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
                    No landers match these filters
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
                      onDoubleClick={() => {
                        setFormError('');
                        setEditing(landerToForm(r));
                      }}
                    >
                      <td className="check">
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                      {columns.map((c) => (
                        <td key={c.key} className={c.num ? 'num' : ''}>
                          {cellValue(r, c.key)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
            {/* Totals sit under the data, so they read as a summary of the rows above */}
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
        Double-click a row to edit it. LP views are the clicks routed to a lander; LP clicks are the visitors who then
        clicked through to the offer.
      </div>

      {editing && (
        <LanderModal
          value={editing}
          knownTags={knownTags}
          domains={domains}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          error={formError}
        />
      )}

      {tagModal && (
        <Modal
          title={`Edit tags — ${selectedIds.length} lander(s)`}
          onClose={() => setTagModal(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setTagModal(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const tags = tagModal.tags.split(',').map((t) => t.trim()).filter(Boolean);
                  bulk({ action: tagModal.mode, tags }, 'Tags updated.');
                  setTagModal(null);
                }}
              >
                Save
              </button>
            </>
          }
        >
          <Field label="Tags (comma separated)">
            <input
              type="text"
              value={tagModal.tags}
              onChange={(e) => setTagModal({ ...tagModal, tags: e.target.value })}
              placeholder="quiz, in-geo, variation-a"
            />
          </Field>
          <Field label="Mode">
            <select value={tagModal.mode} onChange={(e) => setTagModal({ ...tagModal, mode: e.target.value })}>
              <option value="addTags">Add to existing tags</option>
              <option value="setTags">Replace all tags</option>
            </select>
          </Field>
        </Modal>
      )}
    </Page>
  );
}
