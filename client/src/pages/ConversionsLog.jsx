import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import Modal from '../components/Modal.jsx';
import Field from '../components/Field.jsx';
import { fmtMoney, fmtNum } from '../components/StatCard.jsx';
import { campaignsApi, networksApi, offersApi, sourcesApi, api, errMsg } from '../api/client.js';

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  return toKey(new Date(y, m - 1, d + days));
};
const todayKey = () => toKey(new Date());
const time = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

const STORAGE = 'kap.conversions.table';
const STATUSES = ['approved', 'pending', 'rejected'];
const TYPES = ['lead', 'sale', 'deposit', 'custom'];
const DENSITIES = ['compact', 'standard', 'comfortable'];
const money = (v) => `$ ${fmtMoney(v)}`;
const subCols = (prefix, label) =>
  Array.from({ length: 20 }, (_, i) => ({ key: `${prefix}${i + 1}`, label: `${label}${i + 1}` }));

const ALL_COLUMNS = [
  { key: 'index', label: '#', num: true, width: 54, always: true },
  { key: 'clickid', label: 'Click ID', always: true, mono: true },
  { key: 'clickTs', label: 'Clicks Time', render: (r) => time(r.clickTs) },
  { key: 'ts', label: 'Conversion Time', render: (r) => time(r.ts) },
  { key: 'campaignName', label: 'Campaign' },
  { key: 'campaignId', label: 'Campaign ID', mono: true },
  { key: 'offerName', label: 'Offer' },
  { key: 'status', label: 'Status', render: (r) => <span className={`badge ${r.status}`}>{r.status}</span> },
  { key: 'duplicateStatus', label: 'Duplicate status' },
  { key: 'sourceName', label: 'Traffic channel' },
  { key: 'networkName', label: 'Offer source' },
  { key: 'cost', label: 'Cost', num: true, render: (r) => money(r.cost) },
  { key: 'payout', label: 'Payout', num: true, render: (r) => money(r.payout) },
  { key: 'publisherRevenue', label: 'Publisher Revenue', num: true, render: (r) => money(r.publisherRevenue) },
  { key: 'landerName', label: 'Landings' },
  { key: 'deeplink', label: 'Deeplink', mono: true, wide: true },
  { key: 'country', label: 'Country' },
  { key: 'city', label: 'City' },
  { key: 'os', label: 'OS' },
  { key: 'browser', label: 'Browser' },
  { key: 'device', label: 'Device' },
  { key: 'ip', label: 'IP', mono: true },
  { key: 'ua', label: 'User agent', mono: true, wide: true },
  { key: 'refId', label: 'Ref ID', mono: true },
  { key: 'postbackIp', label: 'Postback IP', mono: true },
  { key: 'txid', label: 'Deduplicate Token', mono: true },
  { key: 'type', label: 'Type' },
  { key: 'event', label: 'Event' },
  { key: 'coupon', label: 'Coupon' },
  { key: 'source', label: 'Via', render: (r) => <span className="badge neutral">{r.source}</span> },
  { key: 'conversion', label: 'conversion', num: true },
  ...subCols('clickSub', 'clickSub'),
  ...subCols('convSub', 'convSub'),
  { key: 'utmSource', label: 'Rt source' },
  { key: 'utmMedium', label: 'Rt medium' },
  { key: 'utmCampaign', label: 'Rt campaign' },
  { key: 'utmAdgroup', label: 'Rt adgroup' },
  { key: 'utmAd', label: 'Rt ad' },
  { key: 'utmPlacement', label: 'Rt placement' },
  { key: 'utmKeyword', label: 'Rt keyword' },
];

/** Everything past the core set starts hidden — 70+ visible columns is unusable. */
const VISIBLE_BY_DEFAULT = [
  'index', 'clickid', 'clickTs', 'ts', 'campaignName', 'offerName', 'status',
  'duplicateStatus', 'sourceName', 'networkName', 'payout', 'type', 'country', 'source',
];
const DEFAULT_HIDDEN = ALL_COLUMNS.map((c) => c.key).filter((k) => !VISIBLE_BY_DEFAULT.includes(k));

function cellValue(row, col) {
  if (col.render) return col.render(row);
  const v = row[col.key];
  if (col.key === 'conversion') return fmtNum(v);
  if (v === undefined || v === null || v === '') return <span className="mute">—</span>;
  if (col.mono) {
    return (
      <span className={col.wide ? 'mono truncate' : 'mono'} title={String(v)}>
        {String(v)}
      </span>
    );
  }
  return String(v);
}

