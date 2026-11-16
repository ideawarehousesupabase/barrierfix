import { useId, useState } from 'react';
import { downloadText } from '../lib/api.js';
import { Button } from './ui.jsx';

// File picker that reads a CSV in the browser and hands its text to onUpload.
export function CsvUpload({ label = 'CSV file', hint, template, templateName = 'template.csv', onUpload, busy, buttonLabel = 'Upload' }) {
  const id = useId();
  const [file, setFile] = useState(null);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="row">
        <input id={id} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <Button busy={busy} disabled={!file} onClick={async () => onUpload(await file.text(), file.name)}>
          {buttonLabel}
        </Button>
        {template && (
          <Button variant="ghost" onClick={() => downloadText(template, templateName)}>
            Download template
          </Button>
        )}
      </div>
    </div>
  );
}
