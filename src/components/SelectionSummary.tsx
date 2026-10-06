import { paperDocument } from '../layouts/selection';
import { useMemo, type Dispatch } from 'react';
import type { EditorState, EditorAction } from '../store/editor';
import { bounds, type ViewSize } from '../geometry';
import { entityBoundsPoints } from '../geometry/entityBounds';
import { formatCoordinate } from '../geometry/format';
const labels:Record<string,string>={line:'Линия',point:'Точка',polyline:'Полилиния',polygon:'Полигон',block_instance:'Блок',text:'Текст',imported_graphic:'Графика',dimension:'Размер',connector:'Соединение',symbol:'Символ'};
export function SelectionSummary({state,dispatch,size}:{state:EditorState;dispatch:Dispatch<EditorAction>;size:ViewSize}){
 const summary=useMemo(()=>{
  const ids=new Set(state.selectedEntityIds),paperIds=new Set(state.selectedPaperIds),model=state.document.entities.filter(e=>ids.has(e.id)),paper=(state.document.dxfLayouts??[]).flatMap(l=>{const d=paperDocument(state.document,l);return d.entities.filter(e=>paperIds.has(e.id)).map(e=>({entity:e,document:d}));}),all=[...model,...paper.map(p=>p.entity)],types=new Map<string,number>(),layers=new Map<string,number>(),sources=new Map<string,number>(),locked=new Set(state.document.layers.filter(l=>l.locked).map(l=>l.id));
  for(const e of all){const type=labels[e.type]??e.type;types.set(type,(types.get(type)??0)+1);layers.set(e.layerId,(layers.get(e.layerId)??0)+1);if(e.source)sources.set(e.source.originalLayer,(sources.get(e.source.originalLayer)??0)+1);}
  const readonly=paper.length+model.filter(e=>locked.has(e.layerId)||e.type==='raster_underlay'&&e.locked).length;
  const box=paper.length===0?bounds(model.flatMap(e=>entityBoundsPoints(state.document,e))):model.length===0?bounds(paper.flatMap(p=>entityBoundsPoints(p.document,p.entity))):null;
  return {types,layers,sources,readonly,box,paper};
 },[state.document,state.selectedEntityIds,state.selectedPaperIds]);
 const count=state.selectedEntityIds.length+state.selectedPaperIds.length;
 return <div className="selection-summary" data-testid="group-properties"><strong>Выбрано: {count} объектов</strong><small>Контекст: {state.selectionScopeLabel??'выбор'} · {state.document.dxfLayouts?.find(l=>l.id===state.layoutId)?.name??'Model'}{state.viewportEditing?' · MODEL viewport':''}</small><p>Редактируемые MODEL: {count-summary.readonly} · Только чтение: {summary.readonly}</p><details className="property-section" open><summary>Общие</summary>{summary.paper.length===1&&<><strong>{summary.paper[0]!.entity.name}</strong><p>Объект листа · только просмотр</p></>}<p>{[...summary.types].map(([name,n])=>`${name}: ${n}`).join(' · ')}</p><p>{summary.layers.size===1?'Общий слой':'Смешанные слои'} · {summary.layers.size}</p>{[...summary.layers].slice(0,12).map(([id,n])=><div key={id}>{state.document.layers.find(l=>l.id===id)?.name} — {n}</div>)}{summary.layers.size>12&&<small>Ещё {summary.layers.size-12} слоёв · откройте панель слоёв.</small>}</details>
 {summary.box&&<details className="property-section" open><summary>Геометрия · {summary.paper.length?'Paper Space':'MODEL'}</summary><p>X: {formatCoordinate(summary.box.minX)} … {formatCoordinate(summary.box.maxX)}<br/>Y: {formatCoordinate(summary.box.minY)} … {formatCoordinate(summary.box.maxY)}</p></details>}
 {summary.sources.size>0&&<details className="property-section" data-testid="property-source"><summary>Источник</summary>{[...summary.sources].slice(0,12).map(([name,n])=><div key={name}>{name} — {n}</div>)}{summary.paper.length===1&&summary.paper[0]!.entity.source&&<p>DXF {summary.paper[0]!.entity.source!.originalType} · Handle {summary.paper[0]!.entity.source!.handle??'—'}</p>}</details>}
 <div className="summary-actions"><button onClick={()=>dispatch({type:'layer-panel-filter',filter:'selected'})}>Показать слои</button><button onClick={()=>dispatch({type:'isolate-layers',layerIds:[...summary.layers.keys()],label:'слои выбранных объектов'})}>Только слои выбранного</button><button onClick={()=>dispatch({type:'fit-entities',entityIds:[...state.selectedEntityIds,...state.selectedPaperIds],size})}>Fit</button><button onClick={()=>dispatch({type:'select',entityId:null})}>Снять выделение</button></div></div>;
}