function totalValue(totals, key) {
  switch (key) {
    case 'index':
      return '';
    case 'clickid':
      return 'Total:';
    case 'conversion':
      return fmtNum(totals.conversion);
    case 'payout':
      return money(totals.payout);
    case 'cost':
      return money(totals.cost);
    case 'publisherRevenue':
      return money(totals.publisherRevenue);
    default:
      return '';
  }
}

export default function ConversionsLog() {
  // The Offers page links here with ?offerId=… ("Conversion report")
  const [searchParams, setSearchParams] = useSearchParams();

  const [draft, setDraft] = useState({
    from: todayKey(),
    to: todayKey(),
    clickid: '',
    campaignId: '',
    trafficSourceId: '',
    networkId: '',
    offerId: searchParams.get('offerId') || '',
    type: '',
    status: '',
  });
  const [filters, setFilters] = useState(draft);

  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [refs, setRefs] = useState({ campaigns: [], networks: [], offers: [], sources: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'ts', dir: 'desc' });
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
  const [addModal, setAddModal] = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    Promise.all([campaignsApi.list(), networksApi.list(), offersApi.list(), sourcesApi.list()])
      .then(([campaigns, networks, offers, sources]) => setRefs({ campaigns, networks, offers, sources }))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from: filters.from, to: filters.to, limit: 2000 };
      if (filters.clickid) params.clickid = filters.clickid;
      if (filters.campaignId) params.campaignId = filters.campaignId;
      if (filters.networkId) params.networkId = filters.networkId;
      if (filters.offerId) params.offerId = filters.offerId;
      if (filters.type) params.type = filters.type;
      if (filters.status) params.status = filters.status;

      const { data } = await api.get('/conversions/table', { params });
      setRows(data.rows);
      setTotals(data.totals);
      setSelected(new Set());
    } catch (err) {
      setError(errMsg(err, 'Could not load conversions'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

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
    setSearchParams(draft.offerId ? { offerId: draft.offerId } : {});
  };

  const stepDates = (dir) => {
    const span = Math.round((new Date(draft.to) - new Date(draft.from)) / 86400000) + 1;
    const next = { ...draft, from: shiftKey(draft.from, dir * span), to: shiftKey(draft.to, dir * span) };
    setDraft(next);
    setFilters(next);
    setPage(1);
  };

  const submitManual = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/conversions/manual', addModal);
      setNotice(
        `Added ${data.added}, ${data.duplicates} duplicate(s), ${data.failed} failed.` +
          (data.errors.length ? ` First problem: ${data.errors[0]}` : '')
      );
      setTimeout(() => setNotice(''), 8000);
      setAddModal(null);
      load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/conversions/bulk-status', { ids: selectedIds, status: statusModal.status });
      setNotice(`${data.updated} conversion(s) set to ${statusModal.status}.`);
      setTimeout(() => setNotice(''), 4000);
      setStatusModal(null);
      load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setAddModal({ text, type: 'lead', status: 'approved' });
    e.target.value = '';
  };

  const download = (name, content, mime = 'text/csv;charset=utf-8') => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = columns.map((c) => c.label);
    const body = sorted.map((r) =>
      columns.map((c) => {
        const v = c.key === 'clickTs' || c.key === 'ts' ? time(r[c.key]) : r[c.key];
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
    );
    download(`conversions-${filters.from}_${filters.to}.csv`, [header, ...body].map((l) => l.join(',')).join('\n'));
  };

  /** Google Ads offline conversion import format — needs a gclid on the click. */
  const exportGoogleAds = () => {
    const withGclid = sorted.filter((r) => r.rawQuery?.gclid || r.gclid);
    if (!withGclid.length) {
      setError('No conversions in this range carry a gclid, so there is nothing Google Ads can import.');
      return;
    }
    const header = ['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency'];
    const body = withGclid.map((r) => [
      r.gclid || r.rawQuery?.gclid,
      r.type || 'lead',
      new Date(r.ts).toISOString(),
      r.payout ?? 0,
      'USD',
    ]);
    download(
      `google-ads-conversions-${filters.from}_${filters.to}.csv`,
      ['Parameters:TimeZone=UTC', header.join(','), ...body.map((l) => l.join(','))].join('\n')
    );
  };

  const resetTable = () => {
    savePrefs({ hidden: DEFAULT_HIDDEN, density: 'standard' });
    setSort({ key: 'ts', dir: 'desc' });
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
      title="Conversions"
      actions={
        <button type="button" className="btn primary" onClick={() => setAddModal({ text: '', type: 'lead', status: 'approved' })}>
          + Add conversions
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

        <Field label="Click ID">
          <input
            type="text"
            value={draft.clickid}
            placeholder="Click ID"
            onChange={(e) => setDraft({ ...draft, clickid: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </Field>

        <Field label="Campaign">
          <select value={draft.campaignId} onChange={(e) => setDraft({ ...draft, campaignId: e.target.value })}>
            <option value="">All campaigns</option>
            {refs.campaigns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Offer source">
          <select value={draft.networkId} onChange={(e) => setDraft({ ...draft, networkId: e.target.value })}>
            <option value="">All networks</option>
            {refs.networks.map((n) => (
              <option key={n._id} value={n._id}>
                {n.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Offer">
          <select value={draft.offerId} onChange={(e) => setDraft({ ...draft, offerId: e.target.value })}>
            <option value="">All offers</option>
            {refs.offers.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Type">
          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status">
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
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
        <button type="button" className="action-btn" onClick={() => setAddModal({ text: '', type: 'lead', status: 'approved' })}>
          <span className="ico">＋</span> Add conversions
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={selectedIds.length === 0}
          onClick={() => setStatusModal({ status: 'approved' })}
        >
          <span className="ico">✎</span> Update status
        </button>
        <button type="button" className="action-btn" onClick={() => fileRef.current?.click()}>
          <span className="ico">🖇</span> Upload
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={onUpload} />

        <span className="mute" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {selectedIds.length ? `${selectedIds.length} selected` : `${rows.length} conversions`}
        </span>
      </div>

      <div className="panel">
        <div className="table-tools">
          <button type="button" className="tool-btn" onClick={exportCsv} disabled={!rows.length}>
            ⭱ Export
          </button>
          <button type="button" className="tool-btn" onClick={exportGoogleAds} disabled={!rows.length}>
            ⭱ Export (Google Ads)
          </button>

          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'columns' ? null : 'columns')}>
              ▥ Columns
            </button>
            {menu === 'columns' && (
              <div className="popover tall">
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
                    No conversions in this period
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((r) => {
                  const id = String(r._id);
                  return (
                    <tr key={id} className={selected.has(id) ? 'row-selected' : ''}>
                      <td className="check">
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                      {columns.map((c) => (
                        <td key={c.key} className={c.num ? 'num' : ''}>
                          {cellValue(r, c)}
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
        Most columns start hidden — use <strong>Columns</strong> to show the sub, UTM and device fields. Changing a
        status re-adjusts revenue and conversion counts in the reports automatically.
      </div>

      {addModal && (
        <Modal
          title="Add conversions"
          onClose={() => setAddModal(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAddModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={submitManual} disabled={busy || !addModal.text.trim()}>
                {busy ? <span className="spinner" /> : 'Save'}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Please add click id and payout amount separated by comma, one per line</p>
          <textarea
            className="mono"
            style={{ minHeight: 150 }}
            value={addModal.text}
            onChange={(e) => setAddModal({ ...addModal, text: e.target.value })}
            placeholder={'Example:\nWkmeTq5Bb4DJ,\n3waNKXmGjVAc, 5'}
          />
          <div className="field-row" style={{ marginTop: 14 }}>
            <Field label="Type">
              <select value={addModal.type} onChange={(e) => setAddModal({ ...addModal, type: e.target.value })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={addModal.status} onChange={(e) => setAddModal({ ...addModal, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="rt-hint">
            A blank payout falls back to the offer&apos;s default when its payout type is fixed.
          </div>
        </Modal>
      )}

      {statusModal && (
        <Modal
          title={`Update status — ${selectedIds.length} conversion(s)`}
          onClose={() => setStatusModal(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setStatusModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={submitStatus} disabled={busy}>
                {busy ? <span className="spinner" /> : 'Save'}
              </button>
            </>
          }
        >
          <Field label="New status">
            <select value={statusModal.status} onChange={(e) => setStatusModal({ status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <div className="rt-hint">
            Reports are adjusted by the difference — rejected conversions stop counting toward revenue.
          </div>
        </Modal>
      )}
    </Page>
  );
}
