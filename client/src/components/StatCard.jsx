export default function StatCard({ label, value, sub, tone }) {
  return (
    <div className="statcard">
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
      {sub !== undefined && sub !== null && <div className="sub">{sub}</div>}
    </div>
  );
}

export const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
export const fmtMoney = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (n) => `${Number(n || 0).toFixed(2)}%`;
export const toneOf = (n) => (Number(n) > 0 ? 'pos' : Number(n) < 0 ? 'neg' : '');
