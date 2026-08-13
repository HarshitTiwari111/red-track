import { useRef, useState } from 'react';
import Modal from './Modal.jsx';
import Field, { Switch, ChipList } from './Field.jsx';
import CopyField from './CopyField.jsx';

const TABS = [
  { id: 'main', label: 'Main' },
  { id: 'caps', label: 'Caps' },
  { id: 'postback', label: 'Postback & macros' },
];

const MACROS = [
  'clickid', 'campaign_id', 'campaign_name', 'campaign_slug', 'source',
  'sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'sub6', 'sub7', 'sub8', 'sub9', 'sub10',
  'country', 'region', 'city', 'ip', 'device', 'os', 'browser', 'referrer',
  'gclid', 'fbclid', 'ttclid', 'cost', 'payout', 'offer_id', 'lander_id', 'timestamp', 'random',
];

const TIME_PERIODS = [
  { id: 'hour', label: 'Hour (resets every hour)' },
  { id: 'day', label: 'Day (00:00 to 23:59 in the report timezone)' },
  { id: 'month', label: 'Month (resets on the 1st)' },
  { id: 'total', label: 'Total (never resets)' },
];

export const blankOffer = () => ({
  name: '',
  networkId: '',
  url: '',
  payoutType: 'auto',
  defaultPayout: 0,
  defaultConversionStatus: 'approved',
  geo: [],
  tags: [],
  status: 'active',
  notes: '',
  caps: {
    uniqueVisits: 0,
    clickCap: 0,
    conversionCap: 0,
    timePeriod: 'day',
    filterType: 'none',
    alertOnClickCap: false,
    alertOnConversionCap: false,
  },
});

export const offerToForm = (o) => ({
  ...blankOffer(),
  ...o,
  networkId: o.networkId || '',
  geo: o.geo || [],
  tags: o.tags || [],
  caps: { ...blankOffer().caps, ...(o.caps || {}) },
});

