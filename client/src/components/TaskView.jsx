import { Badge } from './ui.jsx';

// Renders the engine's structured output: fields (Task, Due, Done when, Check-in),
// numbered steps, details and notes.
export function TaskSections({ sections = [] }) {
  return sections.map((s, i) => {
    const key = `${s.key}-${i}`;
    if (s.type === 'heading') return <h3 key={key}>{s.text}</h3>;
    if (s.type === 'divider') return <hr key={key} />;
    if (s.type === 'field')
      return (
        <dl className="task-field" key={key}>
          <dt>{s.label}</dt>
          <dd>{s.text}</dd>
        </dl>
      );
    if (s.type === 'list')
      return (
        <div key={key}>
          <strong>{s.label}</strong>
          <ol>
            {s.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        </div>
      );
    if (s.type === 'text')
      return (
        <div key={key}>
          {s.label && <strong>{s.label}</strong>}
          {s.items.map((p, j) => (
            <p key={j} style={{ margin: '0.2rem 0 0.4rem' }}>
              {p}
            </p>
          ))}
        </div>
      );
    if (s.type === 'note')
      return (
        <p className="task-note" key={key}>
          {s.text}
        </p>
      );
    return null;
  });
}

export function TaskCards({ cards = [], label = 'Task in your agreed format' }) {
  return (
    <div className="stack" aria-label={label}>
      {cards.map((c) => (
        <article className="task" key={c.index}>
          {cards.length > 1 && <p className="muted small">Message {c.index + 1} of {cards.length}</p>}
          <TaskSections sections={c.sections} />
        </article>
      ))}
    </div>
  );
}

export function OriginalText({ text }) {
  return (
    <article className="task original">
      <p className="task-original">{text}</p>
    </article>
  );
}

export function RuleChips({ rules = [] }) {
  if (!rules.length) return <p className="muted">No rules changed this task.</p>;
  return (
    <ul className="list">
      {rules.map((r) => (
        <li key={r.code} className="list-item" style={{ padding: '0.4rem 0' }}>
          <span>
            <Badge tone="info">{r.name}</Badge>
          </span>
          <span className="muted small">{r.effect || r.reason}</span>
        </li>
      ))}
    </ul>
  );
}

export function ValidatorPanel({ validator }) {
  if (!validator) return null;
  return (
    <div>
      <p>
        {validator.passed ? (
          <Badge tone="success">Outcome check passed</Badge>
        ) : (
          <Badge tone="warning">Outcome check failed: held for the manager to check</Badge>
        )}
      </p>
      <ul className="check-list">
        {validator.checks.map((c) => (
          <li key={c.key}>
            <span className={c.passed ? 'check-ok' : 'check-fail'} aria-hidden="true">
              {c.passed ? '✓' : '✗'}
            </span>
            <span>
              {c.label}
              <span className="visually-hidden">{c.passed ? ': passed' : ': failed'}</span>
              {!c.passed && c.detail && <span className="muted small"> ({c.detail})</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DualView({ original, cards, originalLabel = 'Original brief', translatedLabel = 'What they receive' }) {
  return (
    <div className="dual">
      <div>
        <h3>{originalLabel}</h3>
        <OriginalText text={original} />
      </div>
      <div>
        <h3>{translatedLabel}</h3>
        <TaskCards cards={cards} />
      </div>
    </div>
  );
}
