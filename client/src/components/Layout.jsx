import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  LuMenu,
  LuScrollText,
  LuChevronDown,
  LuChevronRight,
  LuShieldCheck,
} from 'react-icons/lu';

/**
 * One flat list, in the order the work happens - look at results, then the
 * things you set up, then the raw logs behind them. The logs are the only
 * nested group: three pages that are all the same kind of thing, and none of
 * them a place anyone starts their day.
 */
const NAV = [
  { to: '/', Icon: LuLayoutDashboard, text: 'Dashboard', end: true },
  { to: '/reports', Icon: LuChartColumnBig, text: 'Reports' },
  { to: '/campaigns', Icon: LuMegaphone, text: 'Campaigns' },
  { to: '/sources', Icon: LuShuffle, text: 'Traffic Channels' },
  { to: '/offers', Icon: LuTag, text: 'Offers' },
  { to: '/networks', Icon: LuNetwork, text: 'Offer sources' },
  { to: '/landers', Icon: LuLayoutTemplate, text: 'Landers' },
  { to: '/funnels', Icon: LuFilter, text: 'Funnel templates' },
  { to: '/domains', Icon: LuGlobe, text: 'Traffic domain' },
  { to: '/conversion-tracking', Icon: LuRepeat, text: 'Conversion tracking' },
  { to: '/capi', Icon: LuShieldCheck, text: 'CAPI Integrations' },
  {
    key: 'logs',
    Icon: LuScrollText,
    text: 'Logs',
    children: [
      { to: '/clicks', Icon: LuMousePointerClick, text: 'Clicks' },
      { to: '/conversions', Icon: LuBadgeCheck, text: 'Conversions' },
      { to: '/postbacks', Icon: LuWebhook, text: 'Postbacks' },
    ],
  },
  { to: '/settings', Icon: LuSettings, text: 'Settings' },
];

const COLLAPSED = 'kap.sidebar.collapsed';

export default function Layout() {
  // Remembered, because a sidebar that springs back open on every page load is
  // worse than one that never collapsed.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED) === '1';
    } catch {
      return false;
    }
  });

  // Landing on a log page opens the group, so the sidebar never disagrees with
  // the page being shown.
  const { pathname } = useLocation();
  const logPaths = NAV.find((i) => i.children)?.children.map((c) => c.to) || [];
  const onLogsPage = logPaths.includes(pathname);
  const [openLogs, setOpenLogs] = useState(onLogsPage);

  const applyCollapsed = (next) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED, next ? '1' : '0');
    } catch {
      /* a private window can refuse storage; the toggle still works */
    }
  };
  const toggle = () => applyCollapsed(!collapsed);

  return (
    <div className={`app${collapsed ? ' nav-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">K</div>
          <div className="brand-text">KAP Tracker</div>
          <button
            type="button"
            className="nav-toggle"
            onClick={toggle}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          >
            <LuMenu />
          </button>
        </div>

        <nav className="nav">
          {NAV.map((item) =>
            item.children ? (
              <div className="nav-parent" key={item.key}>
                <button
                  type="button"
                  className="nav-branch"
                  onClick={() => {
                    // A rail with no room for the submenu has to make room
                    if (collapsed) applyCollapsed(false);
                    setOpenLogs((was) => !was || collapsed);
                  }}
                  aria-expanded={openLogs}
                  title={collapsed ? item.text : undefined}
                >
                  <span className="nav-icon"><item.Icon /></span>
                  <span className="nav-text">{item.text}</span>
                  <span className="nav-caret">
                    {openLogs ? <LuChevronDown /> : <LuChevronRight />}
                  </span>
                </button>
                {openLogs && !collapsed && (
                  <div className="nav-sub">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) => (isActive ? 'active' : '')}
                      >
                        <span className="nav-icon"><child.Icon /></span>
                        <span className="nav-text">{child.text}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'active' : '')}
                // Collapsed, the label is gone and the icon is all there is
                title={collapsed ? item.text : undefined}
              >
                <span className="nav-icon"><item.Icon /></span>
                <span className="nav-text">{item.text}</span>
              </NavLink>
            )
          )}
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
