import { useState } from 'react';
import Modal from './Modal.jsx';
import Field, { Switch } from './Field.jsx';
import CopyField from './CopyField.jsx';

const DEVICES = ['desktop', 'mobile', 'tablet'];

/** Cost models the click engine actually computes. */
const COST_MODELS = [
  { id: 'cpc', label: 'CPC', hint: 'A fixed cost charged on every click.' },
  { id: 'cpm', label: 'CPM', hint: 'Cost per 1000 — divided by 1000 and charged per click.' },
  { id: 'fromToken', label: 'From token', hint: "Read from the traffic source's cost parameter on each click." },
  { id: 'manual', label: 'Do not track', hint: 'No automatic cost — push totals from the campaign page instead.' },
];

const LINK_TABS = [
  { id: 'redirect', label: 'Redirect' },
  { id: 'noredirect', label: 'No-redirect script' },
  { id: 'lander', label: 'Landing page view' },
  { id: 'pixel', label: 'Conversion pixel' },
];

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const csvToList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const emptyPath = () => ({ name: '', weight: 100, directLinking: true, landerId: '', landers: [], offers: [] });

export const blankCampaign = () => ({
  name: '',
  slug: '',
  trafficSourceId: '',
  domainId: '',
  costModel: 'cpc',
  costValue: 0,
  status: 'active',
  redirectType: '302',
  tags: [],
  paths: [emptyPath()],
  rules: [],
  postbackForwarding: [],
  clickForwarding: [],
  notes: '',
});

export const campaignToForm = (c) => ({
  ...blankCampaign(),
  ...c,
  trafficSourceId: c.trafficSourceId || '',
  domainId: c.domainId || '',
  redirectType: c.redirectType || '302',
  tags: c.tags || [],
  postbackForwarding: c.postbackForwarding || [],
  clickForwarding: c.clickForwarding || [],
  paths: (c.paths || []).map((p) => ({
    name: p.name || '',
    weight: p.weight ?? 100,
    directLinking: Boolean(p.directLinking),
    landerId: p.landerId || '',
    // Paths saved before lander rotation carry a single landerId
    landers: p.landers?.length
      ? p.landers.map((l) => ({ landerId: l.landerId || '', weight: l.weight ?? 100 }))
      : p.landerId
        ? [{ landerId: p.landerId, weight: 100 }]
        : [],
    offers: (p.offers || []).map((o) => ({ offerId: o.offerId || '', weight: o.weight ?? 100 })),
  })),
  rules: (c.rules || []).map((r) => ({
    name: r.name || '',
    pathIndex: r.pathIndex ?? 0,
    conditions: {
      country: r.conditions?.country || [],
      device: r.conditions?.device || [],
      os: r.conditions?.os || [],
      browser: r.conditions?.browser || [],
      timeRange: { from: r.conditions?.timeRange?.from ?? null, to: r.conditions?.timeRange?.to ?? null },
    },
  })),
});

