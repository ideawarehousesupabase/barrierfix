import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Card, ErrorAlert, Loading, PageHeader, Tabs } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { BriefList } from './Inbox.jsx';

export default function Sent() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'held' ? 'held' : 'sent';
  const sent = useQuery({ queryKey: ['briefs', 'sent'], queryFn: () => api.get('/api/briefs?box=sent&limit=200') });
  const held = useQuery({ queryKey: ['briefs', 'held'], queryFn: () => api.get('/api/briefs?box=held&limit=200') });
  const current = tab === 'held' ? held : sent;
  return (
    <>
      <PageHeader title="Sent tasks" intro="Tasks you have sent and how each person responded. Open a task to see your brief and their version side by side." />
      <Card>
        <Tabs label="Sent task lists" value={tab} onChange={(id) => setParams(id === 'held' ? { tab: 'held' } : {})} tabs={[{ id: 'sent', label: 'All sent', count: sent.data?.briefs.length }, { id: 'held', label: 'Waiting for your check', count: held.data?.briefs.length }]} />
        {current.isLoading ? <Loading /> : <BriefList briefs={current.data?.briefs || []} perspective="manager" />}
        <ErrorAlert error={current.error} />
      </Card>
    </>
  );
}
