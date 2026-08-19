import { useEffect, useState } from 'react';
import { LuCircleHelp, LuPlus, LuTrash2 } from 'react-icons/lu';
import { SiMeta } from 'react-icons/si';
import Field from './Field.jsx';
import { api } from '../api/client.js';

/**
 * Chooses which Meta pixels a channel or an offer sends conversions to.
 *
 * The pixels themselves live under CAPI Integrations, so nothing here holds an
 * id or a key - only a reference. That is what lets a key be rotated in one
 * place instead of in every record that happens to use it.
 */
export default function CapiPixelPicker({ value = [], onChange, scope }) {
  const [catalog, setCatalog] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get('/meta-pixels')
      .then((r) => setCatalog(r.data.items || []))
      .catch(() => setCatalog([]))
      .finally(() => setLoaded(true));
  }, []);

  const setAt = (i, id) => onChange(value.map((v, x) => (x === i ? id : v)));
  const removeAt = (i) => onChange(value.filter((_, x) => x !== i));

  return (
    <div className="rt-card">
      <div className="rt-card-head">
        <span className="head-title">
          <SiMeta className="brand-mark-meta" />
          CAPI Meta settings
          <LuCircleHelp
            className="head-help"
            title="Conversions on this record are also sent to the chosen pixels through Meta's Conversions API."
          />
        </span>
      </div>
      <div className="rt-card-body">
        <div className="rt-hint" style={{ marginTop: 0 }}>
          Pixels are defined once under CAPI Integrations and chosen here. Set a pixel on the traffic
          channel or on the offer — not both for the same conversion, or it is sent twice.
        </div>

        {loaded && catalog.length === 0 && (
          <div className="dim" style={{ fontSize: 13, padding: '8px 0' }}>
            No pixels defined yet — add one under CAPI Integrations first.
          </div>
        )}

        {value.map((id, i) => (
          <div className="capi-row" key={i}>
            <Field label="Select platform">
              <select value="meta" disabled>
                <option value="meta">Meta</option>
              </select>
            </Field>
            <Field label="Select Pixel">
              <select value={id || ''} onChange={(e) => setAt(i, e.target.value)}>
                <option value="">None</option>
                {catalog.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.title} — {p.pixelId}
                  </option>
                ))}
              </select>
            </Field>
            <span />
            <button
              type="button"
              className="head-icon-btn danger"
              onClick={() => removeAt(i)}
              title="Remove this pixel"
            >
              <LuTrash2 />
            </button>
          </div>
        ))}

        <button
          type="button"
          className="add-row-btn"
          onClick={() => onChange([...value, ''])}
          disabled={catalog.length === 0}
        >
          <LuPlus />
          Add Pixel
        </button>

        {scope && (
          <div className="rt-hint">
            {scope === 'source'
              ? 'On a traffic channel, only conversions attributed to this channel are sent.'
              : 'On an offer, every conversion for this offer is sent, whichever channel it came from.'}
          </div>
        )}
      </div>
    </div>
  );
}
