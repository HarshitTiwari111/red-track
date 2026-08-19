import { useEffect, useState } from 'react';
import {
  LuCircleArrowUp,
  LuCircleCheck,
  LuCircleHelp,
  LuCircleX,
  LuTriangleAlert,
  LuInfo,
  LuPencil,
  LuPlus,
  LuTrash2,
} from 'react-icons/lu';
import { SiGoogle, SiMeta } from 'react-icons/si';
import Modal from './Modal.jsx';
import Field from './Field.jsx';
import CopyField from './CopyField.jsx';
import CapiPixelPicker from './CapiPixelPicker.jsx';
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

/**
 * Which channel a Google sign-in was started for. The proxy returns the browser
 * with the token appended and nothing else, so the channel has to survive the
 * round trip on this side.
 */
export const PENDING_GOOGLE_CHANNEL = 'kap.google.pendingChannel';

/**
 * The proxy has used several names for the same value, and drops it in the
 * query string or the fragment depending on the path taken.
 */
export const GOOGLE_TOKEN_KEYS = ['google_refresh_token', 'refresh_token', 'refreshToken', 'token'];

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
  refreshToken: '',
  hasRefreshToken: false,
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
  capiPixelIds: [],
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
    capiPixelIds: s.capiPixelIds || [],
    conversionMatching: s.conversionMatching || [],
    cm360: s.cm360 || [],
    params: padParams(s.params?.length ? s.params : fromTokens),
  };
};

/**
 * Signing in and being able to read the ad account are two different things,
 * and collapsing them into one badge made a successful sign-in read as a
 * failure. A grant that cannot see the account gets its own state.
 */
const statusBadge = (integration) => {
  if (integration.status === 'connected') {
    return { text: 'Connected', cls: 'ok', Icon: LuCircleCheck };
  }
  if (integration.hasRefreshToken) {
    return { text: 'Signed in — no account access', cls: 'warn', Icon: LuTriangleAlert };
  }
  return { text: 'Not connected', cls: 'bad', Icon: LuCircleX };
};

