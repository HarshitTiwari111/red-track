import { useCallback, useEffect, useState } from 'react';
import { Page } from '../components/Layout.jsx';
import Field, { Switch } from '../components/Field.jsx';
import { api, errMsg } from '../api/client.js';

/**
 * One job: hand the operator the exact postback templates to paste into an
 * affiliate network's panel, built for whichever tracking domain they pick.
 *
 * There is no event-name editor here. A single company tracks one or two kinds
 * of conversion, and with no declared list the tracker simply keeps whatever
 * name the network sends - so the screen would configure nothing.
 */
export default function ConversionTracking() {
  const [data, setData] = useState(null);
  const [domainId, setDomainId] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [showS2sStatuses, setShowS2sStatuses] = useState(false);
  const [showPixelStatuses, setShowPixelStatuses] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (id) => {
    try {
      const { data: d } = await api.get('/settings/conversion-tracking');
      setData(d);
      if (id === undefined) setDomainId(d.selectedDomainId || '');
    } catch (err) {
      setError(errMsg(err, 'Could not load conversion tracking'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chooseDomain = async (id) => {
    setDomainId(id);
    setError('');
    try {
      await api.put('/settings', { postbackDomainId: id || null });
      await load(id);
      setNotice('Default postback domain updated.');
      setTimeout(() => setNotice(''), 4000);
    } catch (err) {
      setError(errMsg(err, 'Could not save the domain'));
    }
  };

  if (!data) {
    return (
      <Page title="Conversion tracking">
        <div className="panel">
          <div className="panel-body table-empty">
            <span className="spinner" /> Loading…
          </div>
        </div>
      </Page>
    );
  }

  const chosen = data.domains.find((d) => String(d._id) === String(domainId));
  const originHost = (chosen ? chosen.url : data.defaultOrigin).replace(/^https?:\/\//, '');

  return (
    <Page title="Conversion tracking">
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="panel">
        <div className="panel-body">
          <h3 style={{ marginBottom: 10 }}>Conversion postback domain</h3>
          <p className="rt-hint" style={{ marginTop: 0 }}>
            <strong className="mono">{originHost}</strong> is your default postback domain. If you add more tracking
            domains you can use the menu below to change them in the postback URLs.
          </p>

          <Field label="Domain">
            <select value={domainId} onChange={(e) => chooseDomain(e.target.value)}>
              <option value="">{data.defaultOrigin} (install default)</option>
              {data.domains.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.host}
                  {d.status !== 'active' ? ` (${d.status})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <div className="ssl-note">
            <span className="ssl-note-icon" aria-hidden="true">
              i
            </span>
            <div>
              Choosing a domain here sets the default used in the templates below. Using a different tracking domain
              directly in your flow is fine — it will not affect tracking.
              {chosen && chosen.status !== 'active' && (
                <>
                  <br />
                  <strong>
                    {chosen.host} is {chosen.status}
                  </strong>{' '}
                  — verify its DNS before handing these URLs to a network.
                </>
              )}
            </div>
          </div>

          <button type="button" className={`btn ${legacy ? '' : 'primary'}`} onClick={() => setLegacy((v) => !v)}>
            {legacy ? 'Hide templates' : 'Show postback templates'}
          </button>
        </div>
      </div>

      {legacy && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-body">
            <h3>S2S conversion tracking</h3>
            <p className="rt-hint" style={{ marginTop: 4 }}>
              Copy a postback URL and adjust the macros to your network&apos;s specification.
            </p>
            <CopyRow label="S2S postback URL for conversion" value={data.s2s.conversion} />

            <div className="ct-toggle">
              <Switch
                checked={showS2sStatuses}
                onChange={setShowS2sStatuses}
                label="Show postbacks for statuses (Pending, Approved, Declined, Other)"
              />
            </div>
            {showS2sStatuses && (
              <>
                <CopyRow label="S2S postback URL for Pending" value={data.s2s.pending} />
                <CopyRow label="S2S postback URL for Approved" value={data.s2s.approved} />
                <CopyRow label="S2S postback URL for Declined" value={data.s2s.declined} />
                <CopyRow label="S2S postback URL for Other" value={data.s2s.other} />
              </>
            )}

            <h3 style={{ marginTop: 22 }}>Conversion tracking pixel</h3>
            <p className="rt-hint" style={{ marginTop: 4 }}>
              Use when S2S is not available. Some browsers block third-party cookies, so use it with discretion.
            </p>
            <CopyRow label="Pixel postback code for conversion" value={data.pixel.conversion} />

            <div className="ct-toggle">
              <Switch
                checked={showPixelStatuses}
                onChange={setShowPixelStatuses}
                label="Show pixel for statuses (Pending, Approved, Declined, Other)"
              />
            </div>
            {showPixelStatuses && (
              <>
                <CopyRow label="Pixel for Pending" value={data.pixel.pending} />
                <CopyRow label="Pixel for Approved" value={data.pixel.approved} />
                <CopyRow label="Pixel for Declined" value={data.pixel.declined} />
                <CopyRow label="Pixel for Other" value={data.pixel.other} />
              </>
            )}

            <h3 style={{ marginTop: 22 }}>Postback script</h3>
            <p className="rt-hint" style={{ marginTop: 4 }}>
              For a thank-you page, instead of the pixel. The page must carry the click id in its URL, e.g.{' '}
              <span className="mono">https://my.site.com/thankyou?clickid=1234567</span>
            </p>
            <CopyRow label="Postback script" value={data.script} />
          </div>
        </div>
      )}
    </Page>
  );
}

/** Read-only template with a copy button. */
function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value || '');
      else {
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
    <div className="rt-field ct-copy">
      <span className="rt-label">{label}</span>
      <input type="text" className="mono" readOnly value={value || ''} onFocus={(e) => e.target.select()} />
      <button type="button" className="icon-btn" onClick={copy} title="Copy" aria-label={`Copy ${label}`}>
        {copied ? '✓' : '⧉'}
      </button>
    </div>
  );
}
