import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import Field from './Field.jsx';
import CopyField from './CopyField.jsx';
import { api } from '../api/client.js';

export const LANDER_TYPES = [
  { id: 'landing', label: 'Landing' },
  { id: 'pre-landing', label: 'Pre-landing' },
  { id: 'listicle-landing', label: 'Listicle landing' },
  { id: 'listicle-pre-landing', label: 'Listicle pre-landing' },
];

export const blankLander = () => ({
  name: '',
  type: 'landing',
  url: '',
  domainId: '',
  tags: [],
  status: 'active',
  notes: '',
});

export const landerToForm = (l) => ({
  ...blankLander(),
  ...l,
  type: l.type || 'landing',
  domainId: l.domainId || '',
  tags: l.tags || [],
});

export default function LanderModal({
  value,
  knownTags = [],
  domains = [],
  onChange,
  onClose,
  onSave,
  saving,
  error,
}) {
  const [macros, setMacros] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [showOptional, setShowOptional] = useState(false);

  useEffect(() => {
    api
      .get('/macros')
      .then((r) => setMacros(r.data.macros || []))
      .catch(() => setMacros([]));
  }, []);

  const set = (patch) => onChange({ ...value, ...patch });

  /* Every snippet below is built on the chosen domain, then the default one,
     then this host - so what is copied is what the visitor will actually hit. */
  const defaultDomain = domains.find((d) => d.isDefault);
  const chosen = domains.find((d) => String(d._id) === String(value.domainId)) || defaultDomain;
  const origin = chosen ? `${chosen.protocol}://${chosen.host}` : window.location.origin;

  /** Append the macro as a query parameter named after it: ...?country={country} */
  const appendMacro = (macro) => {
    const url = value.url || '';
    const sep = url.includes('?') ? '&' : '?';
    set({ url: `${url}${sep}${macro}={${macro}}` });
  };

  const addTag = (t) => {
    const tag = String(t || '').trim().slice(0, 40);
    if (!tag || value.tags.includes(tag)) return;
    set({ tags: [...value.tags, tag] });
  };

  return (
    <Modal
      wide
      title="Landing"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={onSave} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}

      <Field label="Name" required>
        <input
          type="text"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Quiz page — IN"
        />
      </Field>

      <div className="section-title" style={{ marginBottom: 4 }}>
        Type
      </div>
      <div className="form-note" style={{ marginBottom: 10 }}>
        Choose the type of your landing page.
      </div>
      <div className="segmented">
        {LANDER_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={value.type === t.id ? 'active' : ''}
            onClick={() => set({ type: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Field label="URL" required>
        <input
          type="text"
          className="mono"
          value={value.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://mysite.com/quiz"
        />
      </Field>

      <div className="macro-chips">
        {macros.map((m) => (
          <button key={m} type="button" className="macro-chip" onClick={() => appendMacro(m)} title={`Append ?${m}={${m}}`}>
            + {`{${m}}`}
          </button>
        ))}
      </div>
      <div className="rt-hint" style={{ marginBottom: 18 }}>
        Click a macro to append it to the URL as a query parameter. Values are filled in and URL-encoded on every click.
      </div>

      <Field label="Tracking domain" required>
        <select value={value.domainId || ''} onChange={(e) => set({ domainId: e.target.value })}>
          <option value="">
            {defaultDomain ? `Default (${defaultDomain.host})` : origin.replace(/^https?:\/\//, '')}
          </option>
          {domains.map((d) => (
            <option key={d._id} value={d._id}>
              {d.host}
              {d.isDefault ? ' — default' : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="rt-hint">
        Use a custom tracking domain where you can. The click URL and the script below should sit on
        the same domain as the campaign link that brought the visitor here — set them up under
        Traffic domain.
      </div>

      <CopyField label="Click URL" value={`${origin}/go`} />
      <div className="rt-hint">
        Replace the offer link (hop link) on your landing page with this URL — it records the LP click
        and sends the visitor to the offer chosen for them. You can add parameters, e.g.{' '}
        <span className="mono">/go?sub15=variation1</span>, to tell variations apart. Add{' '}
        <span className="mono">?off=&lt;offerId&gt;</span> to force one specific offer.
      </div>

      <div className="section-title">Tags</div>
      <div className="form-note" style={{ marginBottom: 8 }}>
        Tags selected:
      </div>
      {value.tags.length === 0 ? (
        <div className="mute" style={{ fontSize: 13 }}>No tags yet.</div>
      ) : (
        <div className="chips">
          {value.tags.map((t) => (
            <span className="chip" key={t}>
              {t}
              <button type="button" onClick={() => set({ tags: value.tags.filter((x) => x !== t) })}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag(tagDraft);
              setTagDraft('');
            }
          }}
          placeholder="New tag"
          style={{ maxWidth: 220 }}
        />
        <button type="button" className="btn sm" onClick={() => { addTag(tagDraft); setTagDraft(''); }}>
          Add
        </button>
      </div>

      {knownTags.filter((t) => !value.tags.includes(t)).length > 0 && (
        <>
          <div className="form-note" style={{ marginBottom: 6 }}>Already used tags:</div>
          <div className="chips" style={{ marginBottom: 16 }}>
            {knownTags
              .filter((t) => !value.tags.includes(t))
              .map((t) => (
                <button type="button" className="chip pick" key={t} onClick={() => addTag(t)}>
                  + {t}
                </button>
              ))}
          </div>
        </>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border-soft)', margin: '18px 0' }} />

      <button type="button" className="btn" onClick={() => setShowOptional((s) => !s)}>
        Optional settings {showOptional ? '⌃' : '⌄'}
      </button>

      {showOptional && (
        <div style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            For traffic through redirects
          </div>
          <div className="alert warn">
            <strong>Warning</strong>
            <br />
            Use this only on landing pages that receive traffic through a redirect. Do not put it on
            the same page as the no-redirect script — both would record the same visit.
          </div>
          <CopyField
            label="LP Views"
            value={`<script type="text/javascript" src="${origin}/track.js"></script>`}
          />
          <div className="rt-hint">
            Paste it into the page&apos;s HTML. It records the landing page view, which is what turns
            LP views and LP CTR from zero into real numbers.
          </div>
        </div>
      )}
    </Modal>
  );
}
