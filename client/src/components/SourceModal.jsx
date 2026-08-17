import { useEffect, useState } from 'react';
import {
  LuCircleArrowUp,
  LuCircleCheck,
  LuCircleHelp,
  LuCircleX,
  LuInfo,
  LuPencil,
  LuPlus,
  LuTrash2,
} from 'react-icons/lu';
import { SiGoogle, SiMeta } from 'react-icons/si';
import Modal from './Modal.jsx';
import Field from './Field.jsx';
import CopyField from './CopyField.jsx';
import { api } from '../api/client.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'BRL', 'RUB'];

/**
 * The click stores sub1..sub20, so twenty is the real ceiling on parameters
 * rather than a chosen number. Every slot is always drawn; the ones left empty
 * are dropped on save.
 */
const PARAM_SLOTS = 20;

const COST_DEPTHS = [
  ['campaign', 'Campaign level'],
  ['adset', 'Adset level'],
  ['ad', 'Ad level'],
];

const COST_FREQUENCIES = [
  [5, '5 minutes'],
  [15, '15 minutes'],
  [30, '30 minutes'],
  [60, '1 hour'],
  [180, '3 hours'],
  [360, '6 hours'],
  [720, '12 hours'],
  [1440, '24 hours'],
];

/**
 * The role picker, in the order it is offered. Click Ref ID and Click cost ID
 * are deliberately absent: the channel form has dedicated fields for both, so
 * offering them here as well would give one setting two homes.
 */
const ROLE_LABELS = {
  '': 'None',
  campaignId: 'Cid',
  pubId: 'Pubid',
  placementId: 'Pid',
  adId: 'Aid',
  adgroupId: 'Gid',
  role1: 'RT role1',
  role2: 'RT role2',
  source: 'Rt source',
  medium: 'Rt medium',
  campaign: 'Rt campaign',
  adgroup: 'Rt adgroup',
  ad: 'Rt ad',
  placement: 'Rt placement',
  keyword: 'Rt keyword',
  placementHashed: 'RT placementhashed',
};
const ROLES = Object.keys(ROLE_LABELS);

/** Labels for roles no longer offered, so an older channel still reads true. */
const LEGACY_ROLE_LABELS = { cost: 'Click cost (legacy)', clickref: 'Click ref ID (legacy)' };

/**
 * A select whose value is missing from its options renders blank and quietly
 * rewrites the field on the next save. Channels created from older templates
 * carry exactly such roles, so the stored one is appended rather than dropped.
 */
const rolesFor = (role) => (role && !ROLES.includes(role) ? [...ROLES, role] : ROLES);
const roleLabel = (role) => ROLE_LABELS[role] ?? LEGACY_ROLE_LABELS[role] ?? role;

/** Google Ads conversion action categories, as the Ads API names them. */
const GOOGLE_CATEGORIES = [
  'PURCHASE',
  'LEAD',
  'SIGNUP',
  'PAGE_VIEW',
  'DOWNLOAD',
  'ADD_TO_CART',
  'BEGIN_CHECKOUT',
  'SUBSCRIBE_PAID',
  'PHONE_CALL_LEAD',
  'SUBMIT_LEAD_FORM',
  'BOOK_APPOINTMENT',
  'REQUEST_QUOTE',
  'DEFAULT',
];

const blankParam = (n) => ({ param: `sub${n}`, macro: '', name: '', role: '' });

/** Draw exactly PARAM_SLOTS rows, continuing the sub numbering past the filled ones. */
const padParams = (params = []) => {
  const rows = params.slice(0, PARAM_SLOTS);
  while (rows.length < PARAM_SLOTS) rows.push(blankParam(rows.length + 1));
  return rows;
};

const blankIntegration = () => ({
  provider: '',
  adAccountId: '',
  mccId: '',
  accessToken: '',
  status: 'not_connected',
  accountName: '',
  grantedEmail: '',
  lastError: '',
  hasToken: false,
  impressionCostSync: false,
});

