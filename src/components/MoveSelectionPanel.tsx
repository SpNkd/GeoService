import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { resolveSelectionMove } from '../domain/selectionMove';
import { absoluteMoveCommand, selectionModelAnchor, type MoveAnchor } from '../domain/exactMove';
import type { EditorAction, EditorState } from '../store/editor';
const anchors: [MoveAnchor,string][]=[['center','Центр выбора'],['bottom-left','Нижний левый'],['bottom-right','Нижний правый'],['top-left','Верхний левый'],['top-right','Верхний правый']];
export function MoveSelectionPanel({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const [x,setX]=useState('0'),[y,setY]=useState('0'),[mode,setMode]=useState<'relative'|'absolute'>('relative'),[anchor,setAnchor]=useState<MoveAnchor>('center'),firstInput=useRef<HTMLInputElement>(null);
  const resolution=useMemo(()=>{
    try { return {plan:resolveSelectionMove(state.document,state.selectedEntityIds),error:null}; }
    catch(error) { return {plan:null,error:error instanceof Error?error.message:'Нельзя переместить выбор'}; }
  },[state.document,state.selectedEntityIds]);
  useEffect(()=>{if(state.moveInputOpen){firstInput.current?.focus();firstInput.current?.select();}},[state.moveInputOpen,state.moveInputFocusEpoch,mode]);
  if(state.deepSelection) return null;
  if(!state.selectedEntityIds.length&&!state.moveInputOpen) return null;
  if(!state.moveInputOpen) return <div className="property-section move-selection"><button className="secondary-action" onClick={()=>dispatch({type:'open-move-input'})}>Переместить… · M</button></div>;
  let command=null;
  if(resolution.plan&&x.trim()&&y.trim()&&Number.isFinite(Number(x))&&Number.isFinite(Number(y))) {
    try { command=mode==='absolute'?absoluteMoveCommand(state.document,state.selectedEntityIds,{x:Number(x),y:Number(y)},anchor):{type:'move-entities' as const,entityIds:resolution.plan.entityIds,delta:{x:Number(x),y:Number(y)}}; } catch { /* Resolution error is displayed below. */ }
  }
  const valid=command?.type==='move-entities'&&(command.delta.x!==0||command.delta.y!==0);
  const reset=(nextMode:typeof mode,nextAnchor=anchor)=>{
    setMode(nextMode);setAnchor(nextAnchor);
    if(nextMode==='relative'){setX('0');setY('0');return;}
    try {const p=selectionModelAnchor(state.document,state.selectedEntityIds,nextAnchor);setX(String(p.x));setY(String(p.y));}catch{setX('0');setY('0');}
  };
  return <form className="property-section move-selection" aria-label="Перемещение выбора" onSubmit={event=>{
    event.preventDefault();if(!command||!valid||state.transactionBefore)return;
    dispatch({type:'execute',expectedDocument:state.document,command});if(mode==='relative'){setX('0');setY('0');}
  }} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dispatch({type:'close-move-input'});}}}>
    <h3>Переместить выбор · {state.selectedEntityIds.length}</h3>
    <div className="move-mode"><button type="button" aria-pressed={mode==='relative'} onClick={()=>reset('relative')}>Δ Смещение</button><button type="button" aria-pressed={mode==='absolute'} onClick={()=>reset('absolute')}>X/Y Абсолютно</button></div>
    {mode==='absolute'&&<label>Базовая точка<select aria-label="Базовая точка" value={anchor} onChange={e=>reset('absolute',e.target.value as MoveAnchor)}>{anchors.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}
    <label>{mode==='relative'?'ΔX':'MODEL X'} (м)<input ref={firstInput} aria-label={mode==='relative'?'Перемещение ΔX':'Перемещение MODEL X'} type="number" step="any" value={x} onChange={e=>setX(e.target.value)}/></label>
    <label>{mode==='relative'?'ΔY':'MODEL Y'} (м)<input aria-label={mode==='relative'?'Перемещение ΔY':'Перемещение MODEL Y'} type="number" step="any" value={y} onChange={e=>setY(e.target.value)}/></label>
    {resolution.error&&<p className="read-only-banner">{resolution.error}</p>}
    {Boolean(resolution.plan?.affectedEntityIds.length)&&<p className="property-note">Перемещение затронет {resolution.plan!.affectedEntityIds.length} связанных объектов.</p>}
    <p className="property-note">MODEL · метры. Размеры следуют за своими опорами. Absolute задаёт позицию базовой точки в MODEL, включая режим SURVEY.</p>
    <button type="submit" className="secondary-action" disabled={!valid||Boolean(state.transactionBefore)}>Применить перемещение</button>
    <button type="button" className="tool-button compact" onClick={()=>dispatch({type:'close-move-input'})}>Закрыть перемещение</button>
  </form>;
}
