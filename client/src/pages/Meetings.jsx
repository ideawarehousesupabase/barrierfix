import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Empty, ErrorAlert, Field, Loading, PageHeader, Tabs, TextArea, TextInput, useToast } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';

const toLocalInput = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};

function MeetingForm({ people, onSaved }) {
  const start = new Date(Date.now() + 2 * 86400000);
  start.setHours(10, 0, 0, 0);
  const [form, setForm] = useState({ title: '', startsAt: toLocalInput(start), endsAt: toLocalInput(start.getTime() + 3600000), agenda: '', attendeeIds: [] });
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.post('/api/meetings', { ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() }),
    onSuccess: () => {
      toast('Meeting logged. BarrierFix will send any agreed agenda and summary prompts.');
      setForm((f) => ({ ...f, title: '', agenda: '', attendeeIds: [] }));
      onSaved();
    },
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <TextInput label="Meeting title" value={form.title} onChange={set('title')} required />
      <div className="grid two">
        <Field label="Starts">{(a) => <input {...a} type="datetime-local" value={form.startsAt} onChange={set('startsAt')} required />}</Field>
        <Field label="Ends">{(a) => <input {...a} type="datetime-local" value={form.endsAt} onChange={set('endsAt')} required />}</Field>
      </div>
      <fieldset className="field">
        <legend>Who is coming?</legend>
        <div className="grid three">
          {people.map((p) => (
            <Checkbox key={p._id} label={p.name} checked={form.attendeeIds.includes(p._id)} onChange={(e) => setForm((f) => ({ ...f, attendeeIds: e.target.checked ? [...f.attendeeIds, p._id] : f.attendeeIds.filter((x) => x !== p._id) }))} />
          ))}
        </div>
      </fieldset>
      <TextArea label="Agenda (optional, you can add it later)" value={form.agenda} onChange={set('agenda')} />
      <ErrorAlert error={save.error} />
      <Button type="submit" busy={save.isPending} disabled={!form.title.trim()}>Log meeting</Button>
    </form>
  );
}

function MeetingCard({ meeting, isOrganizer, onChange }) {
  const [agenda, setAgenda] = useState(meeting.agenda);
  const [summary, setSummary] = useState(meeting.summary);
  const [results, setResults] = useState(null);
  const toast = useToast();
  const call = useMutation({
    mutationFn: ({ method = 'post', path, body }) => api[method](`/api/meetings/${meeting._id}${path}`, body),
    onSuccess: (res, vars) => {
      if (res.results) setResults(res.results);
      toast(vars.message);
      onChange();
    },
  });
  return (
    <article className="card inset">
      <div className="spread">
        <h3>{meeting.title}</h3>
        <div className="row">
          {meeting.cancelledAt && <Badge>Cancelled</Badge>}
          {meeting.agendaSharedAt && <Badge tone="success">Agenda shared</Badge>}
          {meeting.summarySentAt && <Badge tone="success">Summary sent</Badge>}
        </div>
      </div>
      <p className="muted">
        {fmtDateTime(meeting.startsAt)} to {fmtDateTime(meeting.endsAt)} · organised by {meeting.organizerName} · {meeting.attendees.map((a) => a.name).join(', ') || 'no attendees'}
      </p>
      {!isOrganizer ? (
        <>
          {meeting.agenda && <><strong>Agenda</strong><p style={{ whiteSpace: 'pre-wrap' }}>{meeting.agenda}</p></>}
          {meeting.summary && <><strong>Summary</strong><p style={{ whiteSpace: 'pre-wrap' }}>{meeting.summary}</p></>}
        </>
      ) : (
        !meeting.cancelledAt && (
          <>
            <TextArea label="Agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} />
            <div className="actions">
              <Button variant="secondary" size="small" onClick={() => call.mutate({ method: 'patch', path: '', body: { agenda }, message: 'Agenda saved' })}>Save agenda</Button>
              <Button variant="secondary" size="small" disabled={!agenda.trim()} onClick={() => call.mutate({ path: '/share-agenda', message: 'Agenda shared with attendees' })}>Share agenda now</Button>
            </div>
            <TextArea label="Written summary" hint="Attendees with an agreed profile receive it in their own format; others get it as written." value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
            <div className="actions">
              <Button size="small" disabled={summary.trim().length < 5} busy={call.isPending && call.variables?.path === '/summary'} onClick={() => call.mutate({ path: '/summary', body: { summary }, message: 'Summary sent' })}>Send summary</Button>
              <Button variant="danger" size="small" onClick={() => window.confirm('Cancel this meeting?') && call.mutate({ path: '/cancel', message: 'Meeting cancelled' })}>Cancel meeting</Button>
            </div>
            {results && <p className="small">{results.map((r) => `${r.name}: ${r.formatted ? 'sent in agreed format' : 'sent as written'}`).join(' · ')}</p>}
          </>
        )
      )}
      <ErrorAlert error={call.error} />
    </article>
  );
}

export default function Meetings() {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('upcoming');
  const meetings = useQuery({ queryKey: ['meetings', tab], queryFn: () => api.get(`/api/meetings?range=${tab}`) });
  const people = useQuery({ queryKey: ['directory'], queryFn: () => api.get('/api/users/directory') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['meetings'] });
  const canOrganise = hasRole('manager', 'hr', 'admin');
  return (
    <>
      <PageHeader title="Meetings" intro="Log meetings here so BarrierFix can send an agenda a day ahead and prompt for a written summary afterwards, for anyone who has agreed those adjustments." />
      {canOrganise && (
        <Card title="Log a meeting">
          <MeetingForm people={(people.data?.users || []).filter((p) => String(p._id) !== String(user._id))} onSaved={refresh} />
        </Card>
      )}
      <Card>
        <Tabs label="Meeting lists" value={tab} onChange={setTab} tabs={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }]} />
        {meetings.isLoading && <Loading />}
        <ErrorAlert error={meetings.error} />
        {meetings.data && !meetings.data.meetings.length && <Empty>No meetings.</Empty>}
        <div className="stack">
          {(meetings.data?.meetings || []).map((m) => (
            <MeetingCard key={`${m._id}-${m.updatedAt}`} meeting={m} isOrganizer={String(m.organizerId) === String(user._id)} onChange={refresh} />
          ))}
        </div>
      </Card>
    </>
  );
}
