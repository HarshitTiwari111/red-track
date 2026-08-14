import { useViewAs } from '../context/ViewAsContext.jsx';

const label = (u) => u.name || String(u.email || '').split('@')[0];

/**
 * Admin-only control that points the whole dashboard at one user's data.
 *
 * It is styled loudly while active on purpose: every number on every page
 * changes meaning, and an admin who forgets it is on will misread the tracker.
 */
export default function ViewAsPicker() {
  const { isAdmin, users, viewAs, setViewAs, target } = useViewAs();

  if (!isAdmin || users.length <= 1) return null;

  return (
    <div className={`viewas ${viewAs ? 'on' : ''}`}>
      <span className="viewas-label">{viewAs ? 'Viewing as' : 'View as'}</span>
      <select value={viewAs} onChange={(e) => setViewAs(e.target.value)} title="Show one user's data across every page">
        <option value="">All users</option>
        {users.map((u) => (
          <option key={u._id} value={u._id}>
            {label(u)}
            {u.role === 'admin' ? ' (admin)' : ''}
          </option>
        ))}
      </select>
      {viewAs && (
        <button type="button" className="viewas-clear" onClick={() => setViewAs('')} title="Back to all users">
          ×
        </button>
      )}
      {viewAs && !target && <span className="viewas-label">unknown user</span>}
    </div>
  );
}
