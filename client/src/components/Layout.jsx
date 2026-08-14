import { NavLink, Outlet } from 'react-router-dom';
import UserMenu from './UserMenu.jsx';
import ViewAsPicker from './ViewAsPicker.jsx';

const NAV = [
  {
    label: 'Analytics',
    items: [
      { to: '/', icon: '◫', text: 'Dashboard', end: true },
      { to: '/campaigns', icon: '◈', text: 'Campaigns' },
      { to: '/conversions', icon: '✓', text: 'Conversions' },
      { to: '/reports', icon: '▥', text: 'Reports' },
      { to: '/postbacks', icon: '⇠', text: 'Postbacks' },
      { to: '/clicks', icon: '⇢', text: 'Clicks Log' },
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
      {/* The bar carries only what belongs to the session - whose data is shown,
          and who is signed in. A page's own name and controls live on the page. */}
      <header className="topbar">
        <div className="topbar-left">
          <ViewAsPicker />
        </div>
        <div className="topbar-actions">
          <UserMenu />
        </div>
      </header>
      <div className="page">
        {/* The Dashboard renders its own headline, so it passes no title */}
        {(title || actions) && (
          <div className="page-head">
            {title ? <h1>{title}</h1> : <span />}
            {actions && <div className="page-actions">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </>
  );
}
