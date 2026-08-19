import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api, errMsg } from '../api/client.js';

const mark = (name) =>
  name
    .replace(/[^a-zA-Z ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export default function NetworkCatalogModal({ onClose, onAdded }) {
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/networks/catalog')
      .then((r) => setItems(r.data.items || []))
      .catch((err) => setError(errMsg(err, 'Could not load the catalog')));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (tab === 'recommended' ? i.recommended : true))
      .filter(
        (i) =>
          !q ||
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.verticals.join(' ').toLowerCase().includes(q)
      );
  }, [items, tab, search]);

  const add = async (entry) => {
    setBusy(entry.id);
    setError('');
    try {
      const { data } = await api.post('/networks/from-template', { templateId: entry.id });
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
      title="Offer Sources Catalog"
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
        <div className="loading-block">No template matches that search</div>
      ) : (
        <div className="catalog-grid">
          {shown.map((entry) => (
            <div className="catalog-card" key={entry.id}>
              <div className="catalog-logo">{mark(entry.name)}</div>
              <h4>{entry.name}</h4>

              <div className="prefills">
                {entry.verticals.map((v) => (
                  <span className="chip" key={v}>
                    {v}
                  </span>
                ))}
              </div>

              <p>{entry.description}</p>

              <div className="prefills">
                <span className="chip">{entry.paramCount} parameters</span>
                {entry.protected && <span className="chip">key required</span>}
              </div>

              <button type="button" className="btn primary" onClick={() => add(entry)} disabled={busy === entry.id}>
                {busy === entry.id ? <span className="spinner" /> : '+ Add'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rt-hint" style={{ marginTop: 16 }}>
        Templates set up the postback structure and handling rules. The <strong>macro</strong> column stays blank on
        purpose — only your network&apos;s own documentation says which token it substitutes, and a guessed macro would
        deliver empty values on every conversion.
      </div>
    </Modal>
  );
}
