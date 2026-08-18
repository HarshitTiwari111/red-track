import { useEffect, useState } from 'react';
import { LuCircleHelp, LuInfo, LuPlus, LuTrash2 } from 'react-icons/lu';
import { SiMeta } from 'react-icons/si';
import Modal from './Modal.jsx';
import Field, { Switch } from './Field.jsx';
import { api } from '../api/client.js';

/**
 * Meta's standard events. Only these are scored for Event Match Quality, so the
 * field is a list rather than free text - a typo would send a custom event that
 * silently never appears in the ad account's optimisation.
 */
const META_EVENTS = [
  'Purchase', 'Lead', 'Contact', 'CompleteRegistration', 'SubmitApplication', 'Subscribe',
  'StartTrial', 'AddToCart', 'AddToWishlist', 'AddPaymentInfo', 'InitiateCheckout',
  'ViewContent', 'Search', 'Schedule', 'FindLocation', 'CustomizeProduct', 'Donate',
];

/** Meta's action_source values. The first is the tracker's own default. */
const ACTION_SOURCES = [
  ['store_tracking_url', 'Store tracking URL'],
  ['website', 'Website'],
  ['app', 'App'],
  ['email', 'Email'],
  ['phone_call', 'Phone call'],
  ['chat', 'Chat'],
  ['physical_store', 'Physical store'],
  ['system_generated', 'System generated'],
  ['business_messaging', 'Business messaging'],
  ['other', 'Other'],
];

export const blankMetaPixel = () => ({
  title: '',
  pixelId: '',
  apiKey: '',
  defaultEventName: '',
  eventUrl: '',
  actionSource: 'store_tracking_url',
  dataQualityToken: '',
  testEventCode: '',
  customConversionMatching: false,
  conversionMatching: [],
  payoutRules: [],
  status: 'active',
});

export const metaPixelToForm = (p) => ({
  ...blankMetaPixel(),
  ...p,
  // Stored keys are never sent back, so the inputs start empty and a
  // placeholder says one is already held
  apiKey: '',
  dataQualityToken: '',
  conversionMatching: p.conversionMatching || [],
  payoutRules: p.payoutRules || [],
});

