import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { LuPencil, LuTrash2 } from 'react-icons/lu';
import { Page } from '../components/Layout.jsx';
import useConfirm from '../components/ConfirmModal.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import MetaPixelModal, { blankMetaPixel, metaPixelToForm } from '../components/MetaPixelModal.jsx';
import { api, errMsg } from '../api/client.js';

const dt = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/**
 * What Meta needs before it will report a score. Kept in the same order as the
 * steps an operator takes, because the panel doubles as the instructions.
 */
const emqMissing = (p) => {
  const out = [];
  if (!p?.dataQualityToken && !p?.hasDataQualityToken) out.push('Set the Data Quality API token');
  if (!p?.customConversionMatching) out.push('Switch on Custom Conversion Matching');
  if (!(p?.conversionMatching || []).some((m) => m.conversionType && m.eventName)) {
    out.push('Choose a conversion type and event name');
  }
  return out;
};
const emqReady = (p) => emqMissing(p).length === 0;

/** Size of the hint panel, needed to place it before it is drawn. */
const TIP_W = 268;
const TIP_H = 150;

export default function CapiIntegrations() {
  const [confirm, confirmUI] = useConfirm();
  const navigate = useNavigate();
  const [emqFor, setEmqFor] = useState(null);
  const [tip, setTip] = useState(null);

  /*
   * The hint is drawn on the body rather than inside the cell: the table scrolls
   * its own overflow, which would clip a panel hanging below the last rows.
   * Fixed coordinates come off the link, and it flips above when the space under
   * it is too short.
   */
  const showTip = (el) => {
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setTip({
      left: Math.max(8, Math.min(r.right - TIP_W, window.innerWidth - TIP_W - 8)),
      ...(below < TIP_H ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 }),
    });
  };
  const [draft, setDraft] = useState({ title: '', pixelId: '' });
  const [filters, setFilters] = useState(draft);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/meta-pixels');
      setRows(data.items || []);
    } catch (err) {
      setError(errMsg(err, 'Could not load pixels'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Both filters are plain substring matches, so there is nothing to ask the
  // server for - the whole list is already here.
  const visible = rows.filter(
    (r) =>
      (!filters.title || r.title.toLowerCase().includes(filters.title.toLowerCase())) &&
      (!filters.pixelId || String(r.pixelId).includes(filters.pixelId))
  );

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (editing._id) await api.put(`/meta-pixels/${editing._id}`, editing);
      else await api.post('/meta-pixels', editing);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMsg(err, 'Could not save the pixel'));
    } finally {
      setSaving(false);
    }
  };

  const loadEmq = async (row) => {
    setEmqFor({ row, loading: true });
    try {
      const { data } = await api.get(`/meta-pixels/${row._id}/emq`);
      setEmqFor({ row, ...data });
    } catch (err) {
      setEmqFor({ row, error: errMsg(err, 'Could not read the score from Meta') });
    }
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: 'Confirm delete',
      message: `Are you sure you want to delete ${row.title}?`,
      note: 'This cannot be undone. Any traffic channel or offer sending to this pixel stops sending.',
    });
    if (!ok) return;
    try {
      await api.delete(`/meta-pixels/${row._id}`);
      setNotice(`Removed ${row.title}.`);
      setTimeout(() => setNotice(''), 3000);
      load();
    } catch (err) {
      setError(errMsg(err, 'Could not remove the pixel'));
    }
  };

  return (
    <Page
      title="Meta Pixels"
      actions={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setFormError('');
            setEditing(blankMetaPixel());
          }}
        >
          + Add new pixel
        </button>
      }
    >
      <div className="breadcrumb">
        CAPI Integrations <span>›</span> Meta Pixels
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="filter-bar">
        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title"
          />
        </Field>
        <Field label="Pixel ID">
          <input
            type="text"
            className="mono"
            value={draft.pixelId}
            onChange={(e) => setDraft({ ...draft, pixelId: e.target.value })}
            placeholder="Pixel ID"
          />
        </Field>
        <div className="filter-actions">
          <button type="button" className="btn primary" onClick={() => setFilters(draft)} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Apply'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft({ title: '', pixelId: '' });
              setFilters({ title: '', pixelId: '' });
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data density-standard">
          <thead>
            <tr>
              <th>Title</th>
              <th>Date connected</th>
              <th>Pixel ID</th>
              {/* How many events reached this pixel belongs with the rest of
                  its history, on the details page, not as a column here. */}
              <th>View details</th>
              <th>EMQ score</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="table-empty">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  No pixels yet — add one to start sending conversions to Meta.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((r) => (
                <tr key={r._id}>
                  <td>
                    <button
                      type="button"
                      className="cell-link"
                      onClick={() => {
                        setFormError('');
                        setEditing(metaPixelToForm(r));
                      }}
                    >
                      {r.title}
                    </button>
                  </td>
                  <td className="nowrap">{dt(r.createdAt)}</td>
                  <td className="mono">{r.pixelId}</td>
                  <td>
                    <button type="button" className="cell-link" onClick={() => navigate(`/capi/${r._id}`)}>
                      View details
                    </button>
                  </td>
                  <td>
                    {/*
                      Meta only scores an event it has been told to look at, so the
                      link stays inert until the pixel carries the token and the
                      rule that make a score possible. Hovering it lists the steps
                      still outstanding rather than leaving a dead link.
                    */}
                    <button
                      type="button"
                      className={emqReady(r) ? 'cell-link' : 'cell-link muted'}
                      onClick={() => (emqReady(r) ? loadEmq(r) : setEmqFor({ row: r, missing: emqMissing(r) }))}
                      onMouseEnter={(e) => !emqReady(r) && showTip(e.currentTarget)}
                      onMouseLeave={() => setTip(null)}
                      onFocus={(e) => !emqReady(r) && showTip(e.currentTarget)}
                      onBlur={() => setTip(null)}
                    >
                      View EMQ Score
                    </button>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit pixel"
                        onClick={() => {
                          setFormError('');
                          setEditing(metaPixelToForm(r));
                        }}
                      >
                        <LuPencil />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Remove pixel"
                        onClick={() => remove(r)}
                      >
                        <LuTrash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="form-note" style={{ marginTop: 12 }}>
        A pixel defined here is chosen on a traffic channel or on an offer — one place or the other,
        never both, or the conversion is sent twice.
      </div>

      {editing && (
        <MetaPixelModal
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          saving={saving}
          error={formError}
        />
      )}

      {emqFor && (
        <Modal
          title={`EMQ score — ${emqFor.row.title}`}
          onClose={() => setEmqFor(null)}
          footer={
            <>
              {!emqReady(emqFor.row) && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setEmqFor(null);
                    setFormError('');
                    setEditing(metaPixelToForm(emqFor.row));
                  }}
                >
                  Edit pixel
                </button>
              )}
              <button type="button" className="btn" onClick={() => setEmqFor(null)}>
                Close
              </button>
            </>
          }
        >
          {emqFor.loading && <div className="mute">Reading the score from Meta…</div>}

          {(emqFor.missing || []).length > 0 && (
            <>
              <div className="form-note">To view your EMQ score, finish these steps:</div>
              <ol className="rt-steps">
                {emqFor.missing.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <div className="rt-hint" style={{ marginTop: 0 }}>
                Meta scores how well the data you send identifies a real person. It only reports that
                for an event it has been told to watch, which is what the conversion-matching rule
                names.
              </div>
            </>
          )}

          {emqFor.error && (
            <>
              <div className="alert error">{emqFor.error}</div>
              {/*
                Meta refusing to parse the token means the value is not a token
                at all, which is a different problem from one that is expired or
                lacks a permission - so say where the real one comes from.
              */}
              {/token/i.test(emqFor.error) && (
                <div className="rt-hint" style={{ marginTop: 0 }}>
                  That answer came from Meta, not from this tracker. The Data Quality API token on
                  this pixel is not one Meta recognises — generate it in Events Manager, open your
                  pixel, then Settings, and paste it into Edit pixel.
                </div>
              )}
            </>
          )}

          {emqFor.ok && (
            <table className="data density-standard">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="num">Score</th>
                  <th>Matched on</th>
                </tr>
              </thead>
              <tbody>
                {(emqFor.events || []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="table-empty">
                      Meta has no score yet — it needs a few events to have arrived first.
                    </td>
                  </tr>
                )}
                {(emqFor.events || []).map((e) => (
                  <tr key={e.eventName}>
                    <td>{e.eventName}</td>
                    <td className="num">{e.score ?? '—'}</td>
                    <td className="mute">{(e.matchedFields || []).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {tip &&
        createPortal(
          <div className="emq-tip" style={tip}>
            To view your EMQ score, follow these steps:
            <ul>
              <li>Click on &apos;Edit pixel&apos; icon,</li>
              <li>Set Data Quality API token,</li>
              <li>Switch on custom conversion matching,</li>
              <li>Choose conversion type and event name.</li>
            </ul>
          </div>,
          document.body
        )}

      {confirmUI}
    </Page>
  );
}
