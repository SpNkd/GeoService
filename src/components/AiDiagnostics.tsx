import { useEffect, useState } from 'react';
import { diagnosticRing, redact, type AiDiagnostic } from '../ai/reliability';
import type { AiState } from '../ai/workflow';

/** Lazy-loaded only under import.meta.env.DEV. Ephemeral, no localStorage/document access. */
export default function AiDiagnostics({ record, ai }: { record: AiDiagnostic | null; ai: AiState }) {
  const [records, setRecords] = useState<AiDiagnostic[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => { if (record) setRecords(current => diagnosticRing(current, record)); }, [record]);
  useEffect(() => {
    if (ai.status !== 'preview' && ai.status !== 'stale') return;
    const { plan } = ai;
    setRecords(current => current.map(item => item.traceId === plan.id ? { ...item, resolverStatus: plan.resolution.status, actionCount: plan.actions.length, ...(plan.resolution.status === 'invalid' ? { errorCode: 'LOCAL_VALIDATION_ERROR' as const } : {}) } : item));
    const controller = new AbortController();
    void fetch('/api/ai/resolution', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceId: plan.id, status: plan.resolution.status, actionCount: plan.actions.length }) }).catch(() => {});
    return () => controller.abort();
  }, [ai]);
  const copy = async () => { try { await navigator.clipboard.writeText(JSON.stringify(redact(records), null, 2)); setCopyStatus('Скопировано'); } catch { setCopyStatus('Копирование недоступно'); } };
  return <details className="ai-diagnostics" data-testid="ai-diagnostics"><summary>AI Diagnostics · {records.length}/20</summary>
    <button type="button" className="tool-button compact" onClick={() => void copy()}>Copy diagnostics</button><span role="status">{copyStatus}</span>
    {[...records].reverse().map(item => <details key={item.traceId} data-testid="ai-diagnostic"><summary>{item.traceId} · {item.errorCode ?? item.resolverStatus} · {item.latencyMs} ms</summary>
      <pre>{JSON.stringify(redact(item), null, 2)}</pre></details>)}
  </details>;
}
