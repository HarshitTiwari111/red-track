import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import useConfirm from '../components/ConfirmModal.jsx';
import Modal from '../components/Modal.jsx';
import Field from '../components/Field.jsx';
import CampaignModal, { blankCampaign, campaignToForm } from '../components/CampaignModal.jsx';
import { fmtMoney, fmtNum, fmtPct } from '../components/StatCard.jsx';
import { campaignsApi, landersApi, offersApi, sourcesApi, costApi, api, errMsg } from '../api/client.js';

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  return toKey(new Date(y, m - 1, d + days));
};
const todayKey = () => toKey(new Date());

const STORAGE = 'kap.campaigns.table';

const ALL_COLUMNS = [
  { key: 'index', label: '#', num: true, width: 54, always: true },
  { key: 'name', label: 'Title', always: true },
  { key: 'status', label: 'Campaign status' },
  { key: 'sourceName', label: 'Traffic channel' },
  { key: 'funnels', label: 'Funnels', num: true },
  { key: 'clicks', label: 'Clicks', num: true },
  { key: 'lpClicks', label: 'LP clicks', num: true },
  { key: 'uniques', label: 'Uniques', num: true },
  { key: 'conversions', label: 'Conversions', num: true },
  { key: 'cr', label: 'CR', num: true },
  { key: 'revenue', label: 'Total revenue', num: true },
  { key: 'cost', label: 'Cost', num: true },
  { key: 'profit', label: 'Profit', num: true },
  { key: 'roi', label: 'Total ROI', num: true },
  { key: 'epc', label: 'EPC', num: true },
  { key: 'cpc', label: 'CPC', num: true },
  { key: 'cpa', label: 'CPA', num: true },
  { key: 'tags', label: 'Tags' },
];

const DEFAULT_HIDDEN = ['uniques', 'cpa', 'funnels'];
const DENSITIES = ['compact', 'standard', 'comfortable'];
const money = (v) => `$ ${fmtMoney(v)}`;

