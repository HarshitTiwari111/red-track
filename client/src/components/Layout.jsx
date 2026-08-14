import { NavLink, Outlet } from 'react-router-dom';
import UserMenu from './UserMenu.jsx';
import ViewAsPicker from './ViewAsPicker.jsx';

const NAV = [
  {
    label: 'Analytics',
    items: [
      { to: '/', icon: '◫', text: 'Dashboard', end: true },
      { to: '/reports', icon: '▥', text: 'Reports' },
      { to: '/campaigns', icon: '◈', text: 'Campaigns' },
      { to: '/clicks', icon: '⇢', text: 'Clicks Log' },
      { to: '/conversions', icon: '✓', text: 'Conversions' },
      { to: '/postbacks', icon: '⇠', text: 'Postbacks' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/offers', icon: '◆', text: 'Offers' },
      { to: '/landers', icon: '▤', text: 'Landers' },
      { to: '/sources', icon: '⇄', text: 'Traffic Channels' },
      { to: '/networks', icon: '⛓', text: 'Offer sources' },
      { to: '/funnels', icon: '⑂', text: 'Funnel templates' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/domains', icon: '🌐', text: 'Traffic domain' },
      { to: '/conversion-tracking', icon: '⇄', text: 'Conversion tracking' },
      { to: '/settings', icon: '⚙', text: 'Settings' },
    ],
  },
];

export default function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">K</div>
          <div className="brand-text">
            KAP Tracker
            <small>self-hosted</small>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.text}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

      </aside>

      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}

/** Standard page shell: sticky topbar with a title + optional right-side actions. */
export function Page({ title, actions, children }) {
  return (
    <>
      <header className="topbar">
        {/* Pages that render their own headline (the Dashboard) pass no title */}
        {title ? <h1>{title}</h1> : <span />}
        <div className="topbar-actions">
          <ViewAsPicker />
          {actions}
          <UserMenu />
        </div>
      </header>
      <div className="page">{children}</div>
    </>
  );
}
