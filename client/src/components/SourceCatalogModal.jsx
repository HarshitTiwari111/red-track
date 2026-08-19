import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api, errMsg } from '../api/client.js';

/** Two-letter mark stands in for the platform logo — no third-party assets. */
const mark = (name) =>
  name
    .replace(/[^a-zA-Z ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export default function SourceCatalogModal({ onClose, onAdded }) {
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/sources/catalog')
      .then((r) => setItems(r.data.items || []))
      .catch((err) => setError(errMsg(err, 'Could not load the catalog')));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (tab === 'recommended' ? i.recommended : true))
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }, [items, tab, search]);

  const add = async (entry) => {
    setBusy(entry.id);
    setError('');
    try {
      const { data } = await api.post('/sources/from-template', { templateId: entry.id });
      onAdded(data);
    } catch (err) {
      setError(errMsg(err, 'Could not open the template'));
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal
      wide
      title="Traffic Channels Catalog"
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {error && <div className="alert error">{error}</div>}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search in all"
        autoFocus
      />

      <div className="catalog-tabs">
        <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          All
        </button>
        <button type="button" className={tab === 'recommended' ? 'active' : ''} onClick={() => setTab('recommended')}>
          Recommended
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="loading-block">No channel matches that search</div>
      ) : (
        <div className="catalog-grid">
          {shown.map((entry) => (
            <div className="catalog-card" key={entry.id}>
              <div className="catalog-logo">{mark(entry.name)}</div>
              <h4>{entry.name}</h4>
              <p>{entry.description}</p>

              <div className="prefills">
                <span className="chip">{entry.paramCount} parameters</span>
                {entry.clickIdParam && <span className="chip">{entry.clickIdParam}</span>}
                {entry.costParam && <span className="chip">cost: {entry.costParam}</span>}
              </div>

              <button type="button" className="btn primary" onClick={() => add(entry)} disabled={busy === entry.id}>
                {busy === entry.id ? <span className="spinner" /> : '+ Add'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rt-hint" style={{ marginTop: 16 }}>
        Templates only pre-fill parameters and macros. This tracker has no ad-platform API integrations, so nothing
        here pulls cost or pauses campaigns automatically — cost arrives through the cost parameter on the click or a
        manual cost push.
      </div>
    </Modal>
  );
}
