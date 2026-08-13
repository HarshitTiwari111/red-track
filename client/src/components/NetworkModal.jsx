import { useState } from 'react';
import Modal from './Modal.jsx';
import Field, { Switch } from './Field.jsx';
import CopyField from './CopyField.jsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'BRL', 'RUB'];

const ROLE_LABELS = {
  '': '— none —',
  clickid: 'Click ID',
  payout: 'Payout',
  txid: 'Transaction ID',
  status: 'Status',
  type: 'Conversion type',
  event: 'Event name',
  coupon: 'Coupon',
  refid: 'Ref ID',
  pubrevenue: 'Publisher revenue',
};
const ROLES = Object.keys(ROLE_LABELS);

const DUPLICATE_MODES = [
  { id: 'update', label: 'Update the existing conversion' },
  { id: 'ignore', label: 'Ignore the repeat' },
  { id: 'create', label: 'Create a new conversion' },
];

export const blankNetwork = () => ({
  name: '',
  aliasName: '',
  currency: 'USD',
  offerUrlTemplate: '',
  params: [
    { param: 'clickid', macro: '', name: 'Click ID', role: 'clickid' },
    { param: 'payout', macro: '', name: 'Payout', role: 'payout' },
  ],
  paramMapping: { clickid: 'clickid', payout: 'payout', txid: 'txid', status: 'status', type: 'type' },
  defaultConversionStatus: 'approved',
  clickExpiration: { enabled: false, days: 0 },
  postbackProtection: { enabled: false },
  whitelistedIps: { enabled: false, ips: [] },
  duplicateMode: 'update',
  status: 'active',
  notes: '',
});

/** Networks saved before `params` existed only have the fixed paramMapping. */
export const networkToForm = (n) => {
  const fromMapping = Object.entries(n.paramMapping || {}).map(([role, param]) => ({
    param,
    macro: '',
    name: ROLE_LABELS[role] || role,
    role: ROLES.includes(role) ? role : '',
  }));
  return {
    ...blankNetwork(),
    ...n,
    currency: n.currency || 'USD',
    clickExpiration: { enabled: false, days: 0, ...(n.clickExpiration || {}) },
    postbackProtection: { enabled: false, ...(n.postbackProtection || {}) },
    whitelistedIps: { enabled: false, ips: [], ...(n.whitelistedIps || {}) },
    duplicateMode: n.duplicateMode || 'update',
    params: n.params?.length ? n.params : fromMapping,
  };
};