export default function OfferModal({ value, networks, knownTags = [], onChange, onClose, onSave, saving, error }) {
  const [tab, setTab] = useState('main');
  const [advanced, setAdvanced] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [geoDraft, setGeoDraft] = useState('');
  const urlRef = useRef(null);

  const set = (patch) => onChange({ ...value, ...patch });
  const setCaps = (patch) => onChange({ ...value, caps: { ...value.caps, ...patch } });

  const network = networks.find((n) => String(n._id) === String(value.networkId));
  const postbackUrl = network
    ? `${window.location.origin}/postback?clickid={clickid}&payout={payout}&txid={txid}&status={status}&key=${network.postbackSecurityKey}`
    : `${window.location.origin}/postback?clickid={clickid}&payout={payout}&txid={txid}&status={status}`;

  /** Insert a macro at the caret so operators do not hand-type them. */
  const insertMacro = (m) => {
    const el = urlRef.current;
    const token = `{${m}}`;
    if (!el) return set({ url: (value.url || '') + token });
    const start = el.selectionStart ?? value.url.length;
    const end = el.selectionEnd ?? start;
    const next = `${value.url.slice(0, start)}${token}${value.url.slice(end)}`;
    set({ url: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
    return undefined;
  };

  const addTag = (t) => {
    const tag = String(t || '').trim().slice(0, 40);
    if (!tag || value.tags.includes(tag)) return;
    set({ tags: [...value.tags, tag] });
  };

  const addGeo = (g) => {
    const geo = String(g || '').trim().toUpperCase().slice(0, 3);
    if (!geo || value.geo.includes(geo)) return;
    set({ geo: [...value.geo, geo] });
  };

  const unusedTags = knownTags.filter((t) => !value.tags.includes(t));

  return (
    <Modal
      wide
      title="Offer"
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
      <div className="modal-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* ------------------------------------------------------------ MAIN */}
      {tab === 'main' && (
        <>
          <Field label="Offer name" required>
            <input type="text" value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="Offer name" />
          </Field>

          <Field label="Offer source" required hint="The affiliate network this offer belongs to — it scopes postback deduplication.">
            <select value={value.networkId} onChange={(e) => set({ networkId: e.target.value })}>
              <option value="">None</option>
              {networks.map((n) => (
                <option key={n._id} value={n._id}>
                  {n.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="URL" required>
            <input
              ref={urlRef}
              type="text"
              className="mono"
              value={value.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://network.com/offer/index.html?partner_macros={clickid}&partner_sub={sub1}"
            />
          </Field>

          <button type="button" className="collapse-btn" onClick={() => setAdvanced((a) => !a)}>
            Advanced tracking URL setup {advanced ? '⌃' : '⌄'}
          </button>

          {advanced && (
            <div className="collapse-panel">
              <div className="form-note" style={{ marginBottom: 10 }}>
                Click a macro to insert it into the URL at the cursor. Unknown macros resolve to an empty string, and
                every value is URL-encoded.
              </div>
              <div className="chips">
                {MACROS.map((m) => (
                  <button type="button" key={m} className="macro-chip" onClick={() => insertMacro(m)}>
                    {`{${m}}`}
                  </button>
                ))}
              </div>

              <Field label="Payout type" onAlt className="" hint="Fixed always uses the default revenue below; auto takes the payout from the postback.">
                <select value={value.payoutType} onChange={(e) => set({ payoutType: e.target.value })} style={{ marginTop: 16 }}>
                  <option value="auto">Auto — take the payout from the postback</option>
                  <option value="fixed">Fixed — always use the default revenue</option>
                </select>
              </Field>
            </div>
          )}

          <Field label="Default conversion revenue" suffix="$">
            <input
              type="number"
              step="0.01"
              min="0"
              value={value.defaultPayout}
              onChange={(e) => set({ defaultPayout: Number(e.target.value) })}
            />
          </Field>

          <Field label="Default conversion status" hint="Applied when a postback arrives without a status.">
            <select
              value={value.defaultConversionStatus}
              onChange={(e) => set({ defaultConversionStatus: e.target.value })}
            >
              <option value="approved">approved</option>
              <option value="pending">pending</option>
              <option value="rejected">rejected</option>
            </select>
          </Field>

          <Field label="Select country" hint="Informational — leave empty for global.">
            <div className="rt-box">
              <div className="chips">
                {value.geo.length === 0 && <span className="chip">Global</span>}
                {value.geo.map((g) => (
                  <span className="chip" key={g}>
                    {g}
                    <button type="button" onClick={() => set({ geo: value.geo.filter((x) => x !== g) })}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={geoDraft}
                  onChange={(e) => setGeoDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addGeo(geoDraft);
                      setGeoDraft('');
                    }
                  }}
                  onBlur={() => {
                    addGeo(geoDraft);
                    setGeoDraft('');
                  }}
                  placeholder="Add ISO-2 and press Enter"
                  style={{ width: 190, padding: '3px 8px', fontSize: 12 }}
                />
              </div>
            </div>
          </Field>

          <Field label="Default postback URL">
            <input type="text" className="mono" readOnly value={postbackUrl} onFocus={(e) => e.target.select()} />
            <div className="rt-hint">
              {network
                ? `Give this to ${network.name}. The security key is theirs alone.`
                : 'Pick an offer source above to include its security key.'}
            </div>
          </Field>

          <div className="form-section-title">Tags and notes</div>
          <div className="form-note" style={{ marginBottom: 8 }}>Tags selected:</div>
          <ChipList
            values={value.tags}
            onRemove={(t) => set({ tags: value.tags.filter((x) => x !== t) })}
            empty="No tags yet — type below to add one."
          />

          <div style={{ display: 'flex', gap: 8, margin: '12px 0 10px' }}>
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
              style={{ maxWidth: 260 }}
            />
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                addTag(tagDraft);
                setTagDraft('');
              }}
            >
              Add tag
            </button>
          </div>

          {unusedTags.length > 0 && (
            <>
              <div className="form-note" style={{ marginBottom: 6 }}>Already used tags:</div>
              <div className="chips">
                {unusedTags.map((t) => (
                  <button type="button" className="chip pick" key={t} onClick={() => addTag(t)}>
                    + {t}
                  </button>
                ))}
              </div>
            </>
          )}

          <Field label="Note" className="" >
            <textarea
              style={{ marginTop: 20, minHeight: 110 }}
              value={value.notes || ''}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Notes"
            />
          </Field>

          <Field label="Status">
            <select value={value.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </Field>

          <div className="form-section-title">Next steps:</div>
          <div className="form-note">
            Add this offer to a campaign path, then send the campaign&apos;s tracking link traffic. And do not forget to
            save.
          </div>
        </>
      )}

      {/* ------------------------------------------------------------ CAPS */}
      {tab === 'caps' && (
        <>
          <div className="alert info">
            Make sure the funnel has an alternative offer before you cap this one. When a cap is reached the offer is
            temporarily removed from the rotation and KAP Tracker stops sending traffic to it. Zero means no cap.
          </div>

          <Field label="Unique visits" hint="Cap on unique clicks in the period.">
            <input
              type="number"
              min="0"
              value={value.caps.uniqueVisits}
              onChange={(e) => setCaps({ uniqueVisits: Number(e.target.value) })}
            />
          </Field>

          <Field label="Time period">
            <select value={value.caps.timePeriod} onChange={(e) => setCaps({ timePeriod: e.target.value })}>
              {TIME_PERIODS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Filter type" hint="Choose what counts toward the click cap.">
            <select value={value.caps.filterType} onChange={(e) => setCaps({ filterType: e.target.value })}>
              <option value="none">None — every click counts</option>
              <option value="unique">Unique only — repeat visitors are ignored</option>
            </select>
          </Field>

          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 4 }}>
            <Field label="Conversion cap" className="" >
              <input
                type="number"
                min="0"
                value={value.caps.conversionCap}
                onChange={(e) => setCaps({ conversionCap: Number(e.target.value) })}
              />
            </Field>
            <Switch
              checked={value.caps.alertOnConversionCap}
              onChange={(v) => setCaps({ alertOnConversionCap: v })}
              label="Alert when cap is reached"
            />
          </div>

          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <Field label="Click cap" className="" >
              <input
                type="number"
                min="0"
                value={value.caps.clickCap}
                onChange={(e) => setCaps({ clickCap: Number(e.target.value) })}
              />
            </Field>
            <Switch
              checked={value.caps.alertOnClickCap}
              onChange={(v) => setCaps({ alertOnClickCap: v })}
              label="Alert when cap is reached"
            />
          </div>

          {value._id && value.capUsage && (
            <>
              <div className="form-section-title">Current period usage</div>
              <div className="form-note mono">
                clicks {value.capUsage.clicks} · uniques {value.capUsage.uniques} · conversions{' '}
                {value.capUsage.conversions}
                {value.cappedBy ? ` — currently capped by ${value.cappedBy}` : ''}
              </div>
            </>
          )}

          <div className="rt-hint" style={{ marginTop: 16 }}>
            Cap counters are recomputed every 30 seconds, so an offer can overshoot slightly under heavy traffic.
            Alerts need a Telegram bot token in <span className="mono">.env</span>.
          </div>
        </>
      )}

      {/* -------------------------------------------------------- POSTBACK */}
      {tab === 'postback' && (
        <>
          <CopyField label="Postback URL for this offer's network" value={postbackUrl} />
          {network && <CopyField label="Security key" value={network.postbackSecurityKey} />}

          <div className="form-section-title">How attribution works</div>
          <div className="form-note">
            Pass <span className="mono">{'{clickid}'}</span> in the offer URL. The network stores it and sends it back on
            the postback, which is how the conversion is matched to the click.
            <br />
            <br />
            Deduplication is scoped to <b>network + transaction id</b>. The same <span className="mono">txid</span>{' '}
            arriving again is ignored; arriving with a different status or payout updates the conversion and adjusts the
            reports by the difference.
            <br />
            <br />
            {value.payoutType === 'fixed'
              ? 'This offer uses a fixed payout, so a postback without a payout falls back to the default conversion revenue.'
              : 'This offer takes its payout from the postback. Set the payout type to fixed if the network does not send one.'}
          </div>

          <div className="form-section-title">Macros available in the offer URL</div>
          <div className="chips">
            {MACROS.map((m) => (
              <span className="macro-chip" key={m}>{`{${m}}`}</span>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
