import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usingEmulator } from '../../lib/firebase.js';

export function AuthShell({ title, children, footer }) {
  useEffect(() => {
    document.title = `${title} · BarrierFix`;
  }, [title]);
  return (
    <div className="auth-page">
      <main className="card auth-card" id="main">
        <Link to="/login" className="brand">
          <span className="brand-mark" aria-hidden="true">✓</span>
          BarrierFix
        </Link>
        <h1>{title}</h1>
        {children}
        {footer && <div style={{ marginTop: '1rem' }}>{footer}</div>}
        {usingEmulator && (
          <p className="muted small" style={{ marginTop: '1.25rem' }}>
            Development mode: emails are not really sent. Open the <Link to="/dev/mailbox-public">Dev mailbox</Link> to see verification and reset links.
          </p>
        )}
      </main>
    </div>
  );
}
