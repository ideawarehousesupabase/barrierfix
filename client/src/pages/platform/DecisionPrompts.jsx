import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, ErrorAlert, Loading, PageHeader, TextArea, TextInput, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { fmtDateTime } from '../../lib/format.js';

// The decision prompts and guidance. Each save is a new version; earlier versions are kept, and
// each Decision Record shows the version it was completed with.
export default function DecisionPrompts() {
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['platform', 'decision-prompts'], queryFn: () => api.get('/api/platform/decision-prompts'), enabled: isPlatformAdmin });
  const latest = data?.promptSets?.[0];
  const [factors, setFactors] = useState([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  useEffect(() => {
    if (latest) {
      setFactors(latest.factors.map((f) => ({ key: f.key, title: f.title, prompt: f.prompt, help: f.help || '' })));
      setDisclaimer(latest.disclaimer);
    }
  }, [latest?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => api.post('/api/platform/decision-prompts', { changeNote, disclaimer, factors, effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined }),
    onSuccess: (res) => {
      toast(`Version ${res.promptSet.version} saved`);
      setChangeNote('');
      setEffectiveFrom('');
      qc.invalidateQueries({ queryKey: ['platform', 'decision-prompts'] });
      qc.invalidateQueries({ queryKey: ['decision-meta'] });
    },
  });
  if (!isPlatformAdmin) return <Alert tone="danger">Platform admins only.</Alert>;
  if (isLoading) return <Loading />;
  const setFactor = (i, patch) => setFactors((list) => list.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  return (
    <>
      <PageHeader title="Decision prompts" intro="The six questions someone answers when HR sends a rejected adjustment request back to them. Changing them creates a new version; existing requests keep the wording they started with. Wording should be agreed with the employment law adviser first." />
      <ErrorAlert error={error || save.error} />
      <Card title={`New version (current is version ${latest?.version})`}>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {factors.map((f, i) => (
            <div className="card inset" key={f.key}>
              <TextInput label={`Factor ${i + 1} title`} value={f.title} onChange={(e) => setFactor(i, { title: e.target.value })} />
              <TextArea label="Prompt" value={f.prompt} onChange={(e) => setFactor(i, { prompt: e.target.value })} rows={3} />
              <TextArea label="Guidance" value={f.help} onChange={(e) => setFactor(i, { help: e.target.value })} rows={2} />
            </div>
          ))}
          <TextArea label="Disclaimer shown on every record" value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} rows={3} />
          <TextInput label="What changed and why" hint="For example: reworded after legal review on 3 November." value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
          <TextInput label="Effective from (optional)" type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} hint="Leave blank to use it straight away." />
          <Button type="submit" busy={save.isPending} disabled={changeNote.trim().length < 3}>Save as a new version</Button>
        </form>
      </Card>
      <Card title="History">
        <ol reversed>
          {(data?.promptSets || []).map((p) => (
            <li key={p.version}>
              <strong>Version {p.version}</strong> {p.version === latest.version && <Badge tone="success">Latest</Badge>} {/* The first version is stored as effective from 1970 so it always applies; that date means nothing to people. */}
              {new Date(p.effectiveFrom).getTime() === 0 ? 'effective from the start' : `effective ${fmtDateTime(p.effectiveFrom)}`}, by {p.createdBy}: {p.changeNote}
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
