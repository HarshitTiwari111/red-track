import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import useConfirm from '../components/ConfirmModal.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import CopyField from '../components/CopyField.jsx';
import { settingsApi, logsApi, healthApi, errMsg } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Sydney',
];

export default function Settings() {
  const [confirm, confirmUI] = useConfirm();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState('general');
  const [settings, setSettings] = useState(null);
  const [users, setUsers] = useState([]);
  const [health, setHealth] = useState(null);
  const [clickErrors, setClickErrors] = useState([]);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newUser, setNewUser] = useState(null);
  const [account, setAccount] = useState({ name: '', currentPassword: '', password: '', confirm: '' });
  const [savingAccount, setSavingAccount] = useState(false);

  /*
   * The user list is fetched only for admins. It used to be part of the same
   * Promise.all as everything else, and the endpoint refuses a non-admin - so
   * one 403 rejected the whole batch and a user opening Settings saw no
   * settings at all, only an error about users they never asked for.
   */
  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([settingsApi.get(), healthApi()]);
      setSettings(s);
      setHealth(h);
      if (isAdmin) settingsApi.users().then(setUsers).catch(() => setUsers([]));
    } catch (err) {
      setMsg({ type: 'error', text: errMsg(err) });
    }
  }, [isAdmin]);

  // Seed the account form from whoever is signed in
  useEffect(() => {
    if (user) setAccount((a) => ({ ...a, name: user.name || '' }));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== 'diagnostics') return;
    logsApi.clickErrors({ limit: 100 }).then(setClickErrors).catch(() => {});
  }, [tab]);

  const saveAccount = async () => {
    // Caught here rather than at the server so the second field is what gets
    // blamed, instead of a generic rejection after a round trip
    if (account.password && account.password !== account.confirm) {
      setMsg({ type: 'error', text: 'The two new passwords do not match.' });
      return;
    }
    setSavingAccount(true);
    setMsg(null);
    try {
      const body = { name: account.name };
      if (account.password) {
        body.currentPassword = account.currentPassword;
        body.password = account.password;
      }
      const res = await settingsApi.updateMe(body);
      setAccount({ name: res.user.name || '', currentPassword: '', password: '', confirm: '' });
      setMsg({
        type: 'success',
        text: res.signedOutElsewhere
          ? 'Password changed. Every other session has been signed out.'
          : 'Account updated.',
      });
    } catch (err) {
      setMsg({ type: 'error', text: errMsg(err) });
    } finally {
      setSavingAccount(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await settingsApi.update({
        botUaPatterns: settings.botUaPatterns,
        blockedIpRanges: settings.blockedIpRanges,
        rawClickRetentionDays: Number(settings.rawClickRetentionDays),
        reportTimezone: settings.reportTimezone,
        telegramEnabled: settings.telegramEnabled,
        metaAppId: settings.metaAppId || '',
        // Blank means "keep the stored one" - it is never sent back to us
        metaAppSecret: settings.metaAppSecret || '',
      });
      setSettings(saved);
      setMsg({ type: 'success', text: 'Settings saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: errMsg(err) });
    } finally {
      setSaving(false);
    }
  };

  const testTelegram = async () => {
    setMsg(null);
    try {
      const res = await settingsApi.telegramTest();
      setMsg(
        res.ok
          ? { type: 'success', text: 'Test message sent to Telegram.' }
          : { type: 'error', text: res.reason || res.error || 'Telegram is not configured (set the bot token and chat id in .env).' }
      );
    } catch (err) {
      setMsg({ type: 'error', text: errMsg(err) });
    }
  };

  const createUser = async () => {
    try {
      await settingsApi.createUser(newUser);
      setNewUser(null);
      setMsg({ type: 'success', text: 'User created.' });
      load();
    } catch (err) {
      setMsg({ type: 'error', text: errMsg(err) });
    }
  };

  const rotateKey = async (u) => {
    try {
      await settingsApi.rotateApiKey(u._id);
      load();
    } catch (err) {
      setMsg({ type: 'error', text: errMsg(err) });
    }
  };

  const removeUser = async (u) => {
    const ok = await confirm({
      title: 'Confirm delete',
      message: `Are you sure you want to delete ${u.email}?`,
      note: 'They lose access immediately. Records they created stay where they are.',
    });
    if (!ok) return;
    try {
      await settingsApi.deleteUser(u._id);
      load();
    } catch (err) {
      setMsg({ type: 'error', text: errMsg(err) });
    }
  };

  if (!settings) {
    return (
      <Page title="Settings">
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </Page>
    );
  }

  const listField = (label, key, hint, placeholder) => (
    <label className="field">
      <span>{label}</span>
      <textarea
        className="mono"
        style={{ minHeight: 150 }}
        value={(settings[key] || []).join('\n')}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
        placeholder={placeholder}
      />
      <div className="hint">{hint}</div>
    </label>
  );

  return (
    <Page title="Settings">
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      {!isAdmin && (
        <div className="alert info">
          You are signed in as a user — install settings are read-only, and you see only your own
          campaigns, offers and reports. Your own account is yours to change under My account.
        </div>
      )}

      {/*
        Managing users is an admin's job, so the tab is not offered to anyone
        else. It used to be, and it opened an empty table - the list endpoint
        refuses a non-admin, which reads as something broken rather than
        something not theirs.
      */}
      <div className="tabs">
        {['general', 'filters', ...(isAdmin ? ['users'] : []), 'account', 'diagnostics'].map((t) => (
          <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'account' ? 'My account' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="panel">
          <div className="panel-body">
            <div className="field-row">
              <label className="field">
                <span>Report timezone</span>
                <select
                  value={settings.reportTimezone}
                  disabled={!isAdmin}
                  onChange={(e) => setSettings({ ...settings, reportTimezone: e.target.value })}
                >
                  {[...new Set([settings.reportTimezone, ...TIMEZONES])].map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <div className="hint">All report days and hours are bucketed in this timezone.</div>
              </label>

              <label className="field">
                <span>Raw click retention (days)</span>
                <input
                  type="number"
                  min="1"
                  max="3650"
                  disabled={!isAdmin}
                  value={settings.rawClickRetentionDays}
                  onChange={(e) => setSettings({ ...settings, rawClickRetentionDays: e.target.value })}
                />
                <div className="hint">Aggregated stats are kept forever — only raw click rows are pruned.</div>
              </label>
            </div>

            <label className="field">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={settings.telegramEnabled}
                onChange={(e) => setSettings({ ...settings, telegramEnabled: e.target.checked })}
              />
              Telegram alerts enabled
              <div className="hint">
                Bot token {settings.telegramConfigured ? 'is configured in .env' : 'is NOT configured — alerts are skipped'}.
              </div>
            </label>

            {/*
              Google's consent screen runs on a proxy that already holds its
              client, so nobody configures Google here. Meta has no such proxy:
              the app has to be the operator's own, and this is where they say
              which one - not an environment variable and a restart, which the
              person holding the Facebook account often cannot reach.
            */}
            <div className="section-title" style={{ marginTop: 24 }}>
              Meta app (for &quot;Connect Meta&quot;)
            </div>
            <div className="hint" style={{ marginBottom: 12 }}>
              Create an app of type <strong>Business</strong> at developers.facebook.com, add the
              Facebook Login product, and paste this as a Valid OAuth Redirect URI:
              <div className="mono" style={{ marginTop: 6 }}>
                {settings.metaRedirectUri || '—'}
              </div>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>App ID</span>
                <input
                  type="text"
                  className="mono"
                  disabled={!isAdmin}
                  value={settings.metaAppId || ''}
                  onChange={(e) => setSettings({ ...settings, metaAppId: e.target.value })}
                  placeholder="1234567890123456"
                />
              </label>
              <label className="field">
                <span>App secret</span>
                <input
                  type="password"
                  className="mono"
                  autoComplete="new-password"
                  disabled={!isAdmin}
                  value={settings.metaAppSecret || ''}
                  onChange={(e) => setSettings({ ...settings, metaAppSecret: e.target.value })}
                  placeholder={settings.hasMetaAppSecret ? '•••••••• (stored)' : 'from the app’s Basic settings'}
                />
                <div className="hint">
                  {settings.hasMetaAppSecret
                    ? 'A secret is stored. Leave this blank to keep it.'
                    : 'Stored write-only — it is never shown again.'}
                </div>
              </label>
            </div>

            <div className="btn-group">
              <button type="button" className="btn primary" onClick={save} disabled={!isAdmin || saving}>
                {saving ? <span className="spinner" /> : 'Save settings'}
              </button>
              <button type="button" className="btn" onClick={testTelegram} disabled={!isAdmin}>
                Send Telegram test
              </button>
            </div>

            {health && (
              <>
                <div className="section-title" style={{ marginTop: 24 }}>
                  System health
                </div>
                <div className="mono dim">
                  db={health.db} · cache age={Math.round((health.cache?.ageMs || 0) / 1000)}s · campaigns=
                  {health.cache?.campaigns} · uptime={health.uptimeSec}s · pid={health.pid} · env={health.env}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'filters' && (
        <div className="panel">
          <div className="panel-body">
            <div className="field-row">
              {listField(
                'Bot user-agent patterns (one per line)',
                'botUaPatterns',
                'Matched case-insensitively as substrings. Flagged clicks still redirect, but are excluded from reports.',
                'bot\ncrawl\nheadless'
              )}
              {listField(
                'Blocked IPs / CIDR ranges (one per line)',
                'blockedIpRanges',
                'Plain IPv4, IPv4 CIDR (1.2.3.0/24) or exact IPv6 addresses.',
                '203.0.113.4\n198.51.100.0/24'
              )}
            </div>
            <button type="button" className="btn primary" onClick={save} disabled={!isAdmin || saving}>
              {saving ? <span className="spinner" /> : 'Save filters'}
            </button>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <>
          <div className="toolbar">
            <button
              type="button"
              className="btn primary sm"
              disabled={!isAdmin}
              onClick={() => setNewUser({ name: '', email: '', password: '', role: 'user' })}
            >
              + New user
            </button>
          </div>
          <div className="panel">
            <DataTable
              columns={[
                { key: 'name', label: 'Name', render: (r) => r.name || <span className="mute">—</span> },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role', render: (r) => <span className="badge neutral">{r.role}</span> },
                {
                  key: 'active',
                  label: 'Active',
                  render: (r) => <span className={`badge ${r.active ? 'active' : 'paused'}`}>{r.active ? 'active' : 'disabled'}</span>,
                },
                { key: 'apiKey', label: 'API key', render: (r) => <span className="mono truncate">{r.apiKey}</span> },
                {
                  key: '_a',
                  label: '',
                  noSort: true,
                  render: (r) => (
                    <div className="btn-group">
                      <button type="button" className="btn sm" disabled={!isAdmin} onClick={() => rotateKey(r)}>
                        Rotate key
                      </button>
                      <button type="button" className="btn sm danger" disabled={!isAdmin} onClick={() => removeUser(r)}>
                        Delete
                      </button>
                    </div>
                  ),
                },
              ]}
              rows={users}
            />
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            API keys authenticate server-to-server calls to <span className="mono">/api/v1/*</span> via the{' '}
            <span className="mono">X-Api-Key</span> header.
          </div>
        </>
      )}

      {tab === 'account' && (
        <div className="panel">
          <div className="panel-head">
            <h3>My account</h3>
          </div>
          <div className="panel-body">
            <div className="hint" style={{ marginBottom: 14 }}>
              Signed in as <span className="mono">{user?.email}</span> ({user?.role}). Only an admin
              can change your role or email.
            </div>

            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                value={account.name}
                onChange={(e) => setAccount({ ...account, name: e.target.value })}
              />
            </label>

            <div className="section-title" style={{ marginTop: 22 }}>
              Change password
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={account.currentPassword}
                  onChange={(e) => setAccount({ ...account, currentPassword: e.target.value })}
                />
              </label>
              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={account.password}
                  onChange={(e) => setAccount({ ...account, password: e.target.value })}
                />
                <div className="hint">At least 8 characters. Leave blank to keep the current one.</div>
              </label>
              <label className="field">
                <span>Repeat new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={account.confirm}
                  onChange={(e) => setAccount({ ...account, confirm: e.target.value })}
                />
              </label>
            </div>

            <div className="hint" style={{ marginTop: 6 }}>
              Changing your password signs you out everywhere else. This browser stays signed in.
            </div>

            <div className="btn-group" style={{ marginTop: 16 }}>
              <button type="button" className="btn primary" onClick={saveAccount} disabled={savingAccount}>
                {savingAccount ? <span className="spinner" /> : 'Save my account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'diagnostics' && (
        <>
          {/* Postbacks moved to their own page: they are read while debugging a
              missing conversion, which is not what anyone opens Settings for. */}
          <div className="page-note" style={{ marginBottom: 18 }}>
            Looking for conversion postbacks? They have their own page now —{' '}
            <Link to="/postbacks">Postbacks</Link> — with the raw parameters each caller sent.
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Click errors</h3>
            </div>
            <DataTable
              columns={[
                { key: 'ts', label: 'Time', render: (r) => new Date(r.ts).toLocaleString() },
                { key: 'route', label: 'Route' },
                { key: 'slug', label: 'Slug', render: (r) => <span className="mono">{r.slug || '—'}</span> },
                { key: 'reason', label: 'Reason' },
                { key: 'ip', label: 'IP', render: (r) => <span className="mono">{r.ip}</span> },
              ]}
              rows={clickErrors}
              maxHeight="45vh"
            />
          </div>
        </>
      )}

      {newUser && (
        <Modal
          title="New user"
          onClose={() => setNewUser(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setNewUser(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={createUser}>
                Create user
              </button>
            </>
          }
        >
          <label className="field">
            <span>Display name</span>
            <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Aman Singh" />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
          </label>
          <label className="field">
            <span>Password (min 8 characters)</span>
            <input type="text" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <CopyField label="Tracker base URL" value={window.location.origin} />
        </Modal>
      )}
      {confirmUI}
    </Page>
  );
}
