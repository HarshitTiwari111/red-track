import { createContext, useContext, useMemo, useState } from 'react';

const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toKey(d);
};

export const PRESETS = [
  { id: 'today', label: 'Today', range: () => ({ from: toKey(new Date()), to: toKey(new Date()) }) },
  { id: 'yesterday', label: 'Yesterday', range: () => ({ from: shift(1), to: shift(1) }) },
  { id: '7d', label: '7d', range: () => ({ from: shift(6), to: toKey(new Date()) }) },
  { id: '30d', label: '30d', range: () => ({ from: shift(29), to: toKey(new Date()) }) },
];

const DateRangeContext = createContext(null);

export function DateRangeProvider({ children }) {
  const [range, setRange] = useState(() => ({ ...PRESETS[0].range(), preset: 'today' }));

  const value = useMemo(
    () => ({
      range,
      setRange,
      applyPreset: (id) => {
        const p = PRESETS.find((x) => x.id === id);
        if (p) setRange({ ...p.range(), preset: id });
      },
      setFrom: (from) => setRange((r) => ({ ...r, from, preset: null })),
      setTo: (to) => setRange((r) => ({ ...r, to, preset: null })),
    }),
    [range]
  );

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export const useDateRange = () => {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error('useDateRange must be used inside DateRangeProvider');
  return ctx;
};

/** The shared control rendered in the topbar of every reporting page. */
export default function DateRangePicker() {
  const { range, applyPreset, setFrom, setTo } = useDateRange();

  return (
    <div className="daterange">
      <div className="preset-group">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={range.preset === p.id ? 'active' : ''}
            onClick={() => applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input type="date" value={range.from} max={range.to} onChange={(e) => setFrom(e.target.value)} />
      <span className="mute">→</span>
      <input type="date" value={range.to} min={range.from} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}
