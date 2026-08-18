import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuPencil, LuTrash2 } from 'react-icons/lu';
import { Page } from '../components/Layout.jsx';
import Field from '../components/Field.jsx';
import MetaPixelModal, { blankMetaPixel, metaPixelToForm } from '../components/MetaPixelModal.jsx';
import { api, errMsg } from '../api/client.js';

const dt = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export default function CapiIntegrations() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState({ title: '', pixelId: '' });
  const [filters, setFilters] = useState(draft);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/meta-pixels');
      setRows(data.items || []);
    } catch (err) {
      setError(errMsg(err, 'Could not load pixels'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Both filters are plain substring matches, so there is nothing to ask the
  // server for - the whole list is already here.
  const visible = rows.filter(
    (r) =>
      (!filters.title || r.title.toLowerCase().includes(filters.title.toLowerCase())) &&
      (!filters.pixelId || String(r.pixelId).includes(filters.pixelId))
  );

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (editing._id) await api.put(`/meta-pixels/${editing._id}`, editing);
      else await api.post('/meta-pixels', editing);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save the pixel'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    try {
      await api.delete(`/meta-pixels/${row._id}`);
      setNotice(`Removed ${row.title}.`);
      setTimeout(() => setNotice(''), 3000);
      load();
    } catch (err) {
      setError(errMsg(err, 'Could not remove the pixel'));
    }
  };

  return (
    <Page
      title="Meta Pixels"
      actions={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormError('');
            setEditing(blankMetaPixel());
          }}
        >
          + Add new pixel
        </button>
      }
    >
      <div className="breadcrumb">
        CAPI Integrations <span>›</span> Meta Pixels
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="filter-bar">
        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title"
          />
        </Field>
        <Field label="Pixel ID">
          <input
            type="text"
            className="mono"
            value={draft.pixelId}
            onChange={(e) => setDraft({ ...draft, pixelId: e.target.value })}
            placeholder="Pixel ID"
          />
        </Field>
        <div className="filter-actions">
          <button type="button" className="btn primary" onClick={() => setFilters(draft)} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Apply'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft({ title: '', pixelId: '' });
              setFilters({ title: '', pixelId: '' });
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data density-standard">
          <thead>
            <tr>
              <th>Title</th>
              <th>Date connected</th>
              <th>Pixel ID</th>
              {/* The header carries `num` too, or it stays left while the
                  figure under it is pushed to the right of a wide column. */}
              <th className="num">Events sent</th>
              <th>Details</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="table-empty">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  No pixels yet — add one to start sending conversions to Meta.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((r) => (
                <tr key={r._id}>
                  <td>
                    <button
                      type="button"
                      className="cell-link"
                      onClick={() => {
                        setFormError('');
                        setEditing(metaPixelToForm(r));
                      }}
                    >
                      {r.title}
                    </button>
                  </td>
                  <td className="nowrap">{dt(r.createdAt)}</td>
                  <td className="mono">{r.pixelId}</td>
                  <td className="num">{r.eventsSent || 0}</td>
                  <td>
                    <button type="button" className="cell-link" onClick={() => navigate(`/capi/${r._id}`)}>
                      View details
                    </button>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit pixel"
                        onClick={() => {
                          setFormError('');
                          setEditing(metaPixelToForm(r));
                        }}
                      >
                        <LuPencil />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Remove pixel"
                        onClick={() => remove(r)}
                      >
                        <LuTrash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="form-note" style={{ marginTop: 12 }}>
        A pixel defined here is chosen on a traffic channel or on an offer — one place or the other,
        never both, or the conversion is sent twice.
      </div>

      {editing && (
        <MetaPixelModal
          value={editing}
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
