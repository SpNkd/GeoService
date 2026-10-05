import type { Dispatch } from 'react';
import type { AiState, ApplicationAction } from '../ai/workflow';
import type { ViewSize } from '../geometry';
const labels={find_entities:'Найти',select_entities:'Выбрать',fit_result:'Вписать результат',isolate_result:'Изолировать',create_layer:'Создать слой',move_entities_to_layer:'Перенести в слой',set_layer_visibility:'Видимость слоёв'};
export function DocumentOperationsPreview({ai,dispatch,size,transactionActive}:{ai:Extract<AiState,{status:'document-preview'|'document-stale'}>;dispatch:Dispatch<ApplicationAction>;size:ViewSize;transactionActive:boolean}) {
  const {plan}=ai,disabled=ai.status==='document-stale'||transactionActive;
  return <div className="ai-preview" data-testid="document-operations-preview" data-status={ai.status}>
    <strong>Операции над документом</strong><p>{plan.text}</p>
    {plan.actions.map((action,i)=><div key={i} className="ai-action">
      <strong>{i+1}. {labels[action.intent.type]}</strong>
      {action.result&&<><p>Запрос: {action.result.querySummary}</p><p>Найдено: {action.result.entityIds.length} объектов · кандидатов: {action.result.evidence.size}</p>
        {action.result.groups.map(group=><label key={group.id} className="query-group">{action.result!.query.kind==='semantic_concept'&&<input type="checkbox" aria-label={`Включить ${group.source}`} checked={!action.excludedGroups.has(group.id)} disabled={disabled} onChange={e=>dispatch({type:'document-group',actionIndex:i,groupId:group.id,included:e.target.checked})}/>}<span>{group.source} · {group.entityIds.length} · {group.tier}<small>{group.reason}</small></span></label>)}
        <details><summary>Совпадения и пути</summary>{action.result.entityIds.slice(0,100).map(id=>{const entity=plan.basedOnDocument.entities.find(e=>e.id===id)!;return <div key={id} className="query-result"><b>{entity.name}</b><small>{entity.type} · {plan.basedOnDocument.layers.find(l=>l.id===entity.layerId)?.name} · DXF: {entity.source?.originalLayer??'—'}</small>{action.result!.evidence.get(id)?.map((e,j)=><small key={j}>{e.text??''} {e.tag??''} {e.path.join(' → ')}</small>)}</div>;})}</details>
      </>}
      {action.layerNames.length>0&&<p>{action.intent.type==='create_layer'?'Будет создан слой':action.intent.type==='move_entities_to_layer'?'Целевой слой':'Будет изменена видимость слоёв'}: {action.layerNames.join(', ')}</p>}
      {action.intent.type==='move_entities_to_layer'&&<p>Переносится владелец объекта. Геометрия и исходные DXF-слои сохраняются.</p>}
      {action.intent.type==='set_layer_visibility'&&<p>{action.intent.visible?'Показать':'Скрыть'}</p>}
      {action.blocked.map(reason=><p key={reason} className="ai-error">{reason}</p>)}
    </div>)}
    {plan.error&&<p className="ai-error" role="alert">{plan.error}</p>}
    {ai.notice&&<p role="status">{ai.notice}</p>}
    <div className="ai-actions"><button type="button" disabled={disabled||!plan.matchedEntityIds.length} onClick={()=>dispatch({type:'document-fit-preview',size})}>Показать на схеме</button><button type="button" className="primary-button" disabled={disabled||!!plan.error} onClick={()=>dispatch({type:'document-apply',size})}>{plan.actions.length===1&&plan.actions[0]?.intent.type==='select_entities'?'Выбрать':'Применить'}</button></div>
    {ai.status==='document-stale'&&<button type="button" disabled={transactionActive} onClick={()=>dispatch({type:'document-refresh'})}>Обновить preview</button>}
    {plan.commands.length>0&&<small>Undo: одно действие для всего пакета.</small>}
  </div>;
}
