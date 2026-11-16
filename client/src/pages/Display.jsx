import { Card, Checkbox, Field, PageHeader, RadioGroup } from '../components/ui.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';

export default function Display() {
  const { prefs, update } = usePrefs();
  return (
    <>
      <PageHeader title="Display settings" intro="Make BarrierFix easier to read. Your settings are saved to your account and used on every device." />
      <Card>
        <Field label={`Text size: ${Math.round(prefs.textScale * 100)}%`}>
          {(a) => <input {...a} type="range" min="0.9" max="1.5" step="0.05" value={prefs.textScale} onChange={(e) => update({ textScale: Number(e.target.value) })} style={{ width: '100%', maxWidth: '24rem' }} />}
        </Field>
        <RadioGroup legend="Contrast" inline value={prefs.contrast} onChange={(v) => update({ contrast: v })} options={[{ value: 'normal', label: 'Standard' }, { value: 'high', label: 'High contrast' }]} />
        <RadioGroup legend="Font" inline value={prefs.font} onChange={(v) => update({ font: v })} options={[{ value: 'default', label: 'Standard' }, { value: 'readable', label: 'Easy-read font (Atkinson Hyperlegible)' }]} />
        <Checkbox label="Reduce motion (no animations)" checked={prefs.reduceMotion} onChange={(e) => update({ reduceMotion: e.target.checked })} />
      </Card>
      <Card title="Preview">
        <article className="task">
          <dl className="task-field"><dt>Task</dt><dd>Pull together the Q3 review deck for Harbour &amp; Co</dd></dl>
          <dl className="task-field"><dt>Due</dt><dd>Thursday 24 September at 5pm</dd></dl>
        </article>
      </Card>
    </>
  );
}
