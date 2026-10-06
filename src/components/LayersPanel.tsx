import { layerCounts, selectedLayerCounts, filterLayers, type LayerFilter } from '../layouts/layers';
import { activeDxfViewport } from '../layouts/context';
import type { ViewSize } from '../geometry';
import { memo, useMemo, useState, useEffect, type Dispatch } from 'react';
import type { EditorAction, EditorState } from '../store/editor';
import { documentModelFrame } from '../geometry/georeferencing';
import { CoordinateReferencePanel } from './CoordinateReferencePanel';
import { Icon } from './Icon';

export const LayersPanel = memo(function LayersPanel({ state, dispatch, onCalibrate, inert = false, size = {width:1000,height:700} }: { state: EditorState; dispatch: Dispatch<EditorAction>; onCalibrate: () => void; inert?: boolean;size?:ViewSize }) {
  const { document } = state;
  return <aside inert={inert} className="left-panel" aria-label="Слои документа">
    <div className="panel-heading"><Icon name="layers" size={16} /><h2>Слои</h2><span className="badge">{document.layers.length}</span><button className="icon-button small" aria-label="Создать слой" title="Создать слой" onClick={() => dispatch({ type: 'create-layer' })}><Icon name="plus" size={16} /></button></div>
    <LayerList size={size} state={state} dispatch={dispatch} />
    <div className="panel-section"><h3>Документ</h3>
      <dl className="document-facts"><dt>Система координат</dt><dd>{document.coordinateSystem.name ?? (documentModelFrame(document) === 'local' ? 'Локальная MODEL' : 'Проектная / direct')}</dd><dt>Единицы</dt><dd>Метры (м)</dd><dt>Оси модели</dt><dd>X / Y · Z вверх</dd><dt>Объекты</dt><dd>{document.entities.length} в модели</dd></dl>
    </div>
    <CoordinateReferencePanel state={state} dispatch={dispatch} onCalibrate={onCalibrate} />
    <div className="sidebar-note"><Icon name="crosshair" size={20} /><p>Точность в модели<small>Координаты хранятся без округления. Масштаб влияет только на вид.</small></p></div>
    <div className="panel-foot"><span className="live-dot" /> Локальный редактор <span className="version">v0.3</span></div>
  </aside>;
}, (a,b)=>a.dispatch===b.dispatch&&a.onCalibrate===b.onCalibrate&&a.inert===b.inert&&a.size===b.size&&a.state.selectedEntityIds===b.state.selectedEntityIds&&a.state.isolation===b.state.isolation&&a.state.layerPanelFilter===b.state.layerPanelFilter&&a.state.layoutId===b.state.layoutId&&a.state.dxfViewportId===b.state.dxfViewportId&&a.state.document===b.state.document&&a.state.selectedLayerId===b.state.selectedLayerId&&Boolean(a.state.transactionBefore)===Boolean(b.state.transactionBefore));

