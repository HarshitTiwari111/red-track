import { NavLink, Outlet } from 'react-router-dom';
import UserMenu from './UserMenu.jsx';
import ViewAsPicker from './ViewAsPicker.jsx';
import {
  LuLayoutDashboard,
  LuMegaphone,
  LuBadgeCheck,
  LuChartColumnBig,
  LuWebhook,
  LuMousePointerClick,
  LuTag,
  LuLayoutTemplate,
  LuShuffle,
  LuNetwork,
  LuFilter,
  LuGlobe,
  LuRepeat,
  LuSettings,
} from 'react-icons/lu';

const NAV = [
  {
    label: 'Analytics',
    items: [
      { to: '/', Icon: LuLayoutDashboard, text: 'Dashboard', end: true },
      { to: '/campaigns', Icon: LuMegaphone, text: 'Campaigns' },
      { to: '/conversions', Icon: LuBadgeCheck, text: 'Conversions' },
      { to: '/reports', Icon: LuChartColumnBig, text: 'Reports' },
      { to: '/postbacks', Icon: LuWebhook, text: 'Postbacks' },
      { to: '/clicks', Icon: LuMousePointerClick, text: 'Clicks Log' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/offers', Icon: LuTag, text: 'Offers' },
      { to: '/landers', Icon: LuLayoutTemplate, text: 'Landers' },
      { to: '/sources', Icon: LuShuffle, text: 'Traffic Channels' },
      { to: '/networks', Icon: LuNetwork, text: 'Offer sources' },
      { to: '/funnels', Icon: LuFilter, text: 'Funnel templates' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/domains', Icon: LuGlobe, text: 'Traffic domain' },
      { to: '/conversion-tracking', Icon: LuRepeat, text: 'Conversion tracking' },
      { to: '/settings', Icon: LuSettings, text: 'Settings' },
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
                  <span className="nav-icon"><item.Icon /></span>
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
