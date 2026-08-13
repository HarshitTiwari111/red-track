import { useMemo, useState } from 'react';

/**
 * Sortable table with a sticky header and an optional totals footer.
 * columns: [{ key, label, num?, width?, render?(row), sortValue?(row), noSort? }]
 */
export default function DataTable({
  columns,
  rows,
  totals = null,
  loading = false,
  empty = 'No data for this selection',
  defaultSort = null,
  rowKey = (r, i) => r._id || r.key || i,
  onRowClick = null,
  maxHeight,
}) {
  const [sort, setSort] = useState(defaultSort);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sortValue || ((r) => r[sort.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sort, columns]);

  const toggle = (col) => {
    if (col.noSort) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: col.num ? 'desc' : 'asc' };
      if (prev.dir === 'desc') return { key: col.key, dir: 'asc' };
      return null;
    });
  };

  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.num ? 'num' : ''} ${c.noSort ? 'no-sort' : ''}`}
                style={c.width ? { width: c.width } : undefined}
                onClick={() => toggle(c)}
                title={c.title || (c.noSort ? '' : 'Click to sort')}
              >
                {c.label}
                {sort?.key === c.key && <span className="sort-caret">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                <span className="spinner" /> Loading…
              </td>
            </tr>
          )}
          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {empty}
              </td>
            </tr>
          )}
          {!loading &&
            sorted.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>
                    {c.render ? c.render(row, i) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
        {totals && !loading && sorted.length > 0 && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {i === 0 ? 'Totals' : c.render && c.key in totals ? c.render(totals) : (totals[c.key] ?? '')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
