import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errMsg } from '../api/client.js';

/* Inline icons - no icon package needed for four glyphs. */
const MailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 6 10-6" />
  </svg>
);

const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.2 6.6A17 17 0 0 0 2 12s3.6 7 10 7c1.9 0 3.5-.5 4.9-1.3" />
    <path d="m3 3 18 18" />
    <path d="M9.9 10.1a3 3 0 0 0 4.1 4.2" />
  </svg>
);

/** The KAP monogram, sized for the brand tile. */
const BrandMark = () => (
  <svg width="46" height="46" viewBox="0 0 46 46" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="kapMark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#4f9dff" />
        <stop offset="100%" stopColor="#a78bfa" />
      </linearGradient>
    </defs>
    <text
      x="23"
      y="34"
      textAnchor="middle"
      fontSize="34"
      fontWeight="700"
      fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      fill="url(#kapMark)"
    >
      K
    </text>
  </svg>
);

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errMsg(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <aside className="login-aside">
          <div className="login-mark">
            <BrandMark />
          </div>
          <div className="login-brand">KAP Tracker</div>
          <p className="login-tagline">Self-hosted click, conversion and ROI tracking for paid media</p>
          <div className="login-divider">Tracking Dashboard</div>
        </aside>

        <form className="login-form" onSubmit={submit}>
          <h1 className="login-title">Welcome back</h1>
          <p className="login-sub">Sign in to your KAP Tracker account</p>

          {error && <div className="login-alert">{error}</div>}

          <label className="login-field">
            <span>Email address</span>
            <div className="login-input">
              <span className="icon">
                <MailIcon />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="username"
                required
                autoFocus
              />
            </div>
          </label>

          <label className="login-field">
            <span>Password</span>
            <div className="login-input has-toggle">
              <span className="icon">
                <LockIcon />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Sign In'}
          </button>

          <p className="login-foot">Contact your administrator for account access</p>
        </form>
      </div>
    </div>
  );
}
