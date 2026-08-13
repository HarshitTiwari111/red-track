import { useCallback, useEffect, useState } from 'react';
import { Page } from './Layout.jsx';
import DataTable from './DataTable.jsx';
import Modal from './Modal.jsx';
import { errMsg } from '../api/client.js';

/**
 * Shared CRUD page shell used by Offers / Landers / Sources / Networks.
 * `renderForm(draft, setDraft)` supplies the entity-specific fields.
 */
export default function EntityPage({
  title,
  api,
  columns,
  renderForm,
  blank,
  toForm = (row) => ({ ...row }),
  toPayload = (draft) => draft,
  addLabel = '+ New',
  wideModal = false,
  intro = null,
  extraActions = null,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.list());
    } catch (err) {
      setError(errMsg(err, `Could not load ${title.toLowerCase()}`));
    } finally {
      setLoading(false);
    }
  }, [api, title]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      const payload = toPayload(draft);
      if (draft._id) await api.update(draft._id, payload);
      else await api.create(payload);
      setDraft(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    try {
      await api.remove(row._id);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const filtered = search
    ? items.filter((i) => JSON.stringify(i).toLowerCase().includes(search.toLowerCase()))
    : items;

  const allColumns = [
    ...columns,
    {
      key: '_actions',
      label: '',
      noSort: true,
      render: (row) => (
        <div className="btn-group">
          <button type="button" className="btn sm" onClick={() => { setFormError(''); setDraft(toForm(row)); }}>
            Edit
          </button>
          <button type="button" className="btn sm danger" onClick={() => remove(row)}>
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <Page
      title={title}
      actions={
        <>
          {extraActions}
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 180 }}
          />
          <button type="button" className="btn primary sm" onClick={() => { setFormError(''); setDraft(blank()); }}>
            {addLabel}
          </button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}
      {intro}

      <div className="panel">
        <DataTable columns={allColumns} rows={filtered} loading={loading} defaultSort={{ key: 'name', dir: 'asc' }} />
      </div>

      {draft && (
        <Modal
          wide={wideModal}
          title={draft._id ? `Edit — ${draft.name || ''}` : addLabel.replace('+ ', '')}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" /> : 'Save'}
              </button>
            </>
          }
        >
          {formError && <div className="alert error">{formError}</div>}
          {renderForm(draft, (patch) => setDraft((d) => ({ ...d, ...patch })), load)}
        </Modal>
      )}
    </Page>
  );
}

export const StatusBadge = ({ status }) => <span className={`badge ${status}`}>{status}</span>;

export const StatusSelect = ({ value, onChange }) => (
  <label className="field">
    <span>Status</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="active">Active</option>
      <option value="paused">Paused</option>
    </select>
  </label>
);
