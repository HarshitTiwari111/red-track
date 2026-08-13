import Modal from './Modal.jsx';
import Field, { Switch } from './Field.jsx';

const DEVICES = ['desktop', 'mobile', 'tablet'];

export const FUNNEL_TYPES = [
  { id: 'single-landing', label: 'Single landing', hint: 'Visitor lands on a landing page, then clicks through to the offer.' },
  { id: 'direct-offer', label: 'Direct to offer', hint: 'No landing page — the click goes straight to the offer.' },
];

/** Shortcuts that fill the filter fields; they are not a stored entity. */
const PRESETS = [
  { id: 'mobile', label: 'Mobile only', filters: { device: ['mobile'] } },
  { id: 'desktop', label: 'Desktop only', filters: { device: ['desktop'] } },
  { id: 'in', label: 'India only', filters: { country: ['IN'] } },
  { id: 'tier1', label: 'Tier-1 countries', filters: { country: ['US', 'GB', 'CA', 'AU', 'DE'] } },
  { id: 'in-mobile', label: 'India + mobile', filters: { country: ['IN'], device: ['mobile'] } },
  { id: 'evening', label: 'Evening hours (18–23)', filters: { timeRange: { from: 18, to: 23 } } },
];

const csvToList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const emptyFilters = () => ({
  country: [],
  device: [],
  os: [],
  browser: [],
  timeRange: { from: null, to: null },
});

export const blankFunnel = () => ({
  name: '',
  type: 'single-landing',
  landers: [],
  offers: [{ offerId: '', weight: 100 }],
  filtersEnabled: false,
  filters: emptyFilters(),
  notes: '',
});

export const funnelToForm = (f) => ({
  ...blankFunnel(),
  ...f,
  landers: (f.landers || []).map((l) => ({ landerId: l.landerId || '', weight: l.weight ?? 100 })),
  offers: (f.offers || []).map((o) => ({ offerId: o.offerId || '', weight: o.weight ?? 100 })),
  filters: { ...emptyFilters(), ...(f.filters || {}) },
});