const LayerList = memo(function LayerList({state,dispatch,size}:{size:ViewSize;state:EditorState;dispatch:Dispatch<EditorAction>}) {
  const {document,selectedLayerId}=state;
  const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[hideEmpty,setHideEmpty]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setTerm(search),150);return()=>clearTimeout(timer);},[search]);
  const counts=useMemo(()=>layerCounts(document),[document]),selected=useMemo(()=>selectedLayerCounts(document,state.selectedEntityIds),[document,state.selectedEntityIds]);
  const rows=useMemo(()=>filterLayers(document.layers,counts,selected,term,state.layerPanelFilter,hideEmpty),[document.layers,counts,selected,term,state.layerPanelFilter,hideEmpty]);
  const frozen=new Set(activeDxfViewport(state)?.frozenSourceLayerNames??[]),isolated=state.isolation?.layerIds;
  const bulk=(visible:boolean)=>dispatch({type:'execute-batch',commands:document.layers.filter(l=>l.visible!==visible).map(l=>({type:'set-layer-visibility' as const,layerId:l.id,visible}))});
  return <><div className="layer-controls"><input aria-label="Поиск слоя" placeholder="Поиск слоя…" value={search} onChange={e=>setSearch(e.target.value)}/>
    <select aria-label="Фильтр слоёв" value={state.layerPanelFilter} onChange={e=>dispatch({type:'layer-panel-filter',filter:e.target.value as LayerFilter})}><option value="all">Все</option><option value="visible">Видимые</option><option value="nonempty">Непустые</option><option value="selected">С выбранными</option><option value="hidden">Скрытые</option></select>
    <label title="Скрывает только строки панели; видимость документа не меняется"><input type="checkbox" checked={hideEmpty} onChange={e=>setHideEmpty(e.target.checked)}/>Скрыть пустые</label>
    <div><button disabled={!!state.transactionBefore} onClick={()=>bulk(true)}>Показать все</button><button disabled={!!state.transactionBefore} onClick={()=>bulk(false)}>Скрыть все</button></div><small>{rows.length} / {document.layers.length} слоёв · число объектов верхнего уровня</small>
  </div><div className="layer-list">
    {rows.map(layer=>{const index=document.layers.findIndex(l=>l.id===layer.id),vpFrozen=frozen.has(layer.source?.originalLayer??layer.name),excluded=isolated&&!isolated.includes(layer.id);return <div key={layer.id} data-layer-id={layer.id} className={`layer-row ${!layer.visible?'hidden-layer':''} ${selectedLayerId===layer.id?'active-layer':''} ${excluded?'isolated-layer':''} ${selected.has(layer.id)?'selected-layer':''}`}>
      <div className="layer-order"><button aria-label={`Поднять слой ${layer.name}`} disabled={index===0} onClick={()=>dispatch({type:'execute',command:{type:'move-layer',layerId:layer.id,direction:-1}})}>↑</button><button aria-label={`Опустить слой ${layer.name}`} disabled={index===document.layers.length-1} onClick={()=>dispatch({type:'execute',command:{type:'move-layer',layerId:layer.id,direction:1}})}>↓</button></div>
      <span className="layer-color" style={{background:layer.style?.strokeColor??document.styles.find(s=>s.id===layer.styleId)?.stroke}}/>
      <button className="layer-name" aria-label={`Выбрать слой ${layer.name}`} aria-pressed={selectedLayerId===layer.id} onDoubleClick={()=>dispatch({type:'select-layer-objects',layerId:layer.id})} onClick={()=>dispatch({type:'select-layer',layerId:layer.id})}><span>{layer.name}</span><small>{counts.get(layer.id)??0} объектов{layer.locked?' · заблокирован':''}{selected.has(layer.id)?` · выбрано ${selected.get(layer.id)}`:''}</small>{vpFrozen&&<small className="vp-badge" title="VP Freeze: слой заморожен только в активном видовом экране">⊘ VP Freeze</small>}{excluded&&<small title="Слой исключён временной изоляцией">Вне изоляции</small>}</button>
      <button className="icon-button small" aria-label={`${layer.visible?'Скрыть':'Показать'} слой ${layer.name}`} title={layer.visible?'Глобально видимый слой':'Глобально скрытый слой'} aria-pressed={layer.visible} onClick={()=>dispatch({type:'execute',command:{type:'set-layer-visibility',layerId:layer.id,visible:!layer.visible}})}><Icon name={layer.visible?'eye':'eye-off'} size={16}/></button>
      <button className="icon-button small" aria-label={`${layer.locked?'Разблокировать':'Заблокировать'} слой ${layer.name}`} aria-pressed={layer.locked} onClick={()=>dispatch({type:'execute',command:{type:'set-layer-lock',layerId:layer.id,locked:!layer.locked}})}><Icon name={layer.locked?'lock':'unlock'} size={15}/></button>
      <details className="layer-menu"><summary aria-label={`Действия слоя ${layer.name}`}>⋮</summary><div><button onClick={()=>dispatch({type:'select-layer',layerId:layer.id})}>Стиль слоя…</button><button onClick={()=>dispatch({type:'isolate-layers',layerIds:[layer.id],label:layer.name})}>Изолировать слой</button><button onClick={()=>dispatch({type:'execute',command:{type:'set-layer-visibility',layerId:layer.id,visible:!layer.visible}})}>{layer.visible?'Скрыть слой':'Показать слой'}</button><button onClick={()=>dispatch({type:'select-layer-objects',layerId:layer.id})}>Выбрать все объекты слоя</button><button onClick={()=>dispatch({type:'fit-layer',layerId:layer.id,size})}>Fit Layer</button></div></details>
    </div>;})}
  </div></>;
});
