import Modal from './Modal.jsx';
import Field, { Switch } from './Field.jsx';

export const blankDomain = () => ({
  host: '',
  protocol: 'https',
  rootRedirectUrl: '',
  isDefault: false,
  status: 'pending',
  notes: '',
  // Off by default: the certificate fields are what a new domain usually needs
  sslMode: 'manual',
  sslCertificate: '',
  sslPrivateKey: '',
});

export const domainToForm = (d) => ({ ...blankDomain(), ...d, sslPrivateKey: '' });

export default function DomainModal({ value, defaultHost, targetCname, onChange, onClose, onSave, saving, error }) {
  const set = (patch) => onChange({ ...value, ...patch });
  // Matches the server: only a verified domain shows the target it was proved against
  const target = (value.dnsVerifiedAt && value.targetCname) || targetCname || defaultHost || 'this server';
  const isNew = !value._id;
  const freeSsl = value.sslMode !== 'manual';

  const buttons = (
    <>
      <button type="button" className="btn primary" onClick={onSave} disabled={saving}>
        {saving ? <span className="spinner" /> : 'Save'}
      </button>
      <button type="button" className="btn ghost" onClick={onClose}>
        Cancel
      </button>
    </>
  );

  return (
    <Modal
      compact
      title={isNew ? 'New domain' : 'Edit domain'}
      onClose={onClose}
      headerActions={buttons}
      footer={buttons}
    >
      {error && <div className="alert error">{error}</div>}

      <p className="domain-intro">
        For sub-domains (track.example.com), create CNAME record pointing to <strong className="mono">{target}</strong>
        <br />
        Important: please use 3rd level domain, not 2nd level domain. Ex: att.trk.agency, and not trk.agency
      </p>

      <Field label="URL" required>
        <input
          type="text"
          className="mono"
          value={value.host}
          onChange={(e) => set({ host: e.target.value })}
          placeholder="https://"
        />
      </Field>

      <Field
        label="Root domain URL"
        hint="Redirect all visitors to the root URL of your tracking domain (URL without a campaign ID) to 404 page (by default) or to custom URL"
      >
        <input
          type="text"
          className="mono"
          value={value.rootRedirectUrl}
          onChange={(e) => set({ rootRedirectUrl: e.target.value })}
          placeholder="Leave blank to redirect to 404 by default"
        />
      </Field>

      <div className="ssl-toggle">
        <Switch
          checked={freeSsl}
          onChange={(on) => set({ sslMode: on ? 'auto' : 'manual' })}
          label="Free SSL certificate"
        />
      </div>

      {freeSsl ? (
        <div className="ssl-note">
          <span className="ssl-note-icon" aria-hidden="true">
            i
          </span>
          <div>
            Free SSL certificate — issued and renewed by your reverse proxy (nginx with certbot) or Cloudflare, using
            open source Let&rsquo;s Encrypt technology.
            <br />
            Open source projects are beyond our control. We advise you to purchase and install a paid SSL certificate
            for production traffic.
            <br />
            The tracker stores no certificates or keys; the SSL column reads whatever this host presents.
            <br />
            Certificate issue time can take up to 24 hours after the DNS record propagates.
          </div>
        </div>
      ) : (
        <>
          <p className="domain-intro">
            Please cut and paste your Certificate and Private Key using text editor (like notepad). Please include
            &lsquo;---BEGIN CERTIFICATE--&rsquo; and &lsquo;--END CERTIFICATE---&rsquo; markers.
            <br />
            Please make sure you add all bundle certificates — leaf first, then intermediates.
          </p>

          <Field label="Certificate">
            <textarea
              className="mono pem"
              value={value.sslCertificate || ''}
              onChange={(e) => set({ sslCertificate: e.target.value })}
              placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
            />
          </Field>

          <Field
            label="Key"
            /* Never sent back to the browser, so an edit shows it blank rather than masked */
            hint={value.hasPrivateKey ? 'A key is already on file — leave blank to keep it.' : undefined}
          >
            <textarea
              className="mono pem"
              value={value.sslPrivateKey || ''}
              onChange={(e) => set({ sslPrivateKey: e.target.value })}
              placeholder={'-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'}
            />
          </Field>
        </>
      )}

      <div style={{ margin: '0 0 10px' }}>
        <Switch
          checked={value.isDefault}
          onChange={(v) => set({ isDefault: v })}
          label="Use as the default domain in tracking links"
        />
      </div>

      {!isNew && (
        <Field
          label="Status"
          hint={
            value.status === 'pending'
              ? 'Force Active only if you know DNS is right — the check cannot see every setup.'
              : 'Paused keeps tracking alive but is skipped when building links.'
          }
        >
          <select value={value.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </Field>
      )}

      <Field label="Notes">
        <textarea value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </Modal>
  );
}
