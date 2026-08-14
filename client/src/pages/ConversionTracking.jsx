import { useCallback, useEffect, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import Modal from '../components/Modal.jsx';
import Field, { Switch } from '../components/Field.jsx';
import { api, errMsg } from '../api/client.js';

const TYPE_ROWS = 20;

/** What a builder-generated snippet is meant to be pasted into. */
const INTEGRATIONS = [
  { id: 's2s', label: 'Server-to-server postback' },
  { id: 'pixel', label: 'Conversion pixel (img)' },
  { id: 'script', label: 'Thank-you page script' },
];

const blankType = () => ({ name: '', mode: 'create', role: '' });

export default function ConversionTracking() {
  const [tab, setTab] = useState('type');

  return (
    <Page title="Conversion tracking">
      <div className="tabs report-tabs">
        <button type="button" className={tab === 'type' ? 'active' : ''} onClick={() => setTab('type')}>
          Conversion type
        </button>
        <button type="button" className={tab === 'tracking' ? 'active' : ''} onClick={() => setTab('tracking')}>
          Conversion tracking
        </button>
      </div>

      {tab === 'type' ? <ConversionTypeTab /> : <ConversionTrackingTab />}
    </Page>
  );
}

/* --------------------------------------------------------- conversion type */

function ConversionTypeTab() {
  const [def, setDef] = useState(() => ({ name: 'conversion', mode: 'create', role: '' }));
  const [rows, setRows] = useState(() => Array.from({ length: TYPE_ROWS }, blankType));
  const [meta, setMeta] = useState({ modes: [], roles: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [builder, setBuilder] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: s }, { data: ct }] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/conversion-tracking'),
      ]);
      setMeta({ modes: ct.modes || [], roles: ct.roles || [] });
      setDef({ ...blankType(), name: 'conversion', ...(s.conversionDefault || {}) });
      // Saved rows are compacted; pad back out so the form always shows 20 slots
      const saved = s.conversionTypes || [];
      setRows(Array.from({ length: TYPE_ROWS }, (_, i) => ({ ...blankType(), ...(saved[i] || {}) })));
    } catch (err) {
      setError(errMsg(err, 'Could not load conversion types'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put('/settings', { conversionDefault: def, conversionTypes: rows });
      const saved = data.conversionTypes || [];
      setRows(Array.from({ length: TYPE_ROWS }, (_, i) => ({ ...blankType(), ...(saved[i] || {}) })));
      setNotice(`Saved. ${saved.length} custom event${saved.length === 1 ? '' : 's'} configured.`);
      setTimeout(() => setNotice(''), 5000);
    } catch (err) {
      setError(errMsg(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const setRow = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="ct-builder-bar">
        <button type="button" className="btn primary" onClick={() => setBuilder({})}>
          Conversion tracking builder
        </button>
      </div>

      <div className="alert info">
        Add your custom conversion event names and click Save. Any conversion with an unrecognised type is recorded
        under the default event instead of being dropped.
      </div>

      <div className="panel">
        <div className="panel-body">
          {loading ? (
            <div className="table-empty">
              <span className="spinner" /> Loading…
            </div>
          ) : (
            <>
              <div className="ct-grid">
                <Field label="Default" required>
                  <input type="text" value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} />
                </Field>
                <Field label="Mode default">
                  <select value={def.mode} onChange={(e) => setDef({ ...def, mode: e.target.value })}>
                    {meta.modes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Role Default">
                  <select value={def.role} onChange={(e) => setDef({ ...def, role: e.target.value })}>
                    {meta.roles.map((r) => (
                      <option key={r || 'none'} value={r}>
                        {r || '—'}
                      </option>
                    ))}
                  </select>
                </Field>

                {rows.map((row, i) => (
                  <ConversionTypeRow
                    key={i}
                    index={i + 1}
                    row={row}
                    meta={meta}
                    onChange={(patch) => setRow(i, patch)}
                  />
                ))}
              </div>

              <button type="button" className="btn primary" onClick={save} disabled={saving} style={{ marginTop: 18 }}>
                {saving ? <span className="spinner" /> : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {builder && <BuilderModal onClose={() => setBuilder(null)} />}
    </>
  );
}

function ConversionTypeRow({ index, row, meta, onChange }) {
  return (
    <>
      <Field label={`Type ${index}`}>
        <input type="text" value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label={`Mode ${index}`}>
        <select value={row.mode} onChange={(e) => onChange({ mode: e.target.value })}>
          {meta.modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`Role ${index}`}>
        <select value={row.role} onChange={(e) => onChange({ role: e.target.value })}>
          {meta.roles.map((r) => (
            <option key={r || 'none'} value={r}>
              {r || '—'}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/* --------------------------------------------------------------- builder */

function BuilderModal({ onClose }) {
  const [integration, setIntegration] = useState('s2s');
  const [type, setType] = useState('');
  const [domainId, setDomainId] = useState('');
  const [data, setData] = useState(null);
  const [types, setTypes] = useState([]);

  useEffect(() => {
    Promise.all([api.get('/settings/conversion-tracking'), api.get('/settings')])
      .then(([{ data: ct }, { data: s }]) => {
        setData(ct);
        setDomainId(ct.selectedDomainId || '');
        const names = [s.conversionDefault?.name, ...(s.conversionTypes || []).map((t) => t.name)].filter(Boolean);
        setTypes(names);
        setType(names[0] || 'conversion');
      })
      .catch(() => {});
  }, []);

  const origin = (() => {
    if (!data) return '';
    const d = data.domains.find((x) => String(x._id) === String(domainId));
    return d ? d.url : data.origin;
  })();

  const snippet = (() => {
    if (!origin) return '';
    const q = `clickid={replace_me}&sum={replace_or_remove}${type ? `&type=${encodeURIComponent(type)}` : ''}`;
    if (integration === 's2s') return `${origin}/postback?${q}`;
    if (integration === 'pixel')
      return `<img src="${origin.replace(/^https?:/, '')}/postback?format=img&${q}" width="1" height="1" />`;
    return `<script type="text/javascript" src="${origin.replace(/^https?:/, '')}/postback.js"></script>`;
  })();

  return (
    <Modal
      compact
      title="Conversion tracking builder"
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <Field label="Integration type" hint="Where this snippet will be pasted.">
        <select value={integration} onChange={(e) => setIntegration(e.target.value)}>
          {INTEGRATIONS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Conversion type" hint="Recorded as this event name. Configured on the Conversion type tab.">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Tracking domain" hint="The host the network will call. Verified domains only.">
        <select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
          <option value="">{data ? `${data.defaultOrigin} (default)` : 'Loading…'}</option>
          {(data?.domains || []).map((d) => (
            <option key={d._id} value={d._id}>
              {d.host}
              {d.status !== 'active' ? ` (${d.status})` : ''}
            </option>
          ))}
        </select>
      </Field>

      <CopyRow label="Generated snippet" value={snippet} />
    </Modal>
  );
}

/* ----------------------------------------------------- conversion tracking */

function ConversionTrackingTab() {
  const [data, setData] = useState(null);
  const [domainId, setDomainId] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [showS2sStatuses, setShowS2sStatuses] = useState(false);
  const [showPixelStatuses, setShowPixelStatuses] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (id) => {
    try {
      const { data: d } = await api.get('/settings/conversion-tracking');
      setData(d);
      if (id === undefined) setDomainId(d.selectedDomainId || '');
    } catch (err) {
      setError(errMsg(err, 'Could not load conversion tracking'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chooseDomain = async (id) => {
    setDomainId(id);
    setError('');
    try {
      await api.put('/settings', { postbackDomainId: id || null });
      await load(id);
      setNotice('Default postback domain updated.');
      setTimeout(() => setNotice(''), 4000);
    } catch (err) {
      setError(errMsg(err, 'Could not save the domain'));
    }
  };

  if (!data) {
    return (
      <div className="panel">
        <div className="panel-body table-empty">
          <span className="spinner" /> Loading…
        </div>
      </div>
    );
  }

  const chosen = data.domains.find((d) => String(d._id) === String(domainId));
  const originHost = (chosen ? chosen.url : data.defaultOrigin).replace(/^https?:\/\//, '');

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="panel">
        <div className="panel-body">
          <h3 style={{ marginBottom: 10 }}>Conversion postback domain</h3>
          <p className="rt-hint" style={{ marginTop: 0 }}>
            <strong className="mono">{originHost}</strong> is your default postback domain. If you add more tracking
            domains you can use the menu below to change them in the postback URLs.
          </p>

          <Field label="Domain">
            <select value={domainId} onChange={(e) => chooseDomain(e.target.value)}>
              <option value="">{data.defaultOrigin} (install default)</option>
              {data.domains.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.host}
                  {d.status !== 'active' ? ` (${d.status})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <div className="ssl-note">
            <span className="ssl-note-icon" aria-hidden="true">
              i
            </span>
            <div>
              Choosing a domain here sets the default used in the templates below. Using a different tracking domain
              directly in your flow is fine — it will not affect tracking.
              {chosen && chosen.status !== 'active' && (
                <>
                  <br />
                  <strong>{chosen.host} is {chosen.status}</strong> — verify its DNS before handing these URLs to a
                  network.
                </>
              )}
            </div>
          </div>

          <button type="button" className={`btn ${legacy ? '' : 'primary'}`} onClick={() => setLegacy((v) => !v)}>
            {legacy ? 'Hide legacy' : 'Legacy'}
          </button>
        </div>
      </div>

      {legacy && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-body">
            <h3>S2S conversion tracking</h3>
            <p className="rt-hint" style={{ marginTop: 4 }}>
              Copy a postback URL and adjust the macros to your network&apos;s specification.
            </p>
            <CopyRow label="S2S postback URL for conversion" value={data.s2s.conversion} />

            <div className="ct-toggle">
              <Switch
                checked={showS2sStatuses}
                onChange={setShowS2sStatuses}
                label="Show postbacks for statuses (Pending, Approved, Declined, Other)"
              />
            </div>
            {showS2sStatuses && (
              <>
                <CopyRow label="S2S postback URL for Pending" value={data.s2s.pending} />
                <CopyRow label="S2S postback URL for Approved" value={data.s2s.approved} />
                <CopyRow label="S2S postback URL for Declined" value={data.s2s.declined} />
                <CopyRow label="S2S postback URL for Other" value={data.s2s.other} />
              </>
            )}

            <h3 style={{ marginTop: 22 }}>Conversion tracking pixel</h3>
            <p className="rt-hint" style={{ marginTop: 4 }}>
              Use when S2S is not available. Some browsers block third-party cookies, so use it with discretion.
            </p>
            <CopyRow label="Pixel postback code for conversion" value={data.pixel.conversion} />

            <div className="ct-toggle">
              <Switch
                checked={showPixelStatuses}
                onChange={setShowPixelStatuses}
                label="Show pixel for statuses (Pending, Approved, Declined, Other)"
              />
            </div>
            {showPixelStatuses && (
              <>
                <CopyRow label="Pixel for Pending" value={data.pixel.pending} />
                <CopyRow label="Pixel for Approved" value={data.pixel.approved} />
                <CopyRow label="Pixel for Declined" value={data.pixel.declined} />
                <CopyRow label="Pixel for Other" value={data.pixel.other} />
              </>
            )}

            <h3 style={{ marginTop: 22 }}>Postback script</h3>
            <p className="rt-hint" style={{ marginTop: 4 }}>
              For a thank-you page, instead of the pixel. The page must carry the click id in its URL, e.g.{' '}
              <span className="mono">https://my.site.com/thankyou?clickid=1234567</span>
            </p>
            <CopyRow label="Postback script" value={data.script} />
          </div>
        </div>
      )}
    </>
  );
}

/** Read-only value with a copy button, matching the reference layout. */
function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value || '');
      else {
        const ta = document.createElement('textarea');
        ta.value = value || '';
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rt-field ct-copy">
      <span className="rt-label">{label}</span>
      <input type="text" className="mono" readOnly value={value || ''} onFocus={(e) => e.target.select()} />
      <button type="button" className="icon-btn" onClick={copy} title="Copy" aria-label={`Copy ${label}`}>
        {copied ? '✓' : '⧉'}
      </button>
    </div>
  );
}
