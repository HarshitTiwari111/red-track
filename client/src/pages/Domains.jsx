import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import useConfirm from '../components/ConfirmModal.jsx';
import CopyField from '../components/CopyField.jsx';
import DomainModal, { blankDomain, domainToForm } from '../components/DomainModal.jsx';
import { api, errMsg } from '../api/client.js';

const STORAGE = 'kap.domains.table';
const DENSITIES = ['compact', 'standard', 'comfortable'];
const dt = (v) => (v ? new Date(v).toLocaleString() : '—');
/** Table variant: seconds cost a column's worth of width and tell the operator nothing. */
const dtShort = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';

/** Certificates inside 21 days are worth flagging before they lapse. */
function sslCell(row) {
  if (row.protocol !== 'https') return <span className="mute">n/a (http)</span>;

  // A pasted certificate is a fact about this install; the live probe only says
  // what the host answered with, which can fail for reasons unrelated to the cert
  if (row.sslMode === 'manual' && row.certExpiresAt) {
    const days = Math.round((new Date(row.certExpiresAt) - Date.now()) / 86400000);
    return (
      <span
        className={`badge ${days < 0 ? 'rejected' : days < 21 ? 'pending' : 'approved'}`}
        title={`Uploaded certificate — ${row.certIssuer || 'unknown issuer'}, expires ${dt(row.certExpiresAt)}`}
      >
        {days < 0 ? `expired ${-days}d ago` : `${days}d left`} · own
      </span>
    );
  }

  if (row.sslError) {
    // Kept short on purpose - the full message is in the tooltip, and a long one
    // here pushes every other column off the right edge of the table
    return (
      <span className="badge rejected" title={row.sslError}>
        {row.sslError.length > 12 ? `${row.sslError.slice(0, 12)}…` : row.sslError}
      </span>
    );
  }
  if (!row.sslExpiresAt) return <span className="mute">not checked</span>;

  const days = Math.round((new Date(row.sslExpiresAt) - Date.now()) / 86400000);
  const tone = days < 0 ? 'rejected' : days < 21 ? 'pending' : 'approved';
  return (
    <span className={`badge ${tone}`} title={`${row.sslIssuer || 'unknown issuer'} — checked ${dt(row.sslCheckedAt)}`}>
      {days < 0 ? `expired ${-days}d ago` : `${days}d left`}
    </span>
  );
}

/** DNS proof, or why it is not there yet. Pending is the expected first state. */
function dnsCell(row) {
  if (row.dnsVerifiedAt) {
    return (
      <span
        className="badge approved"
        title={`Matched by ${row.dnsMethod === 'a' ? 'A record' : 'CNAME'} on ${dt(row.dnsVerifiedAt)}${
          row.dnsFound?.length ? ` → ${row.dnsFound.join(', ')}` : ''
        }`}
      >
        verified
      </span>
    );
  }
  if (!row.dnsCheckedAt) return <span className="mute">not checked</span>;
  return (
    <span className="badge pending" title={row.dnsError || 'not verified'}>
      not found ({row.dnsAttempts || 1})
    </span>
  );
}