export const blankSource = () => ({
  name: '',
  aliasChannel: '',
  currency: 'USD',
  s2sPostbackTemplate: '',
  externalId: '',
  clickIdParam: '',
  costParam: 'cost',
  costUpdateDepth: 'adset',
  costUpdateFrequency: 5,
  params: padParams([]),
  integration: blankIntegration(),
  capiPixels: [],
  conversionMatching: [],
  cm360: [],
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
    integration: { ...blankIntegration(), ...(s.integration || {}) },
    capiPixels: s.capiPixels || [],
    conversionMatching: s.conversionMatching || [],
    cm360: s.cm360 || [],
    params: padParams(s.params?.length ? s.params : fromTokens),
  };
};

const STATUS_BADGE = {
  connected: { text: 'Connected', cls: 'ok', Icon: LuCircleCheck },
  error: { text: 'Not connected', cls: 'bad', Icon: LuCircleX },
  not_connected: { text: 'Not connected', cls: 'bad', Icon: LuCircleX },
};

export default function SourceModal({ value, onChange, onClose, onSave, saving, error }) {
  const [macros, setMacros] = useState([]);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState(null);
  const [editingPixel, setEditingPixel] = useState(null);
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

  const integration = value.integration || blankIntegration();
  const isMeta = integration.provider === 'meta';
  const isGoogle = integration.provider === 'google';
  const setIntegration = (patch) => {
    setVerifyMsg(null);
    set({ integration: { ...integration, ...patch } });
  };

  const matches = value.conversionMatching || [];
  const setMatch = (i, patch) =>
    set({ conversionMatching: matches.map((m, x) => (x === i ? { ...m, ...patch } : m)) });
  const addMatch = () =>
    set({
      conversionMatching: [
        ...matches,
        { conversionType: '', conversionName: '', category: 'PURCHASE', includeInConversions: true },
      ],
    });

  const cm = value.cm360 || [];
  const setCm = (i, patch) => set({ cm360: cm.map((m, x) => (x === i ? { ...m, ...patch } : m)) });
  const addCm = () =>
    set({ cm360: [...cm, { conversionType: '', profileId: '', floodlightActivityId: '' }] });

  const pixels = value.capiPixels || [];
  const setPixels = (next) => set({ capiPixels: next });
  const setPixel = (i, patch) =>
    setPixels(pixels.map((p, x) => (x === i ? { ...p, ...patch } : p)));
  const addPixel = () => {
    setPixels([
      ...pixels,
      { platform: 'meta', label: '', pixelId: '', accessToken: '', testEventCode: '', enabled: true },
    ]);
    // A new pixel is useless without its token, so open it straight away
    setEditingPixel(pixels.length);
  };

  /**
   * Save, then ask the server to call the platform.
   *
   * The check has to run server-side, because the credentials live there and
   * are never handed back to the browser - so whatever was just typed has to
   * reach the server first. Saving here rather than asking the user to save is
   * not a shortcut: the modal's own Save closes it, so a button that only read
   * stored values could never see the credentials being entered.
   */
  const verify = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const { data: saved } = await api.put(`/sources/${value._id}`, value);
      const { data } = await api.post(`/sources/${value._id}/integration/verify`);
      // The saved copy carries no secrets, so this also clears the typed ones
      // from the form - they are stored now and show as a placeholder instead.
      onChange({ ...sourceToForm(saved), integration: { ...saved.integration, ...data.integration } });
      setVerifyMsg(
        data.ok
          ? { ok: true, text: `Connected to ${data.integration.accountName || 'the ad account'}.` }
          : { ok: false, text: data.integration.lastError || 'The platform rejected the credentials.' }
      );
    } catch (e) {
      setVerifyMsg({ ok: false, text: e.response?.data?.error || e.message });
    } finally {
      setVerifying(false);
    }
  };

  /**
   * Hand the operator to Google's consent screen. The form is saved on the way
   * out because this leaves the page entirely - Google decides when we come
   * back, and anything unsaved would be gone by then.
   */
  const signInWithGoogle = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      await api.put(`/sources/${value._id}`, value);
      const { data } = await api.post(`/sources/${value._id}/integration/google/start`);
      window.location.href = data.url;
    } catch (e) {
      setVerifyMsg({ ok: false, text: e.response?.data?.error || e.message });
      setVerifying(false);
    }
  };

  const verifyAlert = verifyMsg ? (
    <div className={`alert ${verifyMsg.ok ? 'success' : 'error'}`}>{verifyMsg.text}</div>
  ) : integration.status === 'error' && integration.lastError ? (
    <div className="alert error">{integration.lastError}</div>
  ) : null;

  const previewQuery = value.params
    .filter((p) => p.param && p.macro)
    .map((p) => `${p.param}=${p.macro}`)
    .join('&');

  const badge = STATUS_BADGE[integration.status] || STATUS_BADGE.not_connected;

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
                placeholder="Meta (ex Facebook)"
              />
            </Field>
            <Field label="Alias channel">
              <input
                type="text"
                value={value.aliasChannel}
                onChange={(e) => set({ aliasChannel: e.target.value })}
                placeholder="facebook"
              />
            </Field>
          </div>

          <div className="inline-field">
            <label>Cost update depth:</label>
            <select
              value={value.costUpdateDepth}
              onChange={(e) => set({ costUpdateDepth: e.target.value })}
            >
              {COST_DEPTHS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {isGoogle ? (
            <>
              <div className="rt-hint">
                Important: For Google Performance Max (PMax) campaigns, only campaign-level cost
                update is supported. Do not change the cost update depth level for a PMax channel.
              </div>
              <div className="rt-hint">
                For the Google Ads (No-redirect tracking) template you can pick any depth from the
                drop-down list. Deeper means more rows fetched on every cycle.
              </div>
            </>
          ) : (
            <div className="rt-hint">
              How deep the spend pulled from the ad platform is attributed. Deeper means more rows
              fetched on every cycle.
            </div>
          )}

          <div className="inline-field">
            <label>Cost update frequency:</label>
            <select
              value={value.costUpdateFrequency}
              onChange={(e) => set({ costUpdateFrequency: Number(e.target.value) })}
            >
              {COST_FREQUENCIES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
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
          <div className="rt-hint">
            A label only — this tracker stores every amount as sent and does no conversion.
          </div>

          <div className="field-row">
            <Field label="Click Ref ID">
              <input
                type="text"
                className="mono"
                value={value.clickIdParam}
                onChange={(e) => set({ clickIdParam: e.target.value })}
                placeholder="fbclid"
              />
            </Field>
            {/* Sits beside Click Ref ID because it is the same kind of thing:
                which incoming query parameter carries which known value. */}
            <Field label="Click cost ID">
              <input
                type="text"
                className="mono"
                value={value.costParam}
                onChange={(e) => set({ costParam: e.target.value })}
                placeholder="cost"
              />
            </Field>
            <Field label="External ID">
              <input
                type="text"
                value={value.externalId}
                onChange={(e) => set({ externalId: e.target.value })}
              />
            </Field>
          </div>

          <Field label="S2S postback template">
            <input
              type="text"
              className="mono"
              value={value.s2sPostbackTemplate}
              onChange={(e) => set({ s2sPostbackTemplate: e.target.value })}
              placeholder="https://source.com/postback?clickid={sub1}&payout={payout}&status={status}"
            />
          </Field>
          <div className="rt-hint">
            Fired on every conversion for campaigns that have no forwarding of their own.
          </div>

          {macros.length > 0 && (
            <details style={{ margin: '0 0 18px' }}>
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

          <div className="field-row">
            <Field label="Status">
              <select value={value.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </Field>
            <Field label="Notes">
              <input
                type="text"
                value={value.notes || ''}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="rt-card">
        <div className="rt-card-head">Additional parameters</div>
        <div className="rt-card-body tight">
          <div className="rt-hint" style={{ marginBottom: 12 }}>
            A <strong>role</strong> routes the value into a known slot on the click, so it appears in
            reports and the Rt columns instead of only living in a subID. Leave a row blank to skip
            it.
          </div>

          {value.params.map((p, i) => (
            <div className="param-row" key={i}>
              <Field label="Parameter" required>
                <input
                  type="text"
                  className="mono"
                  value={p.param}
                  onChange={(e) => setParam(i, { param: e.target.value })}
                  placeholder={`sub${i + 1}`}
                />
              </Field>
              <Field label="Macro/token">
                <input
                  type="text"
                  className="mono"
                  value={p.macro}
                  onChange={(e) => setParam(i, { macro: e.target.value })}
                  placeholder="{{campaign.id}}"
                />
              </Field>
              <Field label="Name / Description">
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                  placeholder="hint"
                />
              </Field>
              <Field label="Select role">
                <select value={p.role} onChange={(e) => setParam(i, { role: e.target.value })}>
                  {rolesFor(p.role).map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ))}

          <div style={{ marginTop: 18 }}>
            <CopyField
              label="Generated tracking-link query"
              value={previewQuery || 'Add a macro to a parameter to build the query'}
            />
            <div className="rt-hint" style={{ marginTop: -8 }}>
              This is appended to a campaign&apos;s click URL, e.g.{' '}
              <span className="mono">
                {origin}/c/your-campaign?{previewQuery || 'sub1={{campaign.id}}'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {isGoogle && (
        <div className="rt-card">
          <div className="rt-card-head">
            <span className="head-title">Google API integration</span>
            <span className={`status-pill ${badge.cls}`}>
              {badge.text}
              <badge.Icon />
            </span>
          </div>
          <div className="rt-card-body">
            <div className="split-row">
              <Field label="Google Ads Account ID" required>
                <input
                  type="text"
                  className="mono"
                  value={integration.adAccountId}
                  onChange={(e) => setIntegration({ adAccountId: e.target.value })}
                  placeholder="123-456-7890"
                />
              </Field>
              <button
                type="button"
                className="brand-btn"
                onClick={integration.status === 'connected' ? verify : signInWithGoogle}
                disabled={!value._id || verifying}
                title={
                  integration.status === 'connected'
                    ? 'Re-check this account against Google'
                    : 'Grant this tracker access to the ad account'
                }
              >
                {verifying ? <span className="spinner" /> : <SiGoogle className="brand-mark-google" />}
                {integration.status === 'connected' ? 'Re-check connection' : 'Sign in with Google'}
              </button>
            </div>
            <div className="rt-hint">
              {integration.grantedEmail
                ? `Access granted by ${integration.grantedEmail}. Costs are pulled and conversions are sent for this ad account.`
                : 'Costs are pulled and conversions are sent for the connected ad account.'}
            </div>

            {/* Sits under the button that produced it, not at the foot of the
                panel where a scrolled-down reader would never see it. */}
            {verifyAlert}

            <Field label="Google MCC Account ID (optional)">
              <input
                type="text"
                className="mono"
                value={integration.mccId}
                onChange={(e) => setIntegration({ mccId: e.target.value })}
              />
            </Field>
            <div className="rt-hint">
              Add an MCC account id to send conversions to it and not the ad account (optional).
              <br />
              Make sure the Google account you sign in with can reach both the ad account and the
              MCC.
            </div>

            <h4 className="sub-head">Conversion Matching</h4>
            <div className="cm-head cm4">
              <span>
                Conversion Type <b>*</b>
                <LuCircleHelp title="A conversion type recorded by this tracker." />
              </span>
              <span>
                Conversion name <b>*</b>
                <LuCircleHelp title="The conversion action's name in the Google Ads account." />
              </span>
              <span>
                Category <b>*</b>
                <LuCircleHelp title="The Google Ads conversion category the action belongs to." />
              </span>
              <span>
                Include in &quot;conversions&quot; <b>*</b>
                <LuCircleHelp title="Off keeps the action out of the bidding conversions column." />
              </span>
            </div>
            {matches.map((m, i) => (
              <div className="cm-row cm4" key={i}>
                <Field>
                  <input
                    type="text"
                    value={m.conversionType}
                    onChange={(e) => setMatch(i, { conversionType: e.target.value })}
                    placeholder="sale"
                  />
                </Field>
                <Field>
                  <input
                    type="text"
                    value={m.conversionName}
                    onChange={(e) => setMatch(i, { conversionName: e.target.value })}
                    placeholder="Purchase"
                  />
                </Field>
                <Field>
                  <select value={m.category} onChange={(e) => setMatch(i, { category: e.target.value })}>
                    {GOOGLE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="cm-tail">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={m.includeInConversions !== false}
                      onChange={(e) => setMatch(i, { includeInConversions: e.target.checked })}
                    />
                    <span className="track" />
                  </label>
                  <button
                    type="button"
                    className="head-icon-btn danger"
                    onClick={() => set({ conversionMatching: matches.filter((_, x) => x !== i) })}
                    title="Remove this row"
                  >
                    <LuTrash2 />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="add-more" onClick={addMatch}>
              <LuCircleArrowUp />
              Add more
            </button>

            <h4 className="sub-head">Campaign Manager 360</h4>
            <div className="cm-head cm3">
              <span>
                Conversion Type <b>*</b>
                <LuCircleHelp title="A conversion type recorded by this tracker." />
              </span>
              <span>
                Profile ID <b>*</b>
                <LuCircleHelp title="Your Campaign Manager 360 user profile id." />
              </span>
              <span>
                Floodlight activity ID <b>*</b>
                <LuCircleHelp title="The Floodlight activity the conversion is attributed to." />
              </span>
            </div>
            {cm.map((m, i) => (
              <div className="cm-row cm3" key={i}>
                <Field>
                  <input
                    type="text"
                    value={m.conversionType}
                    onChange={(e) => setCm(i, { conversionType: e.target.value })}
                    placeholder="sale"
                  />
                </Field>
                <Field>
                  <input
                    type="text"
                    className="mono"
                    value={m.profileId}
                    onChange={(e) => setCm(i, { profileId: e.target.value })}
                  />
                </Field>
                <div className="cm-tail">
                  <Field>
                    <input
                      type="text"
                      className="mono"
                      value={m.floodlightActivityId}
                      onChange={(e) => setCm(i, { floodlightActivityId: e.target.value })}
                    />
                  </Field>
                  <button
                    type="button"
                    className="head-icon-btn danger"
                    onClick={() => set({ cm360: cm.filter((_, x) => x !== i) })}
                    title="Remove this row"
                  >
                    <LuTrash2 />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="add-more" onClick={addCm}>
              <LuCircleArrowUp />
              Add more
            </button>

            <div className="info-note">
              <LuInfo />
              <div>
                Allow this tracker to access your Google Ads account to activate the integration:
                <br />
                #1 Click &quot;Sign in with Google&quot; and accept the permissions.
                <br />
                #2 Once accepted, fill in the remaining fields and save the changes.
              </div>
            </div>
          </div>
        </div>
      )}

      {isMeta && (
        <>
          <div className="rt-card">
            <div className="rt-card-head">
              <span className="head-title">
                Meta API integration
                <LuCircleHelp
                  className="head-help"
                  title="Lets the tracker read spend from the ad account and send conversions back."
                />
              </span>
              <span className={`status-pill ${badge.cls}`}>
                {badge.text}
                <badge.Icon />
              </span>
            </div>
            <div className="rt-card-body">
              <div className="field-row">
                <Field label="Ad account ID">
                  <input
                    type="text"
                    className="mono"
                    value={integration.adAccountId}
                    onChange={(e) => setIntegration({ adAccountId: e.target.value })}
                    placeholder="1234567890"
                  />
                </Field>
                <Field label="Access token">
                  <input
                    type="password"
                    className="mono"
                    autoComplete="new-password"
                    value={integration.accessToken || ''}
                    onChange={(e) => setIntegration({ accessToken: e.target.value })}
                    placeholder={integration.hasToken ? '••••••••••••' : 'EAAG…'}
                  />
                </Field>
              </div>

              <button
                type="button"
                className="brand-btn"
                onClick={verify}
                disabled={!value._id || verifying}
                title={!value._id ? 'Save the channel first' : 'Check the credentials against Meta'}
              >
                {verifying ? <span className="spinner" /> : <SiMeta className="brand-mark-meta" />}
                Connect Meta
              </button>

              {verifyAlert}

              <label className="switch" style={{ marginTop: 18 }}>
                <input
                  type="checkbox"
                  checked={!!integration.impressionCostSync}
                  onChange={(e) => setIntegration({ impressionCostSync: e.target.checked })}
                />
                <span className="track" />
                Impression cost sync
              </label>

              <div className="info-note">
                <LuInfo />
                <div>
                  Use when campaign/ad set/ad has impressions and spend but no clicks.
                  <br />
                  To keep spend consistent, the system records one system (dummy) click and assigns
                  the cost to it.
                </div>
              </div>
            </div>
          </div>

          <div className="rt-card">
            <div className="rt-card-head">
              <span className="head-title">
                <SiMeta className="brand-mark-meta" />
                CAPI Meta settings
                <LuCircleHelp
                  className="head-help"
                  title="Every conversion on this channel is also sent to these pixels through Meta's Conversions API."
                />
              </span>
            </div>
            <div className="rt-card-body">
              {pixels.map((p, i) => (
                <div className="capi-row" key={i}>
                  <Field label="Select platform">
                    <select value="meta" disabled>
                      <option value="meta">Meta</option>
                    </select>
                  </Field>
                  <Field label="Select Pixel">
                    <input
                      type="text"
                      className="mono"
                      value={p.pixelId}
                      onChange={(e) => setPixel(i, { pixelId: e.target.value })}
                      placeholder="None"
                    />
                  </Field>
                  <button
                    type="button"
                    className="head-icon-btn"
                    onClick={() => setEditingPixel(editingPixel === i ? null : i)}
                    title={editingPixel === i ? 'Done' : 'Edit this pixel'}
                  >
                    <LuPencil />
                  </button>
                  <button
                    type="button"
                    className="head-icon-btn danger"
                    onClick={() => {
                      setEditingPixel(null);
                      setPixels(pixels.filter((_, x) => x !== i));
                    }}
                    title="Remove this pixel"
                  >
                    <LuTrash2 />
                  </button>

                  {editingPixel === i && (
                    <div className="capi-detail">
                      <div className="field-row">
                        <Field label="Label">
                          <input
                            type="text"
                            value={p.label || ''}
                            onChange={(e) => setPixel(i, { label: e.target.value })}
                            placeholder="Main pixel"
                          />
                        </Field>
                        <Field label="Conversions API token">
                          <input
                            type="password"
                            className="mono"
                            autoComplete="new-password"
                            value={p.accessToken || ''}
                            onChange={(e) => setPixel(i, { accessToken: e.target.value })}
                            placeholder={p.hasToken ? '••••••••••••' : 'EAAG…'}
                          />
                        </Field>
                        <Field label="Test event code">
                          <input
                            type="text"
                            className="mono"
                            value={p.testEventCode || ''}
                            onChange={(e) => setPixel(i, { testEventCode: e.target.value })}
                            placeholder="TEST12345"
                          />
                        </Field>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={p.enabled !== false}
                          onChange={(e) => setPixel(i, { enabled: e.target.checked })}
                        />
                        <span className="track" />
                        Enabled
                      </label>
                    </div>
                  )}
                </div>
              ))}

              <button type="button" className="link-btn" onClick={addPixel}>
                <LuPlus />
                Add Pixel
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