function cellValue(row, key, { onEdit, trackingUrl }) {
  switch (key) {
    case 'index':
      return row.index;
    case 'name':
      return (
        <>
          {/* The title opens the campaign; the link under it goes where the
              campaign actually sends traffic, so the two must not share a
              click. */}
          <button type="button" className="cell-link" onClick={() => onEdit(row)}>
            {row.name}
          </button>
          <a
            className="cell-sub cell-url"
            href={trackingUrl(row)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={trackingUrl(row)}
          >
            {trackingUrl(row)}
          </a>
        </>
      );
    case 'status':
      return <span className={`badge ${row.status}`}>{row.status}</span>;
    case 'sourceName':
      return row.sourceName || <span className="mute">—</span>;
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
      return fmtPct(row[key]);
    case 'epc':
    case 'cpc':
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
    case 'sourceName':
    case 'tags':
    case 'funnels':
      return '';
    case 'cr':
    case 'roi':
      return fmtPct(totals[key]);
    case 'epc':
    case 'cpc':
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

export default function Campaigns() {
  const [confirm, confirmUI] = useConfirm();
  const navigate = useNavigate();
  // The Traffic Channels page links here with ?trafficSourceId=… ("Report")
  const [searchParams] = useSearchParams();

  const [draft, setDraft] = useState({
    from: todayKey(),
    to: todayKey(),
    title: '',
    tags: '',
    trafficSourceId: searchParams.get('trafficSourceId') || '',
    status: 'all',
  });
  const [filters, setFilters] = useState(draft);

  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [knownTags, setKnownTags] = useState([]);
  const [refs, setRefs] = useState({ sources: [], offers: [], landers: [] });
  const [templates, setTemplates] = useState([]);
  const [domains, setDomains] = useState([]);
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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [tagModal, setTagModal] = useState(null);
  const [costModal, setCostModal] = useState(null);
  const menuRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from: filters.from, to: filters.to };
      if (filters.title) params.title = filters.title;
      if (filters.tags) params.tags = filters.tags;
      if (filters.trafficSourceId) params.trafficSourceId = filters.trafficSourceId;
      if (filters.status !== 'all') params.status = filters.status;

      const { data } = await api.get('/campaigns/table', { params });
      setRows(data.rows);
      setTotals(data.totals);
      setKnownTags(data.tags);
      setSelected(new Set());
    } catch (err) {
      setError(errMsg(err, 'Could not load campaigns'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([sourcesApi.list(), offersApi.list(), landersApi.list()])
      .then(([sources, offers, landers]) => setRefs({ sources, offers, landers }))
      .catch(() => {});
    api.get('/funnels').then((r) => setTemplates(r.data.items || [])).catch(() => {});
    api.get('/domains').then((r) => setDomains(r.data.items || [])).catch(() => {});
  }, []);

  const openEdit = useCallback((row) => {
    setFormError('');
    setEditing(campaignToForm(row));
  }, []);

  /**
   * The link a campaign actually hands to a traffic source. Built from the
   * campaign's own tracking domain, falling back to the default one and then to
   * this host - the same order the campaign form previews it in.
   */
  const trackingUrl = useCallback(
    (row) => {
      const chosen =
        domains.find((d) => String(d._id) === String(row.domainId)) || domains.find((d) => d.isDefault);
      const base = chosen ? `${chosen.protocol}://${chosen.host}` : window.location.origin;
      return `${base}/c/${row.slug}`;
    },
    [domains]
  );

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
      if (editing._id) await campaignsApi.update(editing._id, editing);
      else await campaignsApi.create(editing);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save the campaign'));
    } finally {
      setSaving(false);
    }
  };

  const bulk = async (body, message) => {
    try {
      await api.post('/campaigns/bulk', { ids: selectedIds, ...body });
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
      const c = await api.post(`/campaigns/${selectedIds[0]}/clone`);
      setNotice(`Cloned as "${c.data.name}" (${c.data.slug}) — starts paused.`);
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
      message: `Are you sure you want to delete ${n} campaign${n === 1 ? '' : 's'}?`,
      note: 'This cannot be undone. Recorded clicks and stats are kept.',
    });
    if (!ok) return;
    bulk({ action: 'delete' }, `${selectedIds.length} campaign(s) deleted.`);
  };

  const pushCost = async () => {
    try {
      const res = await costApi.push({
        campaignId: costModal.campaignId,
        from: filters.from,
        to: filters.to,
        totalCost: Number(costModal.totalCost),
        note: costModal.note,
      });
      setNotice(`Distributed ${costModal.totalCost} across ${res.clicks} clicks (${res.perClick} per click).`);
      setTimeout(() => setNotice(''), 4000);
      setCostModal(null);
      load();
    } catch (err) {
      setError(errMsg(err));
      setCostModal(null);
    }
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
    a.download = `campaigns-${filters.from}_${filters.to}.csv`;
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
      title="Campaigns"
      actions={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormError('');
            setEditing(blankCampaign());
          }}
        >
          + Create new campaign
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

        <Field label="Traffic channels">
          <select
            value={draft.trafficSourceId}
            onChange={(e) => setDraft({ ...draft, trafficSourceId: e.target.value })}
          >
            <option value="">All traffic channels</option>
            {refs.sources.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
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
        <button
          type="button"
          className="action-btn"
          onClick={() => {
            setFormError('');
            setEditing(blankCampaign());
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
            setEditing(campaignToForm(one));
          }}
        >
          <span className="ico">✎</span> Edit
        </button>
        <button type="button" className="action-btn" disabled={!one} onClick={() => navigate(`/campaigns/${one._id}`)}>
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
              <label onClick={() => bulk({ action: 'status', status: 'active' }, 'Campaigns activated.')}>Activate</label>
              <label onClick={() => bulk({ action: 'status', status: 'paused' }, 'Campaigns paused.')}>Pause</label>
            </div>
          )}
        </div>

        <button
          type="button"
          className="action-btn"
          disabled={!one}
          onClick={() => setCostModal({ campaignId: one._id, name: one.name, totalCost: '', note: '' })}
        >
          <span className="ico">◍</span> Update costs
        </button>

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
          {selectedIds.length ? `${selectedIds.length} selected` : `${rows.length} campaigns`}
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
                    No campaigns match these filters
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
                          {cellValue(r, c.key, { onEdit: openEdit, trackingUrl })}
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
        Click a campaign name to edit it, or use Report to open the campaign&apos;s drilldowns and tracking links.
      </div>

      {editing && (
        <CampaignModal
          value={editing}
          sources={refs.sources}
          offers={refs.offers}
          landers={refs.landers}
          knownTags={knownTags}
          templates={templates}
          domains={domains}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          error={formError}
        />
      )}

      {costModal && (
        <Modal
          title={`Update costs — ${costModal.name}`}
          onClose={() => setCostModal(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCostModal(null)}>
                Close
              </button>
              <button type="button" className="btn primary" onClick={pushCost} disabled={!costModal.totalCost}>
                Distribute cost
              </button>
            </>
          }
        >
          <div className="alert info">
            The total is spread evenly across every non-bot click between {filters.from} and {filters.to}, and written to
            both the raw clicks and the hourly stats.
          </div>
          <Field label="Total cost for the selected range" suffix="$">
            <input
              type="number"
              step="0.01"
              min="0"
              value={costModal.totalCost}
              onChange={(e) => setCostModal({ ...costModal, totalCost: e.target.value })}
              placeholder="250.00"
            />
          </Field>
          <Field label="Note">
            <input
              type="text"
              value={costModal.note}
              onChange={(e) => setCostModal({ ...costModal, note: e.target.value })}
              placeholder="Google Ads invoice"
            />
          </Field>
        </Modal>
      )}

      {tagModal && (
        <Modal
          title={`Edit tags — ${selectedIds.length} campaign(s)`}
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
              placeholder="search, in-geo, q3"
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
      {confirmUI}
    </Page>
  );
}