export default function SourceModal({ value, onChange, onClose, onSave, saving, error }) {
  const [macros, setMacros] = useState([]);
  // Whether the proxy can run a Google sign-in. Until it can, the refresh
  // token has to be supplied by hand, so the panel offers a field instead.
  const [googleSignIn, setGoogleSignIn] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState(null);
  // Set once a sign-in is attempted on an install with no Meta app of its own
  const [metaSetup, setMetaSetup] = useState(null);
  const origin = window.location.origin;

  useEffect(() => {
    api
      .get('/macros')
      .then((r) => setMacros(r.data.macros || []))
      .catch(() => setMacros([]));
    api
      .get('/integrations/config')
      .then((r) => setGoogleSignIn(!!r.data.googleSignIn))
      .catch(() => setGoogleSignIn(false));
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
   * Hand the operator to Google's consent screen.
   *
   * The form is saved on the way out because this leaves the page entirely.
   * The proxy carries nothing back but the token, so which channel was being
   * connected is left here for the Traffic Channels page to pick up on return.
   */
  const signInWithGoogle = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      await api.put(`/sources/${value._id}`, value);
      const { data } = await api.post(`/sources/${value._id}/integration/google/start`);
      localStorage.setItem(PENDING_GOOGLE_CHANNEL, value._id);
      window.location.href = data.url;
    } catch (e) {
      setVerifyMsg({ ok: false, text: e.response?.data?.error || e.message });
      setVerifying(false);
    }
  };

  /**
   * Meta's consent screen, in a window of its own.
   *
   * Unlike the Google flow this does not leave the page: Facebook returns to a
   * callback that closes itself and posts back, so the modal is still open with
   * whatever was being typed still in it.
   */
  const signInWithMeta = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    setMetaSetup(null);
    try {
      await api.put(`/sources/${value._id}`, value);
      const { data } = await api.post(`/sources/${value._id}/integration/meta/start`);
      const win = window.open(data.url, 'kap-meta-signin', 'width=620,height=740');
      if (!win) throw new Error('Allow pop-ups for this site, then press Connect Meta again.');

      const onMessage = async (e) => {
        if (!e.data || typeof e.data.kapMeta === 'undefined') return;
        window.removeEventListener('message', onMessage);
        // Re-read the channel: the callback wrote the grant straight onto it
        try {
          const { data: fresh } = await api.get(`/sources/${value._id}`);
          onChange(sourceToForm(fresh));
          setVerifyMsg(
            e.data.kapMeta
              ? { ok: true, text: `Connected${fresh.integration?.accountName ? ` to ${fresh.integration.accountName}` : ''}.` }
              : { ok: false, text: fresh.integration?.lastError || 'The sign-in did not complete.' }
          );
        } catch {
          setVerifyMsg({ ok: false, text: 'Signed in — reopen this channel to see the result.' });
        }
        setVerifying(false);
      };
      window.addEventListener('message', onMessage);

      // A window closed without answering leaves the button spinning otherwise
      const poll = setInterval(() => {
        if (win.closed) {
          clearInterval(poll);
          setVerifying(false);
        }
      }, 700);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      /*
       * "No app configured" is not a failed sign-in, it is a step of the
       * install nobody has done yet - and a red line quoting two env var
       * names reads as a fault in the tracker. Swap it for the steps, with
       * the redirect URI ready to paste, since that is the part that has to
       * match Facebook exactly.
       */
      if (e.response?.status === 400 && /not set up on this install/i.test(msg)) {
        let redirectUri = `${window.location.origin}/api/v1/integrations/meta/callback`;
        try {
          const { data } = await api.get('/integrations/config');
          if (data.metaRedirectUri) redirectUri = data.metaRedirectUri;
        } catch {
          /* the fallback above is already the address this install serves */
        }
        setMetaSetup({ redirectUri });
      } else {
        setVerifyMsg({ ok: false, text: msg });
      }
      setVerifying(false);
    }
  };

  /**
   * Why the connect buttons are dead on an unsaved channel.
   *
   * The sign-in has to know which channel it is granting access to, and an
   * unsaved one has no id yet - so the button is disabled. A disabled button
   * dispatches no hover events, which means its own title never appears: the
   * wrapper below is what makes the reason reachable, the way RedTrack shows
   * it on hover instead of leaving a dead control unexplained.
   */
  const saveFirst = value._id
    ? ''
    : `Please save ${value.name || 'this channel'} as traffic channel first.`;

  const verifyAlert = verifyMsg ? (
    <div className={`alert ${verifyMsg.ok ? 'success' : 'error'}`}>{verifyMsg.text}</div>
  ) : integration.status === 'error' && integration.lastError ? (
    <div className="alert error">{integration.lastError}</div>
  ) : null;

  const previewQuery = value.params
    .filter((p) => p.param && p.macro)
    .map((p) => `${p.param}=${p.macro}`)
    .join('&');

  const badge = statusBadge(integration);

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
          {/* Both settings above describe a cost pull that does not run yet.
              They are kept so connecting one later needs no re-setup, but
              nothing acts on them today and the screen should say so. */}
          <div className="rt-hint">
            Both are stored for a future automatic cost pull — nothing fetches spend from the ad
            platform yet, so neither has any effect. Enter cost under Campaigns → Update costs.
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
              <span className="tip-wrap" title={saveFirst || undefined}>
                <button
                  type="button"
                  className="brand-btn"
                  onClick={googleSignIn && integration.status !== 'connected' ? signInWithGoogle : verify}
                  disabled={!value._id || verifying}
                  title={
                    saveFirst
                      ? undefined
                      : googleSignIn && integration.status !== 'connected'
                        ? 'Grant this tracker access to the ad account'
                        : 'Check this account against Google'
                  }
                >
                  {verifying ? <span className="spinner" /> : <SiGoogle className="brand-mark-google" />}
                  {googleSignIn && integration.status !== 'connected'
                    ? 'Sign in with Google'
                    : 'Connect'}
                </button>
              </span>
            </div>
            <div className="rt-hint">
              {integration.grantedEmail
                ? `Access granted by ${integration.grantedEmail}. Costs are pulled and conversions are sent for this ad account.`
                : 'Costs are pulled and conversions are sent for the connected ad account.'}
            </div>

            {/*
              The proxy holds the OAuth client, so normally it runs the sign-in
              and hands back a refresh token. Where it has no such endpoint the
              token is the one thing this app cannot obtain for itself, so it is
              asked for directly rather than leaving the panel unusable.
            */}
            {!googleSignIn && (
              <Field
                label="Google refresh token"
                hint="Sent to the proxy as x-user-refresh-token. Stored on the server and never shown again."
              >
                <input
                  type="password"
                  className="mono"
                  autoComplete="new-password"
                  value={integration.refreshToken || ''}
                  onChange={(e) => setIntegration({ refreshToken: e.target.value })}
                  placeholder={integration.hasRefreshToken ? '••••••••••••' : '1//…'}
                />
              </Field>
            )}

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
            {/*
              Column names only once there is a column to name. A freshly
              opened channel has no rows, and a heading hanging over empty
              space reads as fields that failed to render.
            */}
            {matches.length > 0 && (
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
            )}
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
            {cm.length > 0 && (
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
            )}
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
            {/* The badge belongs beside the thing it describes, not stranded at
                the far edge of a wide card. */}
            <div className="rt-card-head badge-inline">
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
              {/*
                One button, the way RedTrack has it.
                The ad account and the token are what the sign-in RETURNS, not
                what anyone types - asking for them up front made the operator
                go hunting in Business Settings for something Facebook hands
                over on its own, and made an empty field the reason a connect
                attempt failed. Whatever is wrong now comes back as a sentence
                under the button instead.
              */}
              <span className="tip-wrap" title={saveFirst || undefined}>
                <button
                  type="button"
                  className="brand-btn"
                  onClick={signInWithMeta}
                  disabled={!value._id || verifying}
                  title={saveFirst ? undefined : 'Sign in with Facebook'}
                >
                  {verifying ? <span className="spinner" /> : <SiMeta className="brand-mark-meta" />}
                  Connect Meta
                </button>
              </span>

              {verifyAlert}

              {metaSetup && (
                <div className="info-note">
                  <LuInfo />
                  <div>
                    <strong>One-time setup for this install.</strong> RedTrack signs you in through
                    the Meta app it owns; a tracker you host yourself signs you in through yours, so
                    it has to exist before the button can open Facebook.
                    <ol className="rt-steps">
                      <li>
                        At <span className="mono">developers.facebook.com</span> create an app of
                        type <strong>Business</strong> and add the{' '}
                        <strong>Facebook Login</strong> product.
                      </li>
                      <li>
                        Paste the address below into <em>Valid OAuth Redirect URIs</em>. It has to
                        match character for character.
                      </li>
                      <li>
                        Copy the app&apos;s <strong>App ID</strong> and{' '}
                        <strong>App secret</strong> into this install&apos;s environment as{' '}
                        <span className="mono">META_APP_ID</span> and{' '}
                        <span className="mono">META_APP_SECRET</span>, then restart it.
                      </li>
                    </ol>
                    <CopyField label="Valid OAuth Redirect URI" value={metaSetup.redirectUri} />
                    <div style={{ marginTop: 8 }}>
                      Done once for the whole tracker — every channel then connects with one click.
                    </div>
                  </div>
                </div>
              )}

              {/*
                Its own row, under the button, the way RedTrack lays it out -
                sharing a line made it read as part of the connect action.

                Disabled on purpose: the setting only means anything to a cost
                pull, and this install has none. A switch that saves and then
                changes nothing is worse than one that says why it is off.
              */}
              <div style={{ marginTop: 18 }}>
                <label className="switch" style={{ opacity: 0.55 }}>
                  <input
                    type="checkbox"
                    disabled
                    checked={!!integration.impressionCostSync}
                    onChange={(e) => setIntegration({ impressionCostSync: e.target.checked })}
                  />
                  <span className="track" />
                  Impression cost sync
                </label>
              </div>

              <div className="info-note">
                <LuInfo />
                <div>
                  <strong>Not available yet.</strong> This tells an automatic cost pull what to do
                  with spend that has impressions but no clicks — record one system click and hang
                  the cost off it. Nothing pulls cost from Meta yet, so the switch has nothing to
                  act on. Enter cost by hand under Campaigns → Update costs in the meantime.
                </div>
              </div>
            </div>
          </div>

          <CapiPixelPicker
            value={value.capiPixelIds || []}
            onChange={(ids) => set({ capiPixelIds: ids })}
            scope="source"
          />
        </>
      )}
    </Modal>
  );
}
