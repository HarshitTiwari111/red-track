import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 17l5-5-5-5" />
    <path d="M20 12H9" />
    <path d="M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
  </svg>
);

/** Name field is optional, so fall back to the email's local part. */
export const displayName = (user) => {
  if (!user) return '';
  if (user.name) return user.name;
  const local = String(user.email || '').split('@')[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
};

export const initialOf = (user) => displayName(user).charAt(0).toUpperCase() || '?';

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!user) return null;

  const doLogout = async () => {
    setBusy(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="avatar-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.email}
      >
        <span className="avatar">{initialOf(user)}</span>
        <span className="caret">{open ? '⌃' : '⌄'}</span>
      </button>

      {open && (
        <div className="user-dropdown" role="menu">
          <div className="who">
            <span className="avatar lg">{initialOf(user)}</span>
            <div>
              <div className="name">{displayName(user)}</div>
              <div className="role">{user.role}</div>
            </div>
          </div>

          <hr />

          <button type="button" onClick={toggle} role="menuitem">
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>

          <button
            type="button"
            className="danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
          >
            <LogoutIcon />
            Logout
          </button>
        </div>
      )}

      {confirming && (
        <Modal
          small
          title="Log out?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn danger solid" onClick={doLogout} disabled={busy}>
                {busy ? <span className="spinner" /> : 'Logout'}
              </button>
            </>
          }
        >
          <div className="confirm">
            <span className="confirm-icon">
              <LogoutIcon />
            </span>
            <div>
              <p>
                You are signed in as <strong>{user.email}</strong>.
              </p>
              <p>Tracking keeps running — this only ends your dashboard session.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
