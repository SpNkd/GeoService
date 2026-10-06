import { useEffect, useState, type Dispatch } from 'react';
import type { GeoDocument, SymbolEntity } from '../domain/model';
import type { EditorAction } from '../store/editor';
import { requireSymbol } from '../symbols/registry';
import { MAX_SYMBOL_SCALE, MIN_SYMBOL_SCALE, normalizeSymbolRotation } from '../symbols/types';
import { documentSurveyXY } from '../geometry/georeferencing';
import { formatCoordinate } from '../geometry/format';
import { absoluteMoveCommand } from '../domain/exactMove';
function NumericField({label,value,min,max,disabled,onCommit}:{label:string;value:number;min?:number;max?:number;disabled:boolean;onCommit:(v:number)=>void}) {
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  const number=Number(draft),valid=Boolean(draft.trim())&&Number.isFinite(number)&&(min===undefined||number>=min)&&(max===undefined||number<=max);
  const commit=()=>{if(valid&&number!==value)onCommit(number);if(!valid)setDraft(String(value));};
  return <label className="coordinate-field"><span>{label}</span><input aria-label={label} type="number" step="any" min={min} max={max} value={draft} disabled={disabled} aria-invalid={!valid} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>;
}
export function SymbolProperties({entity,document,locked,dispatch}:{entity:SymbolEntity;document:GeoDocument;locked:boolean;dispatch:Dispatch<EditorAction>}) {
  const definition=requireSymbol(entity.libraryId,entity.symbolId),survey=documentSurveyXY(document,entity.position);
  const [name,setName]=useState(entity.name);
  useEffect(()=>setName(entity.name),[entity.name]);
  const position=(axis:'x'|'y',value:number)=>{try{dispatch({type:'execute',expectedDocument:document,command:absoluteMoveCommand(document,[entity.id],{...entity.position,[axis]:value})});}catch(error){dispatch({type:'report-error',message:error instanceof Error?error.message:'Нельзя переместить символ'});}};
  return <div className="property-section"><h3>Символ</h3><dl className="property-facts"><dt>Определение</dt><dd>{definition.name}</dd><dt>Библиотека</dt><dd>{entity.libraryId}</dd></dl>
    <label>Имя / Tag<input aria-label="Имя / Tag" value={name} disabled={locked} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name!==entity.name)dispatch({type:'execute',command:{type:'update-entity',entityId:entity.id,patch:{name:name.trim()}}});else setName(entity.name);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
    <NumericField label="Поворот (°)" value={entity.rotationDeg} disabled={locked} onCommit={rotationDeg=>dispatch({type:'execute',command:{type:'update-entity',entityId:entity.id,patch:{rotationDeg:normalizeSymbolRotation(rotationDeg)}}})}/>
    <NumericField label="Масштаб символа" value={entity.scale} min={MIN_SYMBOL_SCALE} max={MAX_SYMBOL_SCALE} disabled={locked} onCommit={scale=>dispatch({type:'execute',command:{type:'update-entity',entityId:entity.id,patch:{scale}}})}/>
    <p className="property-note">Масштаб {MIN_SYMBOL_SCALE}–{MAX_SYMBOL_SCALE} изменяет изображение. Поворот относительно MODEL осей.</p>
    <NumericField label="MODEL X" value={entity.position.x} disabled={locked} onCommit={v=>position('x',v)}/><NumericField label="MODEL Y" value={entity.position.y} disabled={locked} onCommit={v=>position('y',v)}/>
    {survey&&<dl className="property-facts"><dt>SURVEY E</dt><dd>{formatCoordinate(survey.e)}</dd><dt>SURVEY N</dt><dd>{formatCoordinate(survey.n)}</dd></dl>}
    <p className="property-note">Порты · {definition.ports.length}. Инструмент «Соединение» подключает символы; связи следуют за ними.</p>
  </div>;
}
