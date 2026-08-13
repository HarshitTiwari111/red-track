import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import Field from './Field.jsx';
import CopyField from './CopyField.jsx';
import { api } from '../api/client.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'BRL', 'RUB'];

const ROLE_LABELS = {
  '': '— none —',
  source: 'Source',
  medium: 'Medium',
  campaign: 'Campaign',
  adgroup: 'Ad group',
  ad: 'Ad / creative',
  placement: 'Placement',
  keyword: 'Keyword',
  cost: 'Click cost',
  clickref: 'Click ref ID',
};
const ROLES = Object.keys(ROLE_LABELS);

export const blankSource = () => ({
  name: '',
  aliasChannel: '',
  currency: 'USD',
  s2sPostbackTemplate: '',
  externalId: '',
  clickIdParam: '',
  costParam: 'cost',
  params: Array.from({ length: 3 }, (_, i) => ({ param: `sub${i + 1}`, macro: '', name: '', role: '' })),
  status: 'active',
  notes: '',
});

/** Sources saved before `params` existed only have the derived `tokens` map. */
export const sourceToForm = (s) => {
  const fromTokens = Object.entries(s.tokens || {}).map(([param, macro]) => ({
    param,
    macro,
    name: '',
    role: '',
  }));
  return {
    ...blankSource(),
    ...s,
    currency: s.currency || 'USD',
    params: s.params?.length ? s.params : fromTokens,
  };
};

export default function SourceModal({ value, onChange, onClose, onSave, saving, error }) {
  const [macros, setMacros] = useState([]);
  const [showOptional, setShowOptional] = useState(false);
  const origin = window.location.origin;

  useEffect(() => {
    api
      .get('/macros')
      .then((r) => setMacros(r.data.macros || []))
      .catch(() => setMacros([]));
  }, []);

  const set = (patch) => onChange({ ...value, ...patch });
  const setParam = (i, patch) =>
    set({ params: value.params.map((p, x) => (x === i ? { ...p, ...patch } : p)) });

  const addParam = () => {
    const next = `sub${value.params.length + 1}`;
    set({ params: [...value.params, { param: next, macro: '', name: '', role: '' }] });
  };

  const previewQuery = value.params
    .filter((p) => p.param && p.macro)
    .map((p) => `${p.param}=${p.macro}`)
    .join('&');

  return (
    <Modal
      wide
      title={value._id ? 'Traffic Channel' : 'New Traffic Channel'}
      onClose={onClose}
      headerActions={
        <>
          <button type="button" className="btn primary" onClick={onSave} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
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

      <div className="rt-card">
        <div className="rt-card-body">
          <div className="field-row">
            <Field label="Channel name" required>
              <input
                type="text"
                value={value.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Google Ads"
              />
            </Field>
            <Field label="Alias channel" hint="Optional short name used in your own reporting.">
              <input
                type="text"
                value={value.aliasChannel}
                onChange={(e) => set({ aliasChannel: e.target.value })}
                placeholder="N/A"
              />
            </Field>
          </div>

          <Field
            label="Currency"
            hint="A label only — this tracker stores every amount as-is and does no currency conversion."
          >
            <select value={value.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="S2S postback template"
            hint="Fired on every conversion for campaigns that have no forwarding of their own. Supports all macros."
          >
            <input
              type="text"
              className="mono"
              value={value.s2sPostbackTemplate}
              onChange={(e) => set({ s2sPostbackTemplate: e.target.value })}
              placeholder="https://source.com/postback?clickid={sub1}&payout={payout}&status={status}"
            />
          </Field>

          <div className="field-row">
            <Field label="Click ref ID" hint="Query parameter carrying the source's own click id.">
              <input
                type="text"
                className="mono"
                value={value.clickIdParam}
                onChange={(e) => set({ clickIdParam: e.target.value })}
                placeholder="gclid"
              />
            </Field>
            <Field label="Click cost ID" hint="Query parameter carrying the click cost.">
              <input
                type="text"
                className="mono"
                value={value.costParam}
                onChange={(e) => set({ costParam: e.target.value })}
                placeholder="cost"
              />
            </Field>
            <Field label="External ID" hint="Your own reference for this channel.">
              <input
                type="text"
                value={value.externalId}
                onChange={(e) => set({ externalId: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">
          Additional parameters
          <span className="mute" style={{ fontSize: 12, fontWeight: 400 }}>
            {value.params.length} parameter{value.params.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="rt-card-body tight">
          <div className="rt-hint" style={{ marginBottom: 12 }}>
            A <strong>role</strong> routes the value into a known slot on the click, so it appears in reports and the
            Rt columns instead of only living in a subID.
          </div>

          <div className="param-head">
            <span>Parameter</span>
            <span>Macro / token</span>
            <span>Name / description</span>
            <span>Role</span>
            <span />
          </div>

          {value.params.map((p, i) => (
            <div className="param-row" key={i}>
              <Field>
                <input
                  type="text"
                  className="mono"
                  value={p.param}
                  onChange={(e) => setParam(i, { param: e.target.value })}
                  placeholder="sub1"
                />
              </Field>
              <Field>
                <input
                  type="text"
                  className="mono"
                  value={p.macro}
                  onChange={(e) => setParam(i, { macro: e.target.value })}
                  placeholder="{keyword}"
                />
              </Field>
              <Field>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                  placeholder="Keyword"
                />
              </Field>
              <Field>
                <select value={p.role} onChange={(e) => setParam(i, { role: e.target.value })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="icon-btn danger"
                onClick={() => set({ params: value.params.filter((_, x) => x !== i) })}
                title="Remove parameter"
              >
                ×
              </button>
            </div>
          ))}

          <button type="button" className="btn sm green" style={{ marginTop: 6 }} onClick={addParam}>
            + Add parameter
          </button>

          <div style={{ marginTop: 18 }}>
            <CopyField
              label="Generated tracking-link query"
              value={previewQuery || 'Add a macro to a parameter to build the query'}
            />
            <div className="rt-hint" style={{ marginTop: -8 }}>
              This is appended to a campaign&apos;s click URL, e.g.{' '}
              <span className="mono">{origin}/c/your-campaign?{previewQuery || 'sub1={keyword}'}</span>
            </div>
          </div>

          {macros.length > 0 && (
            <details style={{ margin: '14px 0 16px' }}>
              <summary className="dim" style={{ cursor: 'pointer', fontSize: 13 }}>
                Tracker macros available in the postback template
              </summary>
              <div className="macro-chips" style={{ marginTop: 10 }}>
                {macros.map((m) => (
                  <span className="macro-chip" key={m}>
                    {`{${m}}`}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      <button type="button" className="btn" onClick={() => setShowOptional((s) => !s)}>
        Optional settings {showOptional ? '⌃' : '⌄'}
      </button>

      {showOptional && (
        <div style={{ marginTop: 16 }}>
          <Field label="Status">
            <select value={value.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </Field>
          <Field label="Notes">
            <textarea value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
