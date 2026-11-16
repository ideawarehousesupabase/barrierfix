import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

export function Button({ variant = 'primary', size, busy = false, children, className = '', ...props }) {
  return (
    <button type="button" className={`btn btn-${variant}${size === 'small' ? ' btn-small' : ''} ${className}`} disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function PageHeader({ title, intro, actions }) {
  useEffect(() => {
    document.title = `${title} · BarrierFix`;
  }, [title]);
  return (
    <div className="page-header">
      <div>
        <h1 id="page-title" tabIndex={-1}>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', headingLevel = 2 }) {
  const H = `h${headingLevel}`;
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          {title && <H>{title}</H>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint" id={hintId}>{hint}</p>}
      {typeof children === 'function' ? children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) || undefined }) : children}
      {error && <p className="error" id={errorId}>{error}</p>}
    </div>
  );
}

export function TextInput({ label, hint, error, ...props }) {
  return <Field label={label} hint={hint} error={error}>{(a11y) => <input type="text" {...a11y} {...props} />}</Field>;
}

export function TextArea({ label, hint, error, ...props }) {
  return <Field label={label} hint={hint} error={error}>{(a11y) => <textarea {...a11y} {...props} />}</Field>;
}

export function Select({ label, hint, error, options, placeholder, ...props }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(a11y) => (
        <select {...a11y} {...props}>
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, hint, ...props }) {
  const id = useId();
  return (
    <div className="choice">
      <input type="checkbox" id={id} {...props} />
      <label htmlFor={id}>
        {label}
        {hint && <span className="muted small"> {hint}</span>}
      </label>
    </div>
  );
}

export function RadioGroup({ legend, name, options, value, onChange, inline = false }) {
  const base = useId();
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      <div className={inline ? 'choice-row' : ''}>
        {options.map((o) => (
          <div className="choice" key={o.value}>
            <input type="radio" id={`${base}-${o.value}`} name={name || base} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <label htmlFor={`${base}-${o.value}`}>{o.label}</label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export const Badge = ({ tone = 'neutral', children }) => <span className={`badge badge-${tone}`}>{children}</span>;

export function Alert({ tone = 'info', title, children, live = false }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : live ? 'status' : undefined}>
      {title && <div className="alert-title">{title}</div>}
      {children}
    </div>
  );
}

export const ErrorAlert = ({ error, title = 'Something went wrong' }) =>
  error ? (
    <Alert tone="danger" title={title}>
      <p>{error.message || String(error)}</p>
    </Alert>
  ) : null;

export const Loading = ({ label = 'Loading' }) => (
  <div className="loading" role="status">
    <span className="spinner" aria-hidden="true" /> {label}…
  </div>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-value">{value ?? '–'}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef([]);
  const onKey = (e, i) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.count !== undefined && ` (${t.count})`}
        </button>
      ))}
    </div>
  );
}

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((message) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
