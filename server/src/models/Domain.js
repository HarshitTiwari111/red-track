import mongoose from 'mongoose';

/**
 * A tracking domain the click endpoints are reachable on.
 *
 * The app itself does not terminate TLS - nginx or Cloudflare does - so no
 * certificate material is ever stored here. The SSL columns are filled by
 * reading the certificate the domain actually presents (see ssl.service.js).
 */
const domainSchema = new mongoose.Schema(
  {
    // Hostname only, e.g. "track.example.com"
    host: { type: String, required: true, unique: true, lowercase: true, trim: true },
    protocol: { type: String, enum: ['https', 'http'], default: 'https' },
    // Where a visitor hitting the bare domain (no campaign) is sent; blank = 404
    rootRedirectUrl: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
    /**
     * pending -> the CNAME has not been seen in DNS yet, so the host guard does
     * not serve this domain; active -> DNS verified (or switched on by hand);
     * paused -> verified but deliberately switched off by the operator.
     */
    status: { type: String, enum: ['pending', 'active', 'paused'], default: 'pending' },
    notes: { type: String, default: '' },

    // DNS verification. targetCname is snapshotted at creation so the setup
    // instructions keep naming the same record even if the default changes.
    targetCname: { type: String, default: '' },
    dnsCheckedAt: { type: Date, default: null },
    dnsVerifiedAt: { type: Date, default: null },
    dnsMethod: { type: String, enum: ['', 'cname', 'a'], default: '' },
    dnsFound: { type: [String], default: [] },
    dnsError: { type: String, default: '' },
    dnsAttempts: { type: Number, default: 0 },

    /**
     * How this domain's certificate is obtained.
     *   auto   - the reverse proxy owns TLS (nginx + certbot, or Cloudflare).
     *            Nothing is stored here; this is the default and the safe path.
     *   manual - the operator pasted a certificate and key below.
     *
     * The key is stored so an operator can keep the pair with the domain, but it
     * is never returned by the API - see sanitize() in domains.routes.js.
     */
    sslMode: { type: String, enum: ['auto', 'manual'], default: 'manual' },
    sslCertificate: { type: String, default: '' },
    sslPrivateKey: { type: String, default: '' },
    // Parsed out of the pasted certificate, so the table can show it without re-parsing
    certExpiresAt: { type: Date, default: null },
    certIssuer: { type: String, default: '' },
    certSubject: { type: String, default: '' },

    // Filled by the SSL check
    sslCheckedAt: { type: Date, default: null },
    sslExpiresAt: { type: Date, default: null },
    sslIssuer: { type: String, default: '' },
    sslSubject: { type: String, default: '' },
    sslError: { type: String, default: '' },
  },
  { timestamps: true, collection: 'domains' }
);

export const Domain = mongoose.model('Domain', domainSchema);
export default Domain;
