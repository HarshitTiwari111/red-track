import { useState } from 'react';

export default function CopyField({ value, label, readOnly = true, onChange }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value || '');
      } else {
        // Fallback for non-secure contexts (plain http on a LAN address)
        const ta = document.createElement('textarea');
        ta.value = value || '';
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <label className="field">
      {label && <span>{label}</span>}
      <div className="copyfield">
        <input
          type="text"
          value={value || ''}
          readOnly={readOnly}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn sm" onClick={copy} style={{ minWidth: 66 }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </label>
  );
}
