import '../semantics/learning.css';
import { useMemo, useState, type Dispatch } from 'react';
import type { EditorAction, EditorState } from '../store/editor';
import { conceptsFor } from '../semantics/concepts';
import { emptyKnowledge, type SemanticAnnotation } from '../semantics/model';
import { learnedMatches } from '../semantics/learning';
import { getSymbol } from '../symbols/registry';
export function SemanticProperties({state,dispatch,onTeach}:{state:EditorState;dispatch:Dispatch<EditorAction>;onTeach?:(()=>void)|undefined}) {
  const concepts=useMemo(()=>conceptsFor(state.document),[state.document]),[conceptId,setConceptId]=useState('pipe');
  const chosenConcept=concepts.some(c=>c.id===conceptId)?conceptId:'pipe';
  const owners=state.selectedEntityIds,blocked=!!state.transactionBefore||!!state.deepSelection||!owners.length;
  const tags=useMemo(()=>{if(owners.length!==1||!state.document.semantics)return [];const id=owners[0]!;return concepts.flatMap(c=>{const matches=learnedMatches(state.document,c.id).filter(m=>m.entityId===id&&m.tier!=='WEAK');return matches.length?[{concept:c,matches}]:[];});},[concepts,owners,state.document]);
  if(!owners.length)return null;
  const annotate=(id:string,polarity:SemanticAnnotation['polarity']|null)=>{const knowledge=state.document.semantics??emptyKnowledge(),selected=new Set(owners);const annotations=knowledge.annotations.filter(a=>a.conceptId!==id||!selected.has(a.entityId));if(polarity)for(const entityId of selected)annotations.push({entityId,conceptId:id,polarity,source:'user-explicit'});dispatch({type:'execute',command:{type:'set-semantic-knowledge',knowledge:{...knowledge,annotations}}});};
  const entity=state.document.entities.find(e=>e.id===owners[0]),symbol=entity?.type==='symbol'?getSymbol(entity.libraryId,entity.symbolId):null;
  return <details className="property-section semantic-properties" data-testid="semantic-properties"><summary>Смысл · {tags.length}</summary>
    <small>Категории текущего документа · геометрия не меняется</small>
    {symbol&&<p>Символ библиотеки: {symbol.name} · {entity?.type==='symbol'?entity.symbolId:''}</p>}
    {tags.map(({concept,matches})=><div className="semantic-tag" key={concept.id}><strong>{concept.name}</strong><small>{matches.some(m=>m.origin==='explicit')?'Явно подтверждено':matches.some(m=>m.tier==='EXACT')?'EXACT · правило':'STRONG · правило'}</small><details><summary>Почему найдено</summary>{[...new Set(matches.flatMap(m=>m.reasons))].map(reason=><p key={reason}>{reason}</p>)}</details><button disabled={blocked} onClick={()=>annotate(concept.id,null)}>Убрать явную метку</button><button disabled={blocked} onClick={()=>annotate(concept.id,'negative')}>Это НЕ {concept.name}</button></div>)}
    <label>Категория<select aria-label="Категория объекта" value={chosenConcept} onChange={e=>setConceptId(e.target.value)}>{concepts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <button disabled={blocked} onClick={()=>annotate(chosenConcept,'positive')}>Добавить значение</button>
    <button disabled={blocked||!onTeach} onClick={onTeach}>Научить по выбору</button>
  </details>;
}