export default function NetworkModal({ value, onChange, onClose, onSave, saving, error }) {
  const [showAllParams, setShowAllParams] = useState(false);
  const origin = window.location.origin;

  const set = (patch) => onChange({ ...value, ...patch });
  const setParam = (i, patch) =>
    set({ params: value.params.map((p, x) => (x === i ? { ...p, ...patch } : p)) });

  const roleParam = (role) => value.params.find((p) => p.role === role)?.param;

  /* The URL the affiliate network is given, built from the configured roles. */
  const postbackUrl = () => {
    const parts = [];
    const push = (role, macro) => {
      const p = roleParam(role);
      if (p) parts.push(`${p}=${macro}`);
    };
    push('clickid', '{clickid}');
    push('payout', '{payout}');
    push('txid', '{txid}');
    push('status', '{status}');
    push('type', '{type}');
    if (!parts.length) parts.push('clickid={clickid}', 'payout={payout}');
    parts.push(`key=${value.postbackSecurityKey || '<security-key>'}`);
    return `${origin}/postback?${parts.join('&')}`;
  };

  const visibleParams = showAllParams ? value.params : value.params.slice(0, 6);

  return (
    <Modal
      wide
      title="Offer source"
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
            <Field label="Name" required>
              <input type="text" value={value.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Alias offer source" hint="Optional short name used in your own reporting.">
              <input
                type="text"
                value={value.aliasName}
                onChange={(e) => set({ aliasName: e.target.value })}
                placeholder="N/A"
              />
            </Field>
          </div>

          <CopyField label="Postback URL" value={postbackUrl()} />
          <div className="rt-hint" style={{ marginTop: -8, marginBottom: 16 }}>
            Build your postback URL here and paste it into your affiliate network&apos;s account.
          </div>

          <div className="field-row">
            <Field
              label="Currency"
              hint="A label only — this tracker stores every amount as-is and does no conversion."
            >
              <select value={value.currency} onChange={(e) => set({ currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={value.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </Field>
          </div>

          <Field label="Offer URL template" hint="Pre-fills the URL when you create an offer under this source.">
            <input
              type="text"
              className="mono"
              value={value.offerUrlTemplate}
              onChange={(e) => set({ offerUrlTemplate: e.target.value })}
              placeholder="https://network.com/click?aff_sub={clickid}&geo={country}"
            />
          </Field>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">
          Postback parameters
          <span className="mute" style={{ fontSize: 12, fontWeight: 400 }}>
            {value.params.length} parameter{value.params.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="rt-card-body tight">
          <div className="rt-hint" style={{ marginBottom: 12 }}>
            The <strong>parameter</strong> is what this tracker reads off the postback; the <strong>role</strong> says
            which conversion field it fills. Leave the macro blank unless your network documents one.
          </div>

          <div className="param-head">
            <span>Parameter</span>
            <span>Macro / token</span>
            <span>Name / description</span>
            <span>Role</span>
            <span />
          </div>

          {visibleParams.map((p, i) => (
            <div className="param-row" key={i}>
              <Field>
                <input
                  type="text"
                  className="mono"
                  value={p.param}
                  onChange={(e) => setParam(i, { param: e.target.value })}
                  placeholder="clickid"
                />
              </Field>
              <Field>
                <input
                  type="text"
                  className="mono"
                  value={p.macro}
                  onChange={(e) => setParam(i, { macro: e.target.value })}
                  placeholder="(from your network)"
                />
              </Field>
              <Field>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                  placeholder="Click ID"
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
              >
                ×
              </button>
            </div>
          ))}

          <div className="btn-group" style={{ marginTop: 6, marginBottom: 16 }}>
            <button
              type="button"
              className="btn sm green"
              onClick={() => set({ params: [...value.params, { param: '', macro: '', name: '', role: '' }] })}
            >
              + Add parameter
            </button>
            {value.params.length > 6 && (
              <button type="button" className="btn sm" onClick={() => setShowAllParams((s) => !s)}>
                {showAllParams ? 'Show less' : `Show more (${value.params.length - 6})`}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Conversion handling</div>
        <div className="rt-card-body">
          <div className="field-row">
            <Field
              label="Default conversion status"
              hint="Used when the postback carries no status. An offer's own default wins over this."
            >
              <select
                value={value.defaultConversionStatus}
                onChange={(e) => set({ defaultConversionStatus: e.target.value })}
              >
                <option value="approved">approved</option>
                <option value="pending">pending</option>
                <option value="rejected">rejected</option>
              </select>
            </Field>

            <Field
              label="Duplicate postback mode"
              hint="What happens when the same transaction id arrives again."
            >
              <select value={value.duplicateMode} onChange={(e) => set({ duplicateMode: e.target.value })}>
                {DUPLICATE_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Click expiration</div>
        <div className="rt-card-body">
          <Switch
            checked={value.clickExpiration.enabled}
            onChange={(v) => set({ clickExpiration: { ...value.clickExpiration, enabled: v } })}
            label="Reject conversions that arrive after the attribution window"
          />
          {value.clickExpiration.enabled && (
            <div style={{ marginTop: 14 }}>
              <Field label="Days" hint="A conversion whose click is older than this is refused and logged.">
                <input
                  type="number"
                  min="0"
                  value={value.clickExpiration.days}
                  onChange={(e) =>
                    set({ clickExpiration: { ...value.clickExpiration, days: Number(e.target.value) } })
                  }
                />
              </Field>
            </div>
          )}
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Postback protection</div>
        <div className="rt-card-body">
          <Switch
            checked={value.postbackProtection.enabled}
            onChange={(v) => set({ postbackProtection: { enabled: v } })}
            label="Require the security key on every postback for this source"
          />
          <div className="rt-hint" style={{ marginTop: 10 }}>
            Without this, a postback that carries no key is still accepted and attributed through the offer. Turn it on
            once the network is sending the key.
          </div>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Whitelisted IPs</div>
        <div className="rt-card-body">
          <Switch
            checked={value.whitelistedIps.enabled}
            onChange={(v) => set({ whitelistedIps: { ...value.whitelistedIps, enabled: v } })}
            label="Only accept conversions from these IPs"
          />
          {value.whitelistedIps.enabled && (
            <div style={{ marginTop: 14 }}>
              <Field label="IPs (one per line)" hint="Leave empty to allow any IP — the toggle alone blocks nothing.">
                <textarea
                  className="mono"
                  style={{ minHeight: 90 }}
                  value={(value.whitelistedIps.ips || []).join('\n')}
                  onChange={(e) =>
                    set({
                      whitelistedIps: {
                        ...value.whitelistedIps,
                        ips: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                      },
                    })
                  }
                  placeholder={'203.0.113.10\n198.51.100.7'}
                />
              </Field>
            </div>
          )}
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Notes</div>
        <div className="rt-card-body">
          <Field>
            <textarea value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
