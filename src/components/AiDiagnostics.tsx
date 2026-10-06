import { processDiagnostics } from '../process/plan';
import { documentRevision } from '../documentOperations/query';
import { normalizeQuery } from '../documentOperations/aliases';
import { useEffect, useState } from 'react';
import { diagnosticRing, redact, type AiDiagnostic } from '../ai/reliability';
import type { AiState } from '../ai/workflow';

/** Lazy-loaded only under import.meta.env.DEV. Ephemeral, no localStorage/document access. */
export default function AiDiagnostics({ record, ai }: { record: AiDiagnostic | null; ai: AiState }) {
  const [records, setRecords] = useState<AiDiagnostic[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => { if (record) setRecords(current => diagnosticRing(current, record)); }, [record]);
  useEffect(() => {
    if (ai.status==='process-preview'||ai.status==='process-stale'){const {plan}=ai;setRecords(current=>current.map(item=>item.traceId===plan.id?{...item,resolverStatus:plan.status,actionCount:plan.actions.length}:item));const controller=new AbortController();void fetch('/api/ai/resolution',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({traceId:plan.id,status:plan.status,actionCount:plan.actions.length})}).catch(()=>{});return()=>controller.abort();}
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
    {(ai.status==='document-preview'||ai.status==='document-stale')&&<pre data-testid="document-query-diagnostics">{JSON.stringify({traceId:ai.plan.id,documentRevision:documentRevision(ai.plan.basedOnDocument),operations:ai.plan.actions.map(a=>({operation:a.intent.type,query:a.result?.query,normalizedQuery:a.result?normalizeQuery(a.result.querySummary):null,matchedCount:a.result?.entityIds.length,groups:a.result?.groups.map(g=>({source:g.source,count:g.entityIds.length,reason:g.reason,tier:g.tier,included:!a.excludedGroups.has(g.id)})),ambiguity:a.result?.groups.some(g=>g.tier==='WEAK'),blocked:a.blocked})),status:ai.status},null,2)}</pre>}
    {(ai.status==='process-preview'||ai.status==='process-stale')&&<pre data-testid="process-diagnostics">{JSON.stringify(processDiagnostics(ai.plan),null,2)}</pre>}
    {[...records].reverse().map(item => <details key={item.traceId} data-testid="ai-diagnostic"><summary>{item.traceId} · {item.errorCode ?? item.resolverStatus} · {item.latencyMs} ms</summary>
      <pre>{JSON.stringify(redact(item), null, 2)}</pre></details>)}
  </details>;
}
