import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Card, ErrorAlert, Loading, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';

const TYPE = {
  transform: { label: 'Changes how tasks are written', tone: 'info' },
  schedule: { label: 'Sends timed prompts', tone: 'info' },
  record: { label: 'Recorded and reviewed only', tone: 'neutral' },
};

export function RuleCard({ rule }) {
  return (
    <article className="rule-card">
      <h3>{rule.name}</h3>
      <p>{rule.summary}</p>
      <div className="rule-meta">
        <Badge tone={TYPE[rule.type]?.tone}>{TYPE[rule.type]?.label}</Badge>
        {rule.typicalCost && <Badge>{rule.typicalCost}</Badge>}
        {rule.accessToWork && <Badge tone="success">Access to Work may help</Badge>}
      </div>
      {rule.changes && <p className="small"><strong>What it changes:</strong> {rule.changes}</p>}
      {rule.neverChanges && <p className="small"><strong>What it never changes:</strong> {rule.neverChanges}</p>}
      <p className="small muted">{rule.reviewedBy ? `Reviewed by ${rule.reviewedBy}` : rule.source}</p>
    </article>
  );
}

export default function RuleLibrary() {
  const { data, isLoading, error } = useQuery({ queryKey: ['rules'], queryFn: () => api.get('/api/rules') });
  const [search, setSearch] = useState('');
  if (isLoading) return <Loading />;
  const q = search.trim().toLowerCase();
  const rules = (data?.rules || []).filter((r) => !q || `${r.name} ${r.summary}`.toLowerCase().includes(q));
  return (
    <>
      <PageHeader title="Rule library" intro="Work-format rules describe what helps, not why. Each one says exactly what it changes in a task and what it never changes." />
      <ErrorAlert error={error} />
      <div className="field" style={{ maxWidth: '28rem' }}>
        <label htmlFor="rule-search">Search the library</label>
        <input id="rule-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {Object.entries(data?.groups || {}).map(([group, label]) => {
        const inGroup = rules.filter((r) => r.group === group);
        if (!inGroup.length) return null;
        return (
          <Card key={group} title={label}>
            <div className="grid two">
              {inGroup.map((r) => (
                <RuleCard key={r.code} rule={r} />
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}
