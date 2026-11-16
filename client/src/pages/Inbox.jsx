import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorAlert, Loading, PageHeader, Tabs } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { SOURCE_LABELS, TASK_STATUS, fmtDateTime, fmtRelative } from '../lib/format.js';

export function BriefList({ briefs, perspective }) {
  if (!briefs.length) return <Empty>No tasks here.</Empty>;
  return (
    <ul className="list">
      {briefs.map((b) => (
        <li key={b._id} className="list-item">
          <div>
            <Link className="title" to={`/tasks/${b._id}`}>
              {b.title}
            </Link>
            {b.taskCount > 1 && <span className="muted"> (+{b.taskCount - 1} more)</span>}
            <div className="muted small">
              {perspective === 'employee' ? `From ${b.managerName}` : `To ${b.employeeName}`} · {SOURCE_LABELS[b.source]} · {fmtRelative(b.createdAt)}
              {b.deadline && ` · Due ${fmtDateTime(b.deadline)}`}
            </div>
          </div>
          <div className="row">
            {perspective === 'manager' && b.status === 'held' && <Badge tone="warning">Needs your check</Badge>}
            {b.openQuestions && <Badge tone="warning">Open question</Badge>}
            <Badge tone={TASK_STATUS[b.employeeStatus]?.tone}>{TASK_STATUS[b.employeeStatus]?.label}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Inbox() {
  const [tab, setTab] = useState('todo');
  const { data, isLoading, error } = useQuery({ queryKey: ['briefs', 'inbox'], queryFn: () => api.get('/api/briefs?box=inbox&limit=200') });
  const all = data?.briefs || [];
  const todo = all.filter((b) => ['new', 'seen', 'question'].includes(b.employeeStatus));
  const done = all.filter((b) => ['confirmed', 'flagged'].includes(b.employeeStatus));
  const shown = tab === 'todo' ? todo : tab === 'done' ? done : all;
  return (
    <>
      <PageHeader title="My tasks" intro="Tasks from your managers, in the format you agreed. Each task's text is kept for 30 days." />
      <Card>
        <Tabs label="Task lists" value={tab} onChange={setTab} tabs={[{ id: 'todo', label: 'To do', count: todo.length }, { id: 'done', label: 'Done', count: done.length }, { id: 'all', label: 'All', count: all.length }]} />
        {isLoading ? <Loading /> : <BriefList briefs={shown} perspective="employee" />}
        <ErrorAlert error={error} />
      </Card>
    </>
  );
}
