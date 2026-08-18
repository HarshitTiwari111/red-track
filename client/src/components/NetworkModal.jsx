import { useState } from 'react';
import Modal from './Modal.jsx';
import { LuCircleHelp } from 'react-icons/lu';
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
  { id: 'create', label: 'Create new conversion' },
  { id: 'update', label: 'Update existing conversion' },
  { id: 'ignore', label: 'Ignore duplicate' },
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

  const roleParam = (role) => value.params.find((p) => p.role === role)?.param || '';

  /**
   * The click id and the amount get their own two fields, so editing one means
   * renaming whichever parameter already carries that role - or adding it, for
   * a source that never had one.
   */
  const setRoleParam = (role, param, name) => {
    const at = value.params.findIndex((p) => p.role === role);
    if (at === -1) {
      set({ params: [...value.params, { param, macro: '', name, role }] });
      return;
    }
    set({ params: value.params.map((p, x) => (x === at ? { ...p, param } : p)) });
  };

  /*
   * Everything that is not the click id or the amount. They keep their index in
   * the real list, so editing a row does not depend on how the list is sliced
   * for display.
   */
  const extras = value.params
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => p.role !== 'clickid' && p.role !== 'payout');

  const EXTRA_SLOTS = 10;
  const padded = [...extras];
  while (padded.length < EXTRA_SLOTS) {
    padded.push({ p: { param: '', macro: '', name: '', role: '' }, index: -padded.length - 1 });
  }

  /** A negative index means the slot is not in `params` yet. */
  const setExtra = (index, patch) => {
    if (index >= 0) {
      set({ params: value.params.map((p, x) => (x === index ? { ...p, ...patch } : p)) });
      return;
    }
    set({ params: [...value.params, { param: '', macro: '', name: '', role: '', ...patch }] });
  };

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

  // Two rows is what a source usually needs; the rest are there when asked for.
  const visibleExtras = showAllParams ? padded : padded.slice(0, 2);

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
            <Field label="Alias Offer source">
              <input
                type="text"
                value={value.aliasName}
                onChange={(e) => set({ aliasName: e.target.value })}
                placeholder="N/A"
              />
            </Field>
          </div>

          <CopyField label="Postback URL" value={postbackUrl()} />
          <div className="rt-hint">
            Build your postback URL here and copy it to your affiliate network&apos;s account
          </div>

          <Field label="Currency">
            <select value={value.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Offer URL template"
            hint="Fills the URL of every new offer created under this source, so the shape stays the same and {clickid} is never forgotten."
          >
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
        <div className="rt-card-head">Postback parameters</div>
        <div className="rt-card-body">
          {/* The two a postback cannot work without: which parameter carries the
              click id, and which carries the amount. Everything optional lives
              in the grid below. */}
          <Field label="CLICKID">
            <input
              type="text"
              className="mono"
              value={roleParam('clickid')}
              onChange={(e) => setRoleParam('clickid', e.target.value, 'Click ID')}
              placeholder="clickid"
            />
          </Field>
          <Field label="SUM">
            <input
              type="text"
              className="mono"
              value={roleParam('payout')}
              onChange={(e) => setRoleParam('payout', e.target.value, 'Payout')}
              placeholder="sum"
            />
          </Field>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">
          <span className="head-title">
            Additional parameters
            <LuCircleHelp
              className="head-help"
              title="Anything else the network sends on the postback, kept alongside the conversion."
            />
          </span>
        </div>
        <div className="rt-card-body tight">
          <div className="cm-head cm4">
            <span>
              Parameter
              <LuCircleHelp title="The query parameter on the postback URL." />
            </span>
            <span>
              Macro / Token
              <LuCircleHelp title="What the network puts in it, if it documents one." />
            </span>
            <span>
              Name / Description
              <LuCircleHelp title="Your own label for this value." />
            </span>
            <span>
              Role
              <LuCircleHelp title="Which conversion field the value fills, if any." />
            </span>
          </div>

          {visibleExtras.map(({ p, index }, row) => (
            <div className="param-row" key={index}>
              <Field label={`Sub${row + 1}`}>
                <input
                  type="text"
                  className="mono"
                  value={p.param}
                  onChange={(e) => setExtra(index, { param: e.target.value })}
                  placeholder={`sub${row + 1}`}
                />
              </Field>
              <Field label={`Sub${row + 1}`}>
                <input
                  type="text"
                  className="mono"
                  value={p.macro}
                  onChange={(e) => setExtra(index, { macro: e.target.value })}
                />
              </Field>
              <Field label={`Sub${row + 1}`}>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => setExtra(index, { name: e.target.value })}
                  placeholder="hint"
                />
              </Field>
              <Field label={`Sub${row + 1}`}>
                <select value={p.role} onChange={(e) => setExtra(index, { role: e.target.value })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ))}

          <button type="button" className="link-plain" onClick={() => setShowAllParams((s) => !s)}>
            {showAllParams ? 'Show less' : 'Show more'}
          </button>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Conversion status</div>
        <div className="rt-card-body">
          <Field label="Conversion status">
            <select
              value={value.defaultConversionStatus}
              onChange={(e) => set({ defaultConversionStatus: e.target.value })}
            >
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
          <div className="rt-hint">
            Use it to differentiate different conversions based on their statuses. Applied when the
            postback carries no status of its own; an offer&apos;s own default wins over this.
          </div>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">
          <span className="head-title">
            Click Expiration
            <LuCircleHelp
              className="head-help"
              title="Refuse a conversion whose click is older than this window, and log why."
            />
          </span>
        </div>
        <div className="rt-card-body">
          <Switch
            checked={value.clickExpiration.enabled}
            onChange={(v) => set({ clickExpiration: { ...value.clickExpiration, enabled: v } })}
            label="Enable"
          />
          <div style={{ marginTop: 14 }}>
            <Field label="Days">
              <input
                type="number"
                min="0"
                disabled={!value.clickExpiration.enabled}
                value={value.clickExpiration.days}
                onChange={(e) =>
                  set({ clickExpiration: { ...value.clickExpiration, days: Number(e.target.value) } })
                }
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">
          <span className="head-title">
            Postback protection
            <LuCircleHelp
              className="head-help"
              title="Require the security key on every postback for this source. Off, a postback carrying no key is still accepted."
            />
          </span>
        </div>
        <div className="rt-card-body">
          <Switch
            checked={value.postbackProtection.enabled}
            onChange={(v) => set({ postbackProtection: { enabled: v } })}
            label="Enable"
          />
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Default duplicate postback mode</div>
        <div className="rt-card-body">
          <Field label="Mode">
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

      <div className="rt-card">
        <div className="rt-card-head">
          <span className="head-title">
            Whitelisted IPs
            <LuCircleHelp
              className="head-help"
              title="If you want to receive conversions only from certain IPs, add those IPs here."
            />
          </span>
        </div>
        <div className="rt-card-body">
          <Switch
            checked={value.whitelistedIps.enabled}
            onChange={(v) => set({ whitelistedIps: { ...value.whitelistedIps, enabled: v } })}
            label="Enable"
          />
          <div style={{ marginTop: 14 }}>
            <Field label="IPs">
              <textarea
                className="mono"
                style={{ minHeight: 90 }}
                disabled={!value.whitelistedIps.enabled}
                value={(value.whitelistedIps.ips || []).join('\n')}
                onChange={(e) =>
                  set({
                    whitelistedIps: {
                      ...value.whitelistedIps,
                      ips: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder={'203.0.113.10\n198.51.100.7'}
              />
            </Field>
          </div>
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
