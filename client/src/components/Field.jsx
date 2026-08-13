/**
 * Outlined field with a floating label, used by the filter bar and the modals.
 * `onAlt` matches the label background to a --bg-alt surface.
 */
export default function Field({ label, required, hint, suffix, onAlt, className = '', children }) {
  return (
    <div
      className={`rt-field ${required ? 'req' : ''} ${onAlt ? 'on-alt' : ''} ${
        suffix ? 'has-suffix' : ''
      } ${className}`}
    >
      {label && <span className="rt-label">{label}</span>}
      {children}
      {suffix && <span className="suffix">{suffix}</span>}
      {hint && <div className="rt-hint">{hint}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label}
    </label>
  );
}

/** Editable list of short strings rendered as removable chips. */
export function ChipList({ values = [], onRemove, empty = 'None' }) {
  if (!values.length) return <span className="mute" style={{ fontSize: 13 }}>{empty}</span>;
  return (
    <div className="chips">
      {values.map((v) => (
        <span className="chip" key={v}>
          {v}
          {onRemove && (
            <button type="button" onClick={() => onRemove(v)} aria-label={`Remove ${v}`}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
