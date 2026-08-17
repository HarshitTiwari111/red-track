import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import Field from '../components/Field.jsx';
import FunnelModal, { blankFunnel, funnelToForm, FUNNEL_TYPES } from '../components/FunnelModal.jsx';
import { landersApi, offersApi, api, errMsg } from '../api/client.js';

const STORAGE = 'kap.funnels.table';
const DENSITIES = ['compact', 'standard', 'comfortable'];
const typeLabel = (id) => FUNNEL_TYPES.find((t) => t.id === id)?.label || id;

export default function FunnelTemplates() {
  const [title, setTitle] = useState('');
  const [applied, setApplied] = useState('');

  const [rows, setRows] = useState([]);
  const [refs, setRefs] = useState({ landers: [], offers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);

  const [prefs, setPrefs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      return { density: saved.density || 'standard' };
    } catch {
      return { density: 'standard' };
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
  const menuRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/funnels', { params: applied ? { q: applied } : {} });
      setRows(data.items);
      setSelected(new Set());
    } catch (err) {
      setError(errMsg(err, 'Could not load funnel templates'));
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([landersApi.list(), offersApi.list()])
      .then(([landers, offers]) => setRefs({ landers, offers }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const nameOf = (list, id, key) => list.find((x) => String(x._id) === String(id))?.[key] || '—';

  const sorted = useMemo(() => [...rows].sort((a, b) => a.name.localeCompare(b.name)), [rows]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const visible = sorted.slice((page - 1) * perPage, page * perPage);
  const selectedIds = [...selected];
  const one = selectedIds.length === 1 ? rows.find((r) => String(r._id) === selectedIds[0]) : null;
  const allOnPage = visible.length > 0 && visible.every((r) => selected.has(String(r._id)));

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (editing._id) await api.put(`/funnels/${editing._id}`, editing);
      else await api.post('/funnels', editing);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save the funnel template'));
    } finally {
      setSaving(false);
    }
  };

  const clone = async () => {
    try {
      const { data } = await api.post(`/funnels/${selectedIds[0]}/clone`);
      setNotice(`Cloned as "${data.name}".`);
      setTimeout(() => setNotice(''), 4000);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const removeSelected = async () => {
    if (!window.confirm(`Delete ${selectedIds.length} funnel template(s)? Campaigns already built from them are not affected.`))
      return;
    try {
      await api.post('/funnels/bulk', { ids: selectedIds, action: 'delete' });
      setNotice(`${selectedIds.length} template(s) deleted.`);
      setTimeout(() => setNotice(''), 3000);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <Page
      title="Funnel templates"
      actions={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormError('');
            setEditing(blankFunnel());
          }}
        >
          + Create new funnel
        </button>
      }
    >
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="page-note">
        A template is a reusable funnel shape. Open a campaign, press <strong>Apply template</strong> in the Funnels
        panel, and it is copied in as a new funnel — later edits to the template do not reach campaigns already using
        it.
      </div>

      <div className="filter-bar">
        <Field label="Title">
          <input
            type="text"
            value={title}
            placeholder="Title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setApplied(title)}
          />
        </Field>
        <div className="filter-actions">
          <button type="button" className="btn primary" onClick={() => setApplied(title)} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Apply'}
          </button>
        </div>
      </div>

      <div className="action-bar" ref={menuRef}>
        <button
          type="button"
          className="action-btn"
          disabled={!one}
          onClick={() => {
            setFormError('');
            setEditing(funnelToForm(one));
          }}
        >
          <span className="ico">✎</span> Edit
        </button>
        <button type="button" className="action-btn" disabled={!one} onClick={clone}>
          <span className="ico">⧉</span> Clone
        </button>
        <button type="button" className="action-btn" disabled={selectedIds.length === 0} onClick={removeSelected}>
          <span className="ico">🗑</span> Delete
        </button>

        <span className="mute" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {selectedIds.length ? `${selectedIds.length} selected` : `${rows.length} templates`}
        </span>
      </div>

      <div className="panel">
        <div className="table-tools">
          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'density' ? null : 'density')}>
              ☰ Density
            </button>
            {menu === 'density' && (
              <div className="popover" style={{ minWidth: 150 }}>
                {DENSITIES.map((d) => (
                  <label key={d} onClick={() => savePrefs({ density: d })}>
                    <input type="radio" readOnly checked={prefs.density === d} style={{ width: 'auto' }} />
                    {d}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="tool-btn" onClick={() => savePrefs({ density: 'standard' })}>
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
                    checked={allOnPage}
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
                <th className="no-sort">Actions</th>
                <th className="no-sort">Title</th>
                <th className="no-sort">Type</th>
                <th className="no-sort">Landings</th>
                <th className="no-sort">Offers</th>
                <th className="no-sort">Filters</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="table-empty">
                    <span className="spinner" /> Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="table-empty">
                    No funnel templates yet — create one to reuse a funnel shape across campaigns
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((r) => {
                  const id = String(r._id);
                  const conds =
                    (r.filters?.country?.length ? 1 : 0) +
                    (r.filters?.device?.length ? 1 : 0) +
                    (r.filters?.os?.length ? 1 : 0) +
                    (r.filters?.browser?.length ? 1 : 0) +
                    (r.filters?.timeRange?.from !== null && r.filters?.timeRange?.from !== undefined ? 1 : 0);
                  return (
                    <tr
                      key={id}
                      className={selected.has(id) ? 'row-selected' : ''}
                      onDoubleClick={() => {
                        setFormError('');
                        setEditing(funnelToForm(r));
                      }}
                    >
                      <td className="check">
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setFormError('');
                            setEditing(funnelToForm(r));
                          }}
                        >
                          Edit
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="cell-link"
                          onClick={() => {
                            setFormError('');
                            setEditing(funnelToForm(r));
                          }}
                        >
                          {r.name}
                        </button>
                        {r.notes ? <span className="cell-sub">{r.notes}</span> : null}
                      </td>
                      <td>
                        <span className="badge neutral">{typeLabel(r.type)}</span>
                      </td>
                      <td>
                        {r.landers?.length
                          ? r.landers.map((l) => nameOf(refs.landers, l.landerId, 'name')).join(', ')
                          : '—'}
                      </td>
                      <td>
                        {r.offers?.length
                          ? r.offers.map((o) => nameOf(refs.offers, o.offerId, 'name')).join(', ')
                          : '—'}
                      </td>
                      <td>
                        {r.filtersEnabled ? (
                          <span className="badge approved">{conds} condition{conds === 1 ? '' : 's'}</span>
                        ) : (
                          <span className="mute">off</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
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

      {editing && (
        <FunnelModal
          value={editing}
          landers={refs.landers}
          offers={refs.offers}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          error={formError}
        />
      )}
    </Page>
  );
}