export default function CampaignModal({
  value,
  sources,
  offers,
  landers,
  knownTags = [],
  templates = [],
  domains = [],
  onChange,
  onClose,
  onSave,
  saving,
  error,
}) {
  const [linkTab, setLinkTab] = useState('redirect');
  const [templateMenu, setTemplateMenu] = useState(false);
  const [openFilters, setOpenFilters] = useState({});
  const [slugTouched, setSlugTouched] = useState(Boolean(value.slug));
  const [tagDraft, setTagDraft] = useState('');

  const set = (patch) => onChange({ ...value, ...patch });
  const source = sources.find((s) => String(s._id) === String(value.trafficSourceId));

  /* Tracking links preview on the campaign's domain, then the default, then this host. */
  const defaultDomain = domains.find((d) => d.isDefault);
  const chosenDomain = domains.find((d) => String(d._id) === String(value.domainId)) || defaultDomain;
  const origin = chosenDomain
    ? `${chosenDomain.protocol}://${chosenDomain.host}`
    : window.location.origin;

  /* --------------------------------------------------------------- funnels */
  const setPath = (i, patch) => set({ paths: value.paths.map((p, x) => (x === i ? { ...p, ...patch } : p)) });

  const removePath = (i) => {
    const paths = value.paths.filter((_, x) => x !== i);
    const rules = value.rules
      .map((r) => (r.pathIndex === i ? null : r.pathIndex > i ? { ...r, pathIndex: r.pathIndex - 1 } : r))
      .filter(Boolean);
    set({ paths, rules });
  };

  const clonePath = (i) => {
    const copy = JSON.parse(JSON.stringify(value.paths[i]));
    copy.name = copy.name ? `${copy.name} (copy)` : '';
    set({ paths: [...value.paths, copy] });
  };

  /**
   * Copy a saved template in as a new funnel. It is a copy, not a link — editing
   * the template later must not silently change a live campaign.
   */
  const applyTemplate = (t) => {
    const direct = t.type === 'direct-offer';
    const newPath = {
      name: t.name,
      weight: 100,
      directLinking: direct,
      landerId: '',
      landers: direct ? [] : (t.landers || []).map((l) => ({ landerId: l.landerId, weight: l.weight ?? 100 })),
      offers: (t.offers || []).map((o) => ({ offerId: o.offerId, weight: o.weight ?? 100 })),
    };

    const paths = [...value.paths, newPath];
    const rules = [...value.rules];

    if (t.filtersEnabled) {
      rules.push({
        name: t.name,
        pathIndex: paths.length - 1,
        conditions: {
          country: t.filters?.country || [],
          device: t.filters?.device || [],
          os: t.filters?.os || [],
          browser: t.filters?.browser || [],
          timeRange: { from: t.filters?.timeRange?.from ?? null, to: t.filters?.timeRange?.to ?? null },
        },
      });
    }

    set({ paths, rules });
    setTemplateMenu(false);
  };

  /* Rules that target a funnel are that funnel's "filters". */
  const filtersFor = (i) => value.rules.filter((r) => r.pathIndex === i);

  const addFilter = (i) => {
    set({
      rules: [
        ...value.rules,
        {
          name: '',
          pathIndex: i,
          conditions: { country: [], device: [], os: [], browser: [], timeRange: { from: null, to: null } },
        },
      ],
    });
    setOpenFilters((o) => ({ ...o, [i]: true }));
  };

  const setRuleAt = (globalIndex, patch) =>
    set({ rules: value.rules.map((r, x) => (x === globalIndex ? { ...r, ...patch } : r)) });

  const setCondAt = (globalIndex, patch) => {
    const rule = value.rules[globalIndex];
    setRuleAt(globalIndex, { conditions: { ...rule.conditions, ...patch } });
  };

  /* ---------------------------------------------------------- forwarding */
  const setForward = (key, i, patch) =>
    set({ [key]: value[key].map((f, x) => (x === i ? { ...f, ...patch } : f)) });
  const addForward = (key) => set({ [key]: [...value[key], { name: '', url: '', enabled: true }] });
  const removeForward = (key, i) => set({ [key]: value[key].filter((_, x) => x !== i) });

  /* --------------------------------------------------------- tracking URL */
  const params = source?.paramTemplate?.trim()
    ? source.paramTemplate.trim()
    : Object.entries(source?.tokens || {})
        .map(([k, v]) => `${k}=${v}`)
        .join('&');

  const trackingUrl = () => {
    if (!value.slug) return 'Enter a name to generate the URL';
    switch (linkTab) {
      case 'redirect':
        return params ? `${origin}/c/${value.slug}?${params}` : `${origin}/c/${value.slug}`;
      case 'noredirect':
        return `<script src="${origin}/track.js" data-kcmp="${value.slug}"></script>`;
      case 'lander':
        return `${origin}/click?clickid={clickid}`;
      case 'pixel':
        return `${origin}/pixel.gif?clickid={clickid}&payout={payout}&type=lead`;
      default:
        return '';
    }
  };

  const addTag = (t) => {
    const tag = String(t || '').trim().slice(0, 40);
    if (!tag || value.tags.includes(tag)) return;
    set({ tags: [...value.tags, tag] });
  };

  const costHint = COST_MODELS.find((c) => c.id === value.costModel)?.hint;

  return (
    <Modal
      full
      title="Campaign"
      onClose={onClose}
      headerActions={
        <>
          <button
            type="button"
            className="btn"
            disabled={value.paths.length === 0}
            onClick={() => setOpenFilters(Object.fromEntries(value.paths.map((_, i) => [i, true])))}
            title="Expand every funnel's filters"
          >
            Rules
          </button>
          <button type="button" className="btn primary" onClick={onSave} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="modal-onetab">
        <span>Campaign details</span>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="campaign-grid">
        {/* ================================================== LEFT COLUMN */}
        <div>
          <div className="rt-card">
            <div className="rt-card-head">General</div>
            <div className="rt-card-body">
              <Field label="Name" required>
                <input
                  type="text"
                  value={value.name}
                  placeholder="Name"
                  onChange={(e) => {
                    const name = e.target.value;
                    set(slugTouched ? { name } : { name, slug: slugify(name) });
                  }}
                />
              </Field>

              <div className="field-row">
                <Field label="Traffic channel">
                  <select value={value.trafficSourceId} onChange={(e) => set({ trafficSourceId: e.target.value })}>
                    <option value="">None</option>
                    {sources.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Domain"
                  hint={
                    domains.length
                      ? 'The tracking domain this campaign’s click links are built on.'
                      : 'Add a tracking domain under Traffic domain to use one here.'
                  }
                >
                  <select value={value.domainId || ''} onChange={(e) => set({ domainId: e.target.value })}>
                    <option value="">
                      {defaultDomain ? `Default (${defaultDomain.host})` : origin.replace(/^https?:\/\//, '')}
                    </option>
                    {domains.map((d) => (
                      <option key={d._id} value={d._id}>
                        {d.host}
                        {d.isDefault ? ' — default' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Slug (used in the click URL)" required hint={`/c/${value.slug || '…'}`}>
                <input
                  type="text"
                  className="mono"
                  value={value.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set({ slug: slugify(e.target.value) });
                  }}
                />
              </Field>

              <div className="section-title">Campaign cost</div>
              <div className="segmented">
                {COST_MODELS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={value.costModel === c.id ? 'active' : ''}
                    onClick={() => set({ costModel: c.id })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <Field label="Value" required={value.costModel === 'cpc' || value.costModel === 'cpm'} suffix="$" hint={costHint}>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={value.costValue}
                  disabled={value.costModel === 'manual' || value.costModel === 'fromToken'}
                  onChange={(e) => set({ costValue: Number(e.target.value) })}
                />
              </Field>

              <Field label="Status">
                <select value={value.status} onChange={(e) => set({ status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </Field>
            </div>
          </div>

          <div className="rt-card">
            <div className="rt-card-head">Tracking links and parameters</div>
            <div className="rt-card-body">
              <div className="segmented">
                {LINK_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={linkTab === t.id ? 'active' : ''}
                    onClick={() => setLinkTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <CopyField label={linkTab === 'noredirect' ? 'Script tag' : 'Click URL'} value={trackingUrl()} />
              <div className="rt-hint" style={{ marginBottom: 14 }}>
                {linkTab === 'redirect' && "Paste this into the ad platform. The traffic source's parameters are pre-filled."}
                {linkTab === 'noredirect' && 'Put this on your landing page — the visitor never leaves the real URL.'}
                {linkTab === 'lander' && "Link your lander's call-to-action here to record the LP click."}
                {linkTab === 'pixel' && 'Fallback conversion pixel for networks that cannot send a postback.'}
              </div>
            </div>
          </div>

          <div className="rt-card">
            <div className="rt-card-head">Tracking options</div>
            <div className="rt-card-body">
              <Field label="Redirect type">
                <select value={value.redirectType} onChange={(e) => set({ redirectType: e.target.value })}>
                  <option value="302">Regular redirect (HTTP 302)</option>
                  <option value="meta">Meta refresh (hides the referrer)</option>
                </select>
              </Field>
            </div>
          </div>

          <div className="rt-card">
            <div className="rt-card-head">Tags and notes</div>
            <div className="rt-card-body tight">
              <div className="form-note" style={{ marginBottom: 8 }}>Tags selected:</div>
              {value.tags.length === 0 ? (
                <div className="mute" style={{ fontSize: 13 }}>No tags yet.</div>
              ) : (
                <div className="chips">
                  {value.tags.map((t) => (
                    <span className="chip" key={t}>
                      {t}
                      <button type="button" onClick={() => set({ tags: value.tags.filter((x) => x !== t) })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
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
                  style={{ maxWidth: 220 }}
                />
                <button type="button" className="btn sm" onClick={() => { addTag(tagDraft); setTagDraft(''); }}>
                  Add
                </button>
              </div>

              {knownTags.filter((t) => !value.tags.includes(t)).length > 0 && (
                <>
                  <div className="form-note" style={{ marginBottom: 6 }}>Already used tags:</div>
                  <div className="chips" style={{ marginBottom: 14 }}>
                    {knownTags
                      .filter((t) => !value.tags.includes(t))
                      .map((t) => (
                        <button type="button" className="chip pick" key={t} onClick={() => addTag(t)}>
                          + {t}
                        </button>
                      ))}
                  </div>
                </>
              )}

              <Field label="Notes">
                <textarea value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>
          </div>

          <ForwardCard
            title="S2S postback for traffic source"
            note="Fired server-side whenever a conversion is recorded, so the ad platform can optimise on it. Supports every macro, e.g. {gclid} or {sub1}."
            list={value.postbackForwarding}
            onAdd={() => addForward('postbackForwarding')}
            onChange={(i, patch) => setForward('postbackForwarding', i, patch)}
            onRemove={(i) => removeForward('postbackForwarding', i)}
            placeholder="https://source.com/postback?clickid={sub1}&payout={payout}&status={status}"
          />

        </div>

        {/* ================================================= RIGHT COLUMN */}
        <div>
          <div className="rt-card">
            <div className="rt-card-head">
              Funnels
              <span className="mute" style={{ fontSize: 12, fontWeight: 400 }}>
                picked by weight unless a filter matches
              </span>
            </div>
            <div className="rt-card-body tight">
              {value.paths.length === 0 && (
                <div className="alert info">Add at least one funnel so the campaign has somewhere to send traffic.</div>
              )}

              {value.paths.map((path, i) => {
                const totalWeight = value.paths.reduce((a, p) => a + (Number(p.weight) || 0), 0);
                const share = totalWeight ? Math.round(((Number(path.weight) || 0) / totalWeight) * 100) : 0;
                const myFilters = filtersFor(i);

                return (
                  <div className="funnel-card" key={i}>
                    <div className="funnel-head">
                      <span className="funnel-title">funnel #{i + 1}</span>
                      <input
                        type="text"
                        value={path.name}
                        placeholder="Funnel label"
                        onChange={(e) => setPath(i, { name: e.target.value })}
                      />
                      <button type="button" className="btn sm primary" onClick={() => clonePath(i)}>
                        Clone funnel
                      </button>
                      <Field label={`Weight — ${share}%`} className="weight-field">
                        <input
                          type="number"
                          min="0"
                          value={path.weight}
                          onChange={(e) => setPath(i, { weight: Number(e.target.value) })}
                        />
                      </Field>
                      <button type="button" className="icon-btn danger" onClick={() => removePath(i)} title="Remove funnel">
                        ×
                      </button>
                    </div>

                    <div className="funnel-body">
                      <div className="segmented">
                        <button
                          type="button"
                          className={path.directLinking ? 'active' : ''}
                          onClick={() => setPath(i, { directLinking: true, landerId: '' })}
                        >
                          Offer
                        </button>
                        <button
                          type="button"
                          className={!path.directLinking ? 'active' : ''}
                          onClick={() => setPath(i, { directLinking: false })}
                        >
                          Landing &gt; Offer
                        </button>
                      </div>

                      {!path.directLinking && (
                        <div className="funnel-sub">
                          <h4>Landings</h4>
                          {path.landers.map((l, li) => (
                            <div className="offer-line" key={li}>
                              <span className="idx">{li + 1}</span>
                              <select
                                value={l.landerId}
                                onChange={(e) =>
                                  setPath(i, {
                                    landers: path.landers.map((x, xi) =>
                                      xi === li ? { ...x, landerId: e.target.value } : x
                                    ),
                                  })
                                }
                              >
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
                                onChange={(e) =>
                                  setPath(i, {
                                    landers: path.landers.map((x, xi) =>
                                      xi === li ? { ...x, weight: Number(e.target.value) } : x
                                    ),
                                  })
                                }
                              />
                              <button
                                type="button"
                                className="icon-btn danger"
                                onClick={() => setPath(i, { landers: path.landers.filter((_, xi) => xi !== li) })}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn sm green"
                            style={{ marginTop: 6 }}
                            onClick={() => setPath(i, { landers: [...path.landers, { landerId: '', weight: 100 }] })}
                          >
                            + Add
                          </button>
                          {path.landers.length > 1 && (
                            <div className="rt-hint" style={{ marginTop: 8 }}>
                              Traffic is split between these landing pages by weight.
                            </div>
                          )}
                        </div>
                      )}

                      <div className="funnel-sub">
                        <h4>Offers</h4>
                        {path.offers.map((o, oi) => (
                          <div className="offer-line" key={oi}>
                            <span className="idx">{oi + 1}</span>
                            <select
                              value={o.offerId}
                              onChange={(e) =>
                                setPath(i, {
                                  offers: path.offers.map((x, xi) =>
                                    xi === oi ? { ...x, offerId: e.target.value } : x
                                  ),
                                })
                              }
                            >
                              <option value="">Select offer…</option>
                              {offers.map((of) => (
                                <option key={of._id} value={of._id}>
                                  {of.name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0"
                              value={o.weight}
                              title="Weight"
                              onChange={(e) =>
                                setPath(i, {
                                  offers: path.offers.map((x, xi) =>
                                    xi === oi ? { ...x, weight: Number(e.target.value) } : x
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => setPath(i, { offers: path.offers.filter((_, xi) => xi !== oi) })}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <div className="btn-group" style={{ marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn sm green"
                            onClick={() => setPath(i, { offers: [...path.offers, { offerId: '', weight: 100 }] })}
                          >
                            + Add
                          </button>
                        </div>
                      </div>

                      <button type="button" className="filters-btn" onClick={() => setOpenFilters((o) => ({ ...o, [i]: !o[i] }))}>
                        Filters({myFilters.length}) {openFilters[i] ? '⌃' : '⌄'}
                      </button>

                      {openFilters[i] && (
                        <div style={{ marginTop: 12 }}>
                          <div className="rt-hint" style={{ marginBottom: 10 }}>
                            A visitor matching a filter is sent to this funnel regardless of weights. Empty means
                            &quot;any&quot;. Filters are evaluated top to bottom across all funnels; the first match wins.
                          </div>

                          {myFilters.length === 0 && (
                            <div className="mute" style={{ fontSize: 13, marginBottom: 10 }}>
                              No filters — this funnel is reached by weight only.
                            </div>
                          )}

                          {value.rules.map((rule, gi) => {
                            if (rule.pathIndex !== i) return null;
                            return (
                              <div className="rule-card" key={gi}>
                                <div className="path-head">
                                  <span className="path-title">Filter</span>
                                  <button
                                    type="button"
                                    className="btn sm danger"
                                    onClick={() => set({ rules: value.rules.filter((_, x) => x !== gi) })}
                                  >
                                    Remove
                                  </button>
                                </div>
                                <div className="field-row">
                                  <Field label="Countries (ISO-2, comma separated)">
                                    <input
                                      type="text"
                                      value={rule.conditions.country.join(', ')}
                                      placeholder="IN, US"
                                      onChange={(e) =>
                                        setCondAt(gi, { country: csvToList(e.target.value).map((c) => c.toUpperCase()) })
                                      }
                                    />
                                  </Field>
                                  <Field label="Devices">
                                    <div style={{ display: 'flex', gap: 12, padding: '10px 2px' }}>
                                      {DEVICES.map((d) => (
                                        <label key={d} style={{ fontSize: 13 }}>
                                          <input
                                            type="checkbox"
                                            checked={rule.conditions.device.includes(d)}
                                            onChange={(e) =>
                                              setCondAt(gi, {
                                                device: e.target.checked
                                                  ? [...rule.conditions.device, d]
                                                  : rule.conditions.device.filter((x) => x !== d),
                                              })
                                            }
                                          />
                                          {d}
                                        </label>
                                      ))}
                                    </div>
                                  </Field>
                                </div>
                                <div className="field-row">
                                  <Field label="Operating systems">
                                    <input
                                      type="text"
                                      value={rule.conditions.os.join(', ')}
                                      placeholder="Android, iOS"
                                      onChange={(e) => setCondAt(gi, { os: csvToList(e.target.value) })}
                                    />
                                  </Field>
                                  <Field label="Browsers">
                                    <input
                                      type="text"
                                      value={rule.conditions.browser.join(', ')}
                                      placeholder="Chrome, Safari"
                                      onChange={(e) => setCondAt(gi, { browser: csvToList(e.target.value) })}
                                    />
                                  </Field>
                                  <Field label="Hour window" hint="Report timezone. 22–5 wraps overnight.">
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                      <input
                                        type="number"
                                        min="0"
                                        max="23"
                                        placeholder="from"
                                        value={rule.conditions.timeRange?.from ?? ''}
                                        onChange={(e) =>
                                          setCondAt(gi, {
                                            timeRange: {
                                              ...rule.conditions.timeRange,
                                              from: e.target.value === '' ? null : Number(e.target.value),
                                            },
                                          })
                                        }
                                      />
                                      <span className="mute">–</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="23"
                                        placeholder="to"
                                        value={rule.conditions.timeRange?.to ?? ''}
                                        onChange={(e) =>
                                          setCondAt(gi, {
                                            timeRange: {
                                              ...rule.conditions.timeRange,
                                              to: e.target.value === '' ? null : Number(e.target.value),
                                            },
                                          })
                                        }
                                      />
                                    </div>
                                  </Field>
                                </div>
                              </div>
                            );
                          })}

                          <button type="button" className="btn sm" onClick={() => addFilter(i)}>
                            + Add filter
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="btn-group">
                <button type="button" className="btn primary" onClick={() => set({ paths: [...value.paths, emptyPath()] })}>
                  + Add funnel
                </button>
                <div className="popover-wrap">
                  <button
                    type="button"
                    className="btn"
                    disabled={templates.length === 0}
                    onClick={() => setTemplateMenu((s) => !s)}
                    title={templates.length ? 'Copy a saved funnel template in' : 'No funnel templates saved yet'}
                  >
                    Apply template ⌄
                  </button>
                  {templateMenu && (
                    <div className="popover" style={{ minWidth: 230 }}>
                      {templates.map((t) => (
                        <label key={t._id} onClick={() => applyTemplate(t)}>
                          {t.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="rt-hint" style={{ margin: '10px 0 14px' }}>
                Automatic traffic optimisation (&quot;smart distribution&quot;) is not implemented — weights and filters
                decide the split.
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ForwardCard({ title, note, list, onAdd, onChange, onRemove, placeholder }) {
  return (
    <div className="rt-card">
      <div className="rt-card-head">{title}</div>
      <div className="rt-card-body tight">
        <div className="rt-hint" style={{ marginBottom: 12 }}>{note}</div>

        {list.map((f, i) => (
          <div key={i} style={{ borderTop: i ? '1px solid var(--border-soft)' : 'none', paddingTop: i ? 12 : 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Field label="Label" className="" >
                <input
                  type="text"
                  value={f.name}
                  placeholder="Google Ads"
                  onChange={(e) => onChange(i, { name: e.target.value })}
                />
              </Field>
              <button type="button" className="icon-btn danger" style={{ marginTop: 6 }} onClick={() => onRemove(i)}>
                ×
              </button>
            </div>
            <Field label="URL">
              <input
                type="text"
                className="mono"
                value={f.url}
                placeholder={placeholder}
                onChange={(e) => onChange(i, { url: e.target.value })}
              />
            </Field>
            <div style={{ marginBottom: 14 }}>
              <Switch checked={f.enabled} onChange={(v) => onChange(i, { enabled: v })} label="Enabled" />
            </div>
          </div>
        ))}

        <button type="button" className="btn primary sm" style={{ marginBottom: 14 }} onClick={onAdd}>
          + Add
        </button>
      </div>
    </div>
  );
}
