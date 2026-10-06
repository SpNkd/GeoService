import type { ViewSize } from '../geometry';
import type { Dispatch } from 'react';
import type { AiState, ApplicationAction } from '../ai/workflow';
import { requireSymbol } from '../symbols/registry';
import { resolvePort } from '../connectors/model';
export function ProcessPreview({ai,dispatch,transactionActive,size}:{ai:Extract<AiState,{status:'process-preview'|'process-stale'}>;dispatch:Dispatch<ApplicationAction>;transactionActive:boolean;size:ViewSize}){
  const {plan}=ai,disabled=ai.status!=='process-preview'||transactionActive;
  return <div className="ai-preview" data-testid="process-preview" data-status={ai.status}>
    <strong>Технологическая схема · preview</strong><p>{plan.text}</p>
    <p>Будет создано: Symbols {plan.symbols.length} · Connectors {plan.connectors.length} · команд {plan.commands.length}</p>
    <label>Слой новых объектов<select aria-label="Слой новых объектов" value={plan.targetLayerId} disabled={disabled} onChange={e=>dispatch({type:'ai-target-layer',layerId:e.target.value})}>{!plan.basedOnDocument.layers.some(l=>l.id===plan.targetLayerId&&l.visible&&!l.locked)&&<option value={plan.targetLayerId}>Выберите доступный слой</option>}{plan.basedOnDocument.layers.filter(l=>l.visible&&!l.locked).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <p>Автоматическое расположение: слева направо; append по направлению выхода; insert в середине соединения. Routing: orthogonal; insert сохраняет routing, стиль и слой заменяемого Connector. Без обхода препятствий.</p>
    <ol>{plan.symbols.map(e=><li key={e.id}>{e.name} · {requireSymbol(e.libraryId,e.symbolId).name} · {e.libraryId}@{e.libraryVersion} · X {e.position.x.toFixed(2)}, Y {e.position.y.toFixed(2)}</li>)}</ol>
    <ul>{plan.connectors.map(e=><li key={e.id}>{e.name} · {resolvePort(plan.projectedDocument!,e.start).port.role??'process'} → {resolvePort(plan.projectedDocument!,e.end).port.role??'process'} · {e.routing} · слой {plan.basedOnDocument.layers.find(l=>l.id===e.layerId)?.name}</li>)}</ul>
    {plan.removedConnectorIds.length>0&&<p>Будет заменено соединений: {plan.removedConnectorIds.length}. Весь пакет отменяется одним Undo.</p>}
    {plan.issues.map(issue=><label key={issue.key}>{issue.label}<select aria-label={`Разрешить ${issue.key}`} value={plan.choices.get(issue.key)??''} disabled={disabled} onChange={e=>dispatch({type:'ai-choose',name:issue.key,entityId:e.target.value})}><option value="" disabled>Выберите вариант</option>{issue.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>)}
    {plan.message&&<p className="ai-error" role="alert">{plan.message}</p>}{ai.notice&&<p role="status">{ai.notice}</p>}
    <div className="ai-actions"><button disabled={disabled||plan.status!=='ready'} onClick={()=>dispatch({type:'process-fit-preview',size})}>Вписать preview</button><button className="primary-button" disabled={disabled||plan.status!=='ready'} onClick={()=>dispatch({type:'process-apply'})}>Apply {plan.commands.length} changes</button>{ai.status==='process-stale'&&<button disabled={transactionActive} onClick={()=>dispatch({type:'process-refresh'})}>Пересчитать план</button>}</div>
  </div>;
}