export default function Domains() {
  const [confirm, confirmUI] = useConfirm();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ defaultBaseUrl: '', defaultHost: '', targetCname: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [checking, setChecking] = useState('');
  const [verifying, setVerifying] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);

  const [prefs, setPrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE) || '{}').density
        ? JSON.parse(localStorage.getItem(STORAGE))
        : { density: 'standard' };
    } catch {
      return { density: 'standard' };
    }
  });
  const savePrefs = (next) => {
    setPrefs(next);
    localStorage.setItem(STORAGE, JSON.stringify(next));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/domains');
      setRows(data.items);
      setMeta({
        defaultBaseUrl: data.defaultBaseUrl,
        defaultHost: data.defaultHost,
        targetCname: data.targetCname,
      });
      setSelected(new Set());
    } catch (err) {
      setError(errMsg(err, 'Could not load domains'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selectedIds = [...selected];
  const one = selectedIds.length === 1 ? rows.find((r) => String(r._id) === selectedIds[0]) : null;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(String(r._id)));

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (editing._id) await api.put(`/domains/${editing._id}`, editing);
      else await api.post('/domains', editing);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save the domain'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const n = selectedIds.length;
    const ok = await confirm({
      title: `Delete ${n} domain${n === 1 ? '' : 's'}?`,
      message: 'This cannot be undone.',
      note: 'Tracking links already using them stop working straight away.',
    });
    if (!ok) return;
    try {
      await Promise.all(selectedIds.map((id) => api.delete(`/domains/${id}`)));
      setNotice(`${selectedIds.length} domain(s) deleted.`);
      setTimeout(() => setNotice(''), 3000);
      load();
    } catch (err) {
      handleRowError(err, 'Could not delete');
    }
  };

  /**
   * A row action on a domain that has since been deleted answers 404, and a bare
   * "Not found" reads like the DNS lookup failed rather than the row being stale.
   * Say what actually happened and pull a fresh list.
   */
  const handleRowError = (err, fallback) => {
    if (err?.response?.status === 404) {
      setError('That domain no longer exists — the list has been refreshed.');
      load();
      return true;
    }
    setError(errMsg(err, fallback));
    return false;
  };

  /**
   * A failed verify is the normal first outcome while DNS propagates, so it is
   * surfaced as a notice rather than a page-level error.
   */
  const verify = async (row) => {
    setVerifying(String(row._id));
    setError('');
    try {
      const { data } = await api.post(`/domains/${row._id}/verify`);
      setRows((prev) => prev.map((r) => (r._id === row._id ? { ...r, ...data } : r)));
      setNotice(`${row.host}: ${data.message}`);
      setTimeout(() => setNotice(''), 8000);
    } catch (err) {
      handleRowError(err, 'Could not check DNS');
    } finally {
      setVerifying('');
    }
  };

  const checkSsl = async (row) => {
    setChecking(String(row._id));
    setError('');
    try {
      const { data } = await api.post(`/domains/${row._id}/check-ssl`);
      setRows((prev) => prev.map((r) => (r._id === row._id ? { ...r, ...data } : r)));
      setNotice(
        data.sslError ? `${row.host}: ${data.sslError}` : `${row.host}: certificate valid until ${dt(data.sslExpiresAt)}`
      );
      setTimeout(() => setNotice(''), 6000);
    } catch (err) {
      handleRowError(err, 'Could not read the certificate');
    } finally {
      setChecking('');
    }
  };

  const sorted = useMemo(
    () => [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.host.localeCompare(b.host)),
    [rows]
  );

  return (
    <Page
      title="Domains"
      actions={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormError('');
            setEditing(blankDomain());
          }}
        >
          + Create new domain
        </button>
      }
    >
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="page-note">
        Add the domain here first, then point a CNAME at{' '}
        <span className="mono">{meta.targetCname || meta.defaultHost || '…'}</span> at your registrar. It stays{' '}
        <strong>pending</strong> until that record is visible — Verify re-checks on demand, and a background job
        retries every 10 minutes. Default base URL for this install:{' '}
        <span className="mono">{meta.defaultBaseUrl || '…'}</span>.{' '}
        <button type="button" className="link-btn" onClick={() => setShowHelp((s) => !s)}>
          {showHelp ? 'Hide setup notes' : 'Setup notes'}
        </button>
      </div>

      {showHelp && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
            <strong>DNS</strong> — create <span className="mono">track.example.com</span> as a CNAME to{' '}
            <span className="mono">{meta.defaultHost || 'this server'}</span>, or an A record to its IP. Use a
            third-level domain; a root domain cannot be CNAMEd without breaking the rest of the zone.
            <br />
            <strong>TLS</strong> — issue the certificate in nginx (certbot) or let Cloudflare terminate it. KAP Tracker
            never stores certificates or private keys. With Cloudflare use SSL mode <strong>Full</strong>; Flexible
            breaks the dashboard&apos;s secure cookies.
            <br />
            <strong>Behaviour</strong> — a registered domain serves the tracking endpoints only. Every other path on it
            answers with the root redirect below, or 404 when that is blank.
          </div>
        </div>
      )}

      <div className="action-bar" ref={menuRef}>
        <button
          type="button"
          className="action-btn"
          disabled={!one}
          onClick={() => {
            setFormError('');
            setEditing(domainToForm(one));
          }}
        >
          <span className="ico">✎</span> Edit
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={!one || verifying === String(one?._id)}
          onClick={() => verify(one)}
        >
          <span className="ico">🌐</span> {verifying ? 'Checking DNS…' : 'Verify DNS'}
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={!one || checking === String(one?._id)}
          onClick={() => checkSsl(one)}
        >
          <span className="ico">🔒</span> {checking ? 'Checking…' : 'Check SSL'}
        </button>
        <button type="button" className="action-btn" disabled={selectedIds.length === 0} onClick={remove}>
          <span className="ico">🗑</span> Delete
        </button>

        <span className="mute" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {selectedIds.length ? `${selectedIds.length} selected` : `${rows.length} domains`}
        </span>
      </div>

      <div className="panel">
        <div className="table-tools">
          <div className="popover-wrap">
            <button type="button" className="tool-btn" onClick={() => setMenu(menu === 'density' ? null : 'density')}>
              ☰ Density
            </button>
            {menu === 'density' && (
              <div className="popover" style={{ minWidth: 150 }}>
                {DENSITIES.map((d) => (
                  <label key={d} onClick={() => savePrefs({ ...prefs, density: d })}>
                    <input type="radio" readOnly checked={prefs.density === d} style={{ width: 'auto' }} />
                    {d}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="tool-btn" onClick={() => savePrefs({ density: 'standard' })}>
            ↺ Table reset
          </button>
        </div>

        <div className="table-wrap">
          <table className={`data density-${prefs.density}`}>
            <thead>
              <tr>
                <th className="check no-sort">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => String(r._id))) : new Set())
                    }
                  />
                </th>
                <th className="no-sort num" style={{ width: 54 }}>
                  #
                </th>
                <th className="no-sort" style={{ width: 108 }}>
                  Actions
                </th>
                <th className="no-sort" style={{ width: 90 }}>
                  ID
                </th>
                <th className="no-sort">URL</th>
                <th className="no-sort" style={{ width: 128 }}>
                  Date created
                </th>
                <th className="no-sort" style={{ width: 110 }}>
                  DNS
                </th>
                <th className="no-sort" style={{ width: 120 }}>
                  SSL expiry
                </th>
                <th className="no-sort">Root redirect</th>
                <th className="no-sort" style={{ width: 92 }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="table-empty">
                    <span className="spinner" /> Loading…
                  </td>
                </tr>
              )}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="table-empty">
                    No tracking domains yet — links fall back to {meta.defaultBaseUrl}
                  </td>
                </tr>
              )}
              {!loading &&
                sorted.map((r, i) => {
                  const id = String(r._id);
                  return (
                    <tr
                      key={id}
                      className={selected.has(id) ? 'row-selected' : ''}
                      onDoubleClick={() => {
                        setFormError('');
                        setEditing(domainToForm(r));
                      }}
                    >
                      <td className="check">
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                      <td className="num">{i + 1}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            title="Edit domain"
                            aria-label="Edit domain"
                            onClick={() => {
                              setFormError('');
                              setEditing(domainToForm(r));
                            }}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Verify DNS"
                            aria-label="Verify DNS"
                            disabled={verifying === id}
                            onClick={() => verify(r)}
                          >
                            {verifying === id ? <span className="spinner" /> : '🌐'}
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Check SSL certificate"
                            aria-label="Check SSL certificate"
                            disabled={checking === id}
                            onClick={() => checkSsl(r)}
                          >
                            {checking === id ? <span className="spinner" /> : '🔒'}
                          </button>
                        </div>
                      </td>
                      <td className="mono">{id.slice(-8)}</td>
                      <td>
                        <button
                          type="button"
                          className="cell-link mono"
                          onClick={() => {
                            setFormError('');
                            setEditing(domainToForm(r));
                          }}
                        >
                          {r.url}
                        </button>
                        {r.isDefault && (
                          <span className="badge approved" style={{ marginLeft: 8 }}>
                            default
                          </span>
                        )}
                      </td>
                      <td className="nowrap">{dtShort(r.createdAt)}</td>
                      <td>{dnsCell(r)}</td>
                      <td>{sslCell(r)}</td>
                      <td>
                        {r.rootRedirectUrl ? (
                          <span className="mono truncate" style={{ maxWidth: 140 }} title={r.rootRedirectUrl}>
                            {r.rootRedirectUrl}
                          </span>
                        ) : (
                          <span className="mute">404</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${r.status}`}>{r.status}</span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <h3>Example click URL</h3>
          </div>
          <div className="panel-body">
            <CopyField
              label={`On ${sorted[0].host}`}
              value={`${sorted[0].url}/c/your-campaign-slug`}
            />
            <div className="rt-hint">
              Tracking endpoints answer on any host that reaches this server. Anything else on a registered tracking
              domain returns its root redirect (or 404) instead of the dashboard.
            </div>
          </div>
        </div>
      )}

      {editing && (
        <DomainModal
          value={editing}
          defaultHost={meta.defaultHost}
          targetCname={meta.targetCname}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          error={formError}
        />
      )}
      {confirmUI}
    </Page>
  );
}