export default function FunnelModal({ value, landers, offers, onChange, onClose, onSave, saving, error }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setFilters = (patch) => set({ filters: { ...value.filters, ...patch } });

  const setRow = (key, i, patch) =>
    set({ [key]: value[key].map((r, x) => (x === i ? { ...r, ...patch } : r)) });

  const activeFilterCount = [
    value.filters.country.length,
    value.filters.device.length,
    value.filters.os.length,
    value.filters.browser.length,
    value.filters.timeRange?.from !== null && value.filters.timeRange?.from !== undefined ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const applyPreset = (id) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    set({ filters: { ...emptyFilters(), ...p.filters, timeRange: { ...emptyFilters().timeRange, ...(p.filters.timeRange || {}) } } });
  };

  return (
    <Modal
      wide
      title="Funnel"
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
        <div className="rt-card-head">{value._id ? 'Funnel' : 'New funnel'}</div>
        <div className="rt-card-body">
          <Field label="Title" required hint="Name it after the funnel shape you are reusing, e.g. “Quiz → sweeps, IN mobile”.">
            <input type="text" value={value.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>

          <Field label="Funnel template type" hint={FUNNEL_TYPES.find((t) => t.id === value.type)?.hint}>
            <select
              value={value.type}
              onChange={(e) => set({ type: e.target.value, landers: e.target.value === 'direct-offer' ? [] : value.landers })}
            >
              {FUNNEL_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="section-title" style={{ marginTop: 6 }}>
            Show filters for funnel
          </div>
          <Switch
            checked={value.filtersEnabled}
            onChange={(v) => set({ filtersEnabled: v })}
            label={
              value.filtersEnabled
                ? `Applying this template also adds a campaign rule (${activeFilterCount} condition${activeFilterCount === 1 ? '' : 's'})`
                : 'Off — the funnel is reached by weight only'
            }
          />

          {value.filtersEnabled && (
            <div style={{ marginTop: 16 }}>
              <div className="field-row">
                <Field label="Select a preset" hint="A shortcut that fills the fields below.">
                  <select value="" onChange={(e) => applyPreset(e.target.value)}>
                    <option value="">Select a preset</option>
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Countries (ISO-2, comma separated)">
                  <input
                    type="text"
                    value={value.filters.country.join(', ')}
                    placeholder="IN, US"
                    onChange={(e) => setFilters({ country: csvToList(e.target.value).map((c) => c.toUpperCase()) })}
                  />
                </Field>
              </div>

              <div className="field-row">
                <Field label="Devices">
                  <div style={{ display: 'flex', gap: 12, padding: '10px 2px' }}>
                    {DEVICES.map((d) => (
                      <label key={d} style={{ fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={value.filters.device.includes(d)}
                          onChange={(e) =>
                            setFilters({
                              device: e.target.checked
                                ? [...value.filters.device, d]
                                : value.filters.device.filter((x) => x !== d),
                            })
                          }
                        />
                        {d}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Operating systems">
                  <input
                    type="text"
                    value={value.filters.os.join(', ')}
                    placeholder="Android, iOS"
                    onChange={(e) => setFilters({ os: csvToList(e.target.value) })}
                  />
                </Field>
                <Field label="Browsers">
                  <input
                    type="text"
                    value={value.filters.browser.join(', ')}
                    placeholder="Chrome, Safari"
                    onChange={(e) => setFilters({ browser: csvToList(e.target.value) })}
                  />
                </Field>
              </div>

              <Field label="Hour window (report timezone)" hint="Leave blank for any hour. 22–5 wraps overnight.">
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', maxWidth: 240 }}>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    placeholder="from"
                    value={value.filters.timeRange?.from ?? ''}
                    onChange={(e) =>
                      setFilters({
                        timeRange: { ...value.filters.timeRange, from: e.target.value === '' ? null : Number(e.target.value) },
                      })
                    }
                  />
                  <span className="mute">–</span>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    placeholder="to"
                    value={value.filters.timeRange?.to ?? ''}
                    onChange={(e) =>
                      setFilters({
                        timeRange: { ...value.filters.timeRange, to: e.target.value === '' ? null : Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </Field>
            </div>
          )}
        </div>
      </div>

      {value.type === 'single-landing' && (
        <div className="rt-card">
          <div className="rt-card-head">
            Landings
            <div className="btn-group">
              <button
                type="button"
                className="btn sm green"
                onClick={() => set({ landers: [...value.landers, { landerId: '', weight: 100 }] })}
              >
                + Add
              </button>
              <a className="btn sm primary" href="/landers" target="_blank" rel="noreferrer">
                New lander
              </a>
            </div>
          </div>
          <div className="rt-card-body tight">
            {value.landers.length === 0 && (
              <div className="mute" style={{ fontSize: 13, marginBottom: 12 }}>
                No landing page yet — add at least one, or switch the type to “Direct to offer”.
              </div>
            )}
            {value.landers.map((l, i) => (
              <div className="offer-line" key={i}>
                <span className="idx">{i + 1}</span>
                <select value={l.landerId} onChange={(e) => setRow('landers', i, { landerId: e.target.value })}>
                  <option value="">Select a lander…</option>
                  {landers.map((x) => (
                    <option key={x._id} value={x._id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  title="Weight"
                  value={l.weight}
                  onChange={(e) => setRow('landers', i, { weight: Number(e.target.value) })}
                />
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={() => set({ landers: value.landers.filter((_, x) => x !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            {value.landers.length > 1 && (
              <div className="rt-hint" style={{ marginTop: 8, marginBottom: 14 }}>
                More than one landing page splits traffic between them by weight.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rt-card">
        <div className="rt-card-head">
          Offers
          <div className="btn-group">
            <button
              type="button"
              className="btn sm green"
              onClick={() => set({ offers: [...value.offers, { offerId: '', weight: 100 }] })}
            >
              + Add
            </button>
            <a className="btn sm primary" href="/offers" target="_blank" rel="noreferrer">
              New offer
            </a>
          </div>
        </div>
        <div className="rt-card-body tight">
          {value.offers.map((o, i) => (
            <div className="offer-line" key={i}>
              <span className="idx">{i + 1}</span>
              <select value={o.offerId} onChange={(e) => setRow('offers', i, { offerId: e.target.value })}>
                <option value="">Select an offer…</option>
                {offers.map((x) => (
                  <option key={x._id} value={x._id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                title="Weight"
                value={o.weight}
                onChange={(e) => setRow('offers', i, { weight: Number(e.target.value) })}
              />
              <button
                type="button"
                className="icon-btn danger"
                onClick={() => set({ offers: value.offers.filter((_, x) => x !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <div className="rt-hint" style={{ marginTop: 8, marginBottom: 14 }}>
            Per-offer filters are not available — conditions apply to the whole funnel, since a rule routes a visitor to
            a funnel rather than to one offer inside it.
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
