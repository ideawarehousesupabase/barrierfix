import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert } from './ui.jsx';

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api.get('/api/meta'), staleTime: Infinity });
}

// BarrierFix holds ways of working, never diagnoses: warns as soon as text looks medical.
export function MedicalWarning({ text }) {
  const { data } = useMeta();
  if (!text || !data?.medicalTerms) return null;
  const lower = ` ${String(text).toLowerCase()} `;
  const found = data.medicalTerms.filter((t) => new RegExp(`[^a-z]${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[^a-z]`).test(lower));
  if (!found.length) return null;
  return (
    <Alert tone="warning" title="Please leave out health information" live>
      <p>
        This may include medical details ({found.slice(0, 3).join(', ')}). BarrierFix only needs to know what helps you work, not why. Try describing the way of working instead, for example
        &ldquo;written instructions with a clear deadline&rdquo;.
      </p>
    </Alert>
  );
}