export default function MetaPixelModal({ value, onChange, onClose, onSave, saving, error }) {
  const [showPayout, setShowPayout] = useState((value.payoutRules || []).length > 0);
  const [conversionTypes, setConversionTypes] = useState([]);

  // The conversion types this install records, offered as suggestions below.
  useEffect(() => {
    api
      .get('/settings')
      .then(({ data }) => setConversionTypes((data.conversionTypes || []).map((t) => t.name).filter(Boolean)))
      .catch(() => setConversionTypes([]));
  }, []);

  const set = (patch) => onChange({ ...value, ...patch });

  const rules = value.payoutRules || [];
  const setRule = (i, patch) =>
    set({ payoutRules: rules.map((r, x) => (x === i ? { ...r, ...patch } : r)) });

  const matches = value.conversionMatching || [];
  const setMatch = (i, patch) =>
    set({ conversionMatching: matches.map((m, x) => (x === i ? { ...m, ...patch } : m)) });

  return (
    <Modal
      wide
      title={value._id ? 'Pixel' : 'Add new pixel'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={onSave} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}

      <div className="head-title" style={{ fontSize: 19, fontWeight: 650, marginBottom: 16 }}>
        <SiMeta className="brand-mark-meta" style={{ fontSize: 26 }} />
        Meta Integration
      </div>

      {/* The one mistake this screen exists to prevent, said before anything is
          typed rather than after a week of double-counted conversions. */}
      <div className="alert info">
        <div style={{ display: 'flex', gap: 10 }}>
          <LuInfo style={{ flex: '0 0 auto', marginTop: 2, fontSize: 16 }} />
          <div>
            <strong>Avoid duplicate conversions!</strong>
            <br />
            Set a pixel up in one place: either on the traffic channel or on the offer. Doing both
            sends the same conversion twice.
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>On a traffic channel, only conversions attributed to that channel are sent.</li>
              <li>
                On an offer, every conversion for that offer is sent, whichever traffic channel it
                came from.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="section-title">Title</div>
      <Field>
        <input
          type="text"
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Title *"
        />
      </Field>

      <div className="cm-head cm4" style={{ marginTop: 10 }}>
        <span>
          Pixel ID <b>*</b>
          <LuCircleHelp title="Events Manager → Data sources → your pixel." />
        </span>
        <span>
          API key <b>*</b>
          <LuCircleHelp title="The Conversions API access token generated for this pixel." />
        </span>
        <span>
          Default event name
          <LuCircleHelp title="Used when a conversion carries no event name of its own." />
        </span>
        <span>
          Event URL
          <LuCircleHelp title="Sent as the event's source URL when the conversion has none." />
        </span>
      </div>
      <div className="cm-row cm4">
        <Field>
          <input
            type="text"
            className="mono"
            value={value.pixelId}
            onChange={(e) => set({ pixelId: e.target.value })}
            placeholder="Pixel ID *"
          />
        </Field>
        <Field>
          <input
            type="password"
            className="mono"
            autoComplete="new-password"
            value={value.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={value.hasApiKey ? '••••••••••••' : 'Conversions API key *'}
          />
        </Field>
        <Field>
          <input
            type="text"
            value={value.defaultEventName}
            onChange={(e) => set({ defaultEventName: e.target.value })}
            placeholder="Default event name"
          />
        </Field>
        <Field>
          <input
            type="text"
            className="mono"
            value={value.eventUrl}
            onChange={(e) => set({ eventUrl: e.target.value })}
            placeholder="URL"
          />
        </Field>
      </div>

      <div className="cm-head cm3" style={{ marginTop: 10 }}>
        <span>
          Action source
          <LuCircleHelp title="Where Meta is told the conversion happened." />
        </span>
        <span>
          Data Quality API Token
          <LuCircleHelp title="Optional. Lets Meta report back on how well events match." />
        </span>
        <span />
      </div>
      <div className="cm-row cm3">
        <Field>
          <select value={value.actionSource} onChange={(e) => set({ actionSource: e.target.value })}>
            {ACTION_SOURCES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <input
            type="password"
            className="mono"
            autoComplete="new-password"
            value={value.dataQualityToken}
            onChange={(e) => set({ dataQualityToken: e.target.value })}
            placeholder={value.hasDataQualityToken ? '••••••••••••' : 'Data Quality API Token'}
          />
        </Field>
        <button type="button" className="add-more" onClick={() => setShowPayout((s) => !s)}>
          <LuPlus />
          Add payout customisation
        </button>
      </div>

      {showPayout && (
        <div className="rt-card">
          <div className="rt-card-body tight">
            <div className="rt-hint" style={{ marginTop: 0 }}>
              Send a fixed value for a conversion type instead of the payout the postback carried.
              Anything not listed keeps its own payout.
            </div>
            {rules.map((r, i) => (
              <div className="cm-row cm3" key={i}>
                <Field label="Conversion type">
                  <input
                    type="text"
                    value={r.conversionType}
                    onChange={(e) => setRule(i, { conversionType: e.target.value })}
                    placeholder="sale"
                  />
                </Field>
                <Field label="Value sent">
                  <input
                    type="number"
                    step="0.01"
                    value={r.value}
                    onChange={(e) => setRule(i, { value: Number(e.target.value) })}
                  />
                </Field>
                <div className="cm-tail">
                  <button
                    type="button"
                    className="head-icon-btn danger"
                    onClick={() => set({ payoutRules: rules.filter((_, x) => x !== i) })}
                    title="Remove this rule"
                  >
                    <LuTrash2 />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="link-plain"
              onClick={() => set({ payoutRules: [...rules, { conversionType: '', value: 0 }] })}
            >
              + Add rule
            </button>
          </div>
        </div>
      )}

      <div style={{ margin: '18px 0 4px' }}>
        <Switch
          checked={value.customConversionMatching}
          onChange={(v) =>
            // Switching it on with nothing to fill in reads as a dead end, so the
            // first empty rule comes with it.
            set({
              customConversionMatching: v,
              conversionMatching: v && matches.length === 0 ? [{ conversionType: '', eventName: '' }] : matches,
            })
          }
          label="Custom Conversion Matching"
        />
      </div>

      {value.customConversionMatching && (
        <div className="rt-card">
          <div className="rt-card-body tight">
            <div className="rt-hint" style={{ marginTop: 0 }}>
              Send a conversion type under a different event name. Without a rule, the conversion is
              sent under the name the postback used, or the default event name above.
            </div>
            {matches.map((m, i) => (
              <div className="cm-row cm3" key={i}>
                <Field label={`Conversion Type ${i + 1}`}>
                  {/* A list of the types this tracker records, with room for one
                      the settings do not name yet. */}
                  <input
                    type="text"
                    list="kap-conversion-types"
                    value={m.conversionType}
                    onChange={(e) => setMatch(i, { conversionType: e.target.value })}
                    placeholder="conversion"
                  />
                </Field>
                <Field label={`Event Name ${i + 1}`}>
                  <select value={m.eventName} onChange={(e) => setMatch(i, { eventName: e.target.value })}>
                    <option value="">Select an event</option>
                    {META_EVENTS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="cm-tail">
                  <button
                    type="button"
                    className="head-icon-btn danger"
                    onClick={() => set({ conversionMatching: matches.filter((_, x) => x !== i) })}
                    title="Remove this rule"
                  >
                    <LuTrash2 />
                  </button>
                </div>
              </div>
            ))}
            <datalist id="kap-conversion-types">
              {conversionTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button
              type="button"
              className="link-plain"
              onClick={() => set({ conversionMatching: [...matches, { conversionType: '', eventName: '' }] })}
            >
              + Add More
            </button>
            <div className="rt-hint">
              Meta scores Event Match Quality per event name, so a rule here is what makes the EMQ
              score on the list available.
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
