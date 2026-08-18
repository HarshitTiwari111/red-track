import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LuTrash2 } from 'react-icons/lu';
import { SiMeta } from 'react-icons/si';
import { Page } from '../components/Layout.jsx';
import useConfirm from '../components/ConfirmModal.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import { api, errMsg } from '../api/client.js';

const TABS = [
  { id: 'source', label: 'Traffic channels', noun: 'Traffic channel' },
  { id: 'offer', label: 'Offers', noun: 'Offer' },
];

const dt = (v) => (v ? new Date(v).toLocaleString() : '—');

export default function PixelDetails() {
  const [confirm, confirmUI] = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();

  const [tab, setTab] = useState('source');
  const [pixel, setPixel] = useState(null);
  const [links, setLinks] = useState({ sources: [], offers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [draft, setDraft] = useState({ title: '', id: '' });
  const [filters, setFilters] = useState(draft);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [p, l] = await Promise.all([api.get(`/meta-pixels/${id}`), api.get(`/meta-pixels/${id}/links`)]);
      setPixel(p.data);
      setLinks(l.data);
    } catch (err) {
      setError(errMsg(err, 'Could not load this pixel'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const active = TABS.find((t) => t.id === tab);
  const rows = tab === 'source' ? links.sources : links.offers;

  // Both filters are plain substring matches over a list already in hand
  const visible = rows.filter(
    (r) =>
      (!filters.title || r.name.toLowerCase().includes(filters.title.toLowerCase())) &&
      (!filters.id || String(r._id).includes(filters.id))
  );

  const detach = async (row) => {
    const ok = await confirm({
      title: 'Confirm detach',
      message: `Are you sure you want to detach ${row.name} from this pixel?`,
      note: 'Conversions from it will no longer reach Meta. Nothing is deleted — you can attach it again at any time.',
      confirmLabel: 'Detach',
    });
    if (!ok) return;
    try {
      await api.delete(`/meta-pixels/${id}/links/${tab}/${row._id}`);
      setNotice(`${row.name} no longer sends to this pixel.`);
      setTimeout(() => setNotice(''), 3000);
      load();
    } catch (err) {
      setError(errMsg(err, 'Could not detach'));
    }
  };

  return (
    <Page
      title={`Pixel details${pixel ? ` ${pixel.title}` : ''}`}
      actions={
        <button type="button" className="btn primary" onClick={() => setAdding(true)} disabled={!pixel}>
          + Add new
        </button>
      }
    >
      <div className="breadcrumb">
        <button type="button" className="cell-link" onClick={() => navigate('/capi')}>
          CAPI Integrations
        </button>
        <span>›</span>
        <button type="button" className="cell-link" onClick={() => navigate('/capi')}>
          Meta Pixels
        </button>
        <span>›</span>
        Details Pixels
      </div>

      <div className="modal-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      {pixel && (
        <div className="head-title" style={{ fontSize: 18, fontWeight: 650, margin: '14px 0 6px' }}>
          <SiMeta className="brand-mark-meta" style={{ fontSize: 24 }} />
          Pixel {pixel.pixelId}
          <span className="dim" style={{ fontSize: 13, fontWeight: 400, marginLeft: 10 }}>
            {pixel.eventsSent || 0} event{pixel.eventsSent === 1 ? '' : 's'} sent · last {dt(pixel.lastEventAt)}
          </span>
        </div>
      )}

      <div className="filter-bar">
        <Field label={`Title ${active.noun}`}>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder={`Title ${active.noun}`}
          />
        </Field>
        <Field label={`ID ${active.noun}`}>
          <input
            type="text"
            className="mono"
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            placeholder={`ID ${active.noun}`}
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
              setDraft({ title: '', id: '' });
              setFilters({ title: '', id: '' });
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
              <th>{active.noun}</th>
              <th>Date connected</th>
              <th>ID {active.noun}</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="table-empty">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={4} className="table-empty">
                  Nothing attached yet — use Add new to send this pixel a{' '}
                  {active.noun.toLowerCase()}&apos;s conversions.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((r) => (
                <tr key={r._id}>
                  <td>{r.name}</td>
                  <td className="nowrap">{dt(r.createdAt)}</td>
                  <td className="mono">{r._id}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Detach from this pixel"
                        onClick={() => detach(r)}
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
        Attach a pixel to a traffic channel or to an offer, not to both for the same conversion — a
        channel sends only what it was attributed, an offer sends everything sold through it.
      </div>

      {adding && (
        <AttachModal
          pixelId={id}
          kind={tab}
          noun={active.noun}
          attached={rows.map((r) => String(r._id))}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {confirmUI}
    </Page>
  );
}

/** Picks one channel or offer that is not already attached. */
function AttachModal({ pixelId, kind, noun, attached, onClose, onDone }) {
  const [options, setOptions] = useState([]);
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(kind === 'source' ? '/sources' : '/offers')
      .then((r) => setOptions((r.data.items || []).filter((o) => !attached.includes(String(o._id)))))
      .catch(() => setOptions([]));
  }, [kind, attached]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/meta-pixels/${pixelId}/links`, { kind, targetId: choice });
      onDone();
    } catch (err) {
      setError(errMsg(err, 'Could not attach'));
      setSaving(false);
    }
  };

  return (
    <Modal
      small
      title={`Add ${noun.toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={!choice || saving}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}
      <Field label={noun} required>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o._id} value={o._id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      {options.length === 0 && (
        <div className="dim" style={{ fontSize: 13 }}>
          Every {noun.toLowerCase()} is already attached to this pixel.
        </div>
      )}
    </Modal>
  );
}
