import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useRealtime } from '../lib/realtime.js';
import { Button } from './ui.jsx';

function navGroups({ hasRole, features, isPlatformAdmin, org, production }) {
  // A company admin only creates accounts and runs the company settings. Task and adjustment work shows
  // only for people who also manage, work in HR or are employees.
  const sends = hasRole('manager', 'hr');
  const works = hasRole('manager', 'hr', 'employee');
  return [
    {
      title: 'Work',
      items: [
        { to: '/', label: 'Home', end: true, show: true },
        { to: '/inbox', label: 'My tasks', show: org && hasRole('employee') },
        { to: '/send', label: 'Send a task', show: org && sends && features.translation },
        { to: '/sent', label: 'Sent tasks', show: org && sends },
        { to: '/meetings', label: 'Meetings', show: org && works },
      ],
    },
    {
      title: 'Adjustments',
      items: [
        { to: '/profile', label: 'My profile', show: org && hasRole('employee') },
        { to: '/team', label: 'My team', show: org && hasRole('manager') },
        { to: '/decisions', label: 'Adjustment requests', show: org && works },
        { to: '/reviews', label: 'Reviews', show: org && works },
        { to: '/rules', label: 'Rule library', show: true },
      ],
    },
    {
      title: 'Company',
      items: [
        { to: '/hr', label: 'HR overview', show: org && hasRole('hr') },
        { to: '/admin/people', label: 'People', show: org && hasRole('admin', 'hr', 'manager') },
        { to: '/admin/settings', label: 'Company settings', show: org && hasRole('admin') },
        { to: '/admin/audit', label: 'Audit log', show: org && hasRole('admin', 'hr') },
      ],
    },
    {
      title: 'Platform',
      items: [
        { to: '/platform', label: 'Companies', end: true, show: isPlatformAdmin },
        { to: '/platform/requests', label: 'Company requests', show: isPlatformAdmin },
        { to: '/platform/rules', label: 'Library admin', show: isPlatformAdmin },
        { to: '/platform/decision-prompts', label: 'Decision prompts', show: isPlatformAdmin },
        { to: '/platform/evaluation', label: 'Evaluation', show: isPlatformAdmin },
      ],
    },
    {
      title: 'You',
      items: [
        { to: '/notifications', label: 'Notifications', show: true },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length);
}

export function Layout({ children }) {
  const auth = useAuth();
  const { user, org, session, signOut } = auth;
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useRealtime(true);
  const { data: notes } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/api/notifications'), refetchInterval: 60000 });

  useEffect(() => {
    setMenuOpen(false);
    // Move focus to the new page heading so screen-reader users hear the page change.
    const t = setTimeout(() => document.getElementById('page-title')?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const groups = navGroups({ ...auth, production: session?.environment?.production });
  const unread = notes?.unread || 0;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <nav className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Main">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">✓</span>
          BarrierFix
        </Link>
        {org && <p className="org-name">{org.name}</p>}
        {groups.map((g) => (
          <div className="nav-group" key={g.title}>
            <h2>{g.title}</h2>
            {g.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <span>{item.label}</span>
                {item.to === '/notifications' && unread > 0 && (
                  <span className="nav-count">
                    {unread}
                    <span className="visually-hidden"> unread</span>
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <Button variant="secondary" size="small" className="menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? 'Close menu' : 'Menu'}
          </Button>
          <Link to="/notifications" className="btn btn-ghost btn-small">
            Notifications{unread > 0 ? ` (${unread})` : ''}
          </Link>
          <span className="muted small" aria-label="Signed in as">
            {user?.name || user?.email}
          </span>
          <Button variant="ghost" size="small" onClick={signOut}>
            Sign out
          </Button>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
