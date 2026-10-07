import { currentViewEntityIds } from '../layouts/context';
import { editorViewDocument } from '../store/editor';
import { TableGeometryPreview } from './TableGeometryPreview';
import { memo, useEffect, useMemo, useState, type Dispatch } from 'react';
import { documentTables } from '../tables/detect';
import { resolveSelectionScope, paperDocument } from '../layouts/selection';
import type { EditorState } from '../store/editor';
import type { GeoDocument } from '../domain/model';
import type { ApplicationAction } from '../ai/workflow';
import type { ViewSize } from '../geometry';
import { documentQueryIndex, searchDocument } from '../documentOperations/query';
export const DocumentSearch = memo(function DocumentSearch({ document, dispatch, size, transactionActive, state }: {
    state: EditorState;
    document: GeoDocument;
    dispatch: Dispatch<ApplicationAction>;
    size: ViewSize;
    transactionActive: boolean;
}) {
    const [navigation,setNavigation]=useState(state.viewportNavigation);
    useEffect(()=>{const timer=setTimeout(()=>setNavigation(state.viewportNavigation),180);return()=>clearTimeout(timer);},[state.viewportNavigation]);
    const currentViewIds=useMemo(()=>currentViewEntityIds({document,layoutId:state.layoutId,dxfViewportId:state.dxfViewportId,viewportEditing:state.viewportEditing,isolation:state.isolation,viewportNavigation:navigation??null},editorViewDocument({document,isolation:state.isolation},document,!!state.layoutId)),[document,state.layoutId,state.dxfViewportId,state.viewportEditing,state.isolation,navigation]);
    const [includeWeak,setIncludeWeak]=useState(false);
    const [scope, setScope] = useState('all'), [category, setCategory] = useState('all');
    const tables = useMemo(() => documentTables(document), [document]);
    const localDocument = useMemo(() => ({ ...document, entities: [...document.entities, ...(document.dxfLayouts ?? []).flatMap(l => paperDocument(document, l).entities)] }), [document]);
    const selectionContext=useMemo(()=>({layoutId:state.layoutId,dxfViewportId:state.dxfViewportId,viewportEditing:state.viewportEditing,viewportNavigation:navigation??null,isolation:state.isolation}),[state.layoutId,state.dxfViewportId,state.viewportEditing,navigation,state.isolation]);
    const scopeIds = useMemo(() => scope === 'all' ? undefined : new Set(scope === 'model' ? document.entities.map(e => e.id) : scope === 'view' ? [...(currentViewIds ?? [])] : scope === 'paper' && state.layoutId ? resolveSelectionScope(document, { kind: 'paper-visible', layoutId: state.layoutId }, selectionContext).modelIds.concat(resolveSelectionScope(document, { kind: 'paper-visible', layoutId: state.layoutId }, selectionContext).paperIds) : scope === 'viewport' && state.layoutId && state.dxfViewportId ? resolveSelectionScope(document, { kind: 'viewport-visible', layoutId: state.layoutId, viewportId: state.dxfViewportId }, selectionContext).modelIds : []), [scope, document, currentViewIds, state.layoutId, state.dxfViewportId,selectionContext]);
    const [text, setText] = useState(''), [debounced, setDebounced] = useState('');
    useEffect(() => { const timer = setTimeout(() => setDebounced(text), 180); return () => clearTimeout(timer); }, [text]);
    // Build once per immutable revision, not by traversing nested blocks at each keystroke.
    useMemo(() => documentQueryIndex(document), [document]);
    const results = useMemo(() => searchDocument(localDocument, debounced, scopeIds,includeWeak,document), [localDocument, debounced, scopeIds,includeWeak,document]);
    const tableResults = tables.filter(t => (scope === 'all' || scope === 'model' && t.context === 'Model' || scope === 'paper' && t.layoutId === state.layoutId || t.ownerIds.some(id => scopeIds?.has(id))) && (!debounced || [t.title, ...t.rows.flat(), ...t.sourcePath].join(' ').toLocaleLowerCase().includes(debounced.toLocaleLowerCase())));
    const visibleRows = results.rows.filter(row => category !== 'tables' && (category!=='semantic'||!!row.semantics) && (category !== 'blocks' || row.entityType === 'block_instance') && (category !== 'text' || row.matches.length > 0 || row.entityType === 'text'));
    const resultIds=results.entityIds.filter(id=>{const r=documentQueryIndex(localDocument).records.get(id)!;return category!=='tables'&&(category!=='blocks'||r.entity.type==='block_instance')&&(category!=='text'||r.texts.length>0||r.entity.type==='text');});
    return <details id="editor-panel-search" role="tabpanel" aria-labelledby="editor-tab-search" className="document-search" open><summary>Поиск в документе</summary>
    <div className="search-form"><select aria-label="Область поиска" value={scope} onChange={e => setScope(e.target.value)}><option value="all">Весь документ</option><option value="model">Model Space</option><option value="view">Текущий вид</option><option value="paper" disabled={!state.layoutId}>Текущий Paper Space</option><option value="viewport" disabled={!state.layoutId || !state.dxfViewportId}>Активный viewport</option></select><select aria-label="Категория поиска" value={category} onChange={e => setCategory(e.target.value)}><option value="all">Всё</option><option value="text">Текст</option><option value="blocks">Блоки</option><option value="tables">Таблицы</option><option value="semantic">Смысл / категории</option></select><input aria-label="Поиск в документе" value={text} maxLength={128} onChange={e => setText(e.target.value)} placeholder="Категория, слой, блок, текст, ATTRIB…"/></div><label><input aria-label="Включить слабые смысловые подсказки" type="checkbox" checked={includeWeak} onChange={e=>setIncludeWeak(e.target.checked)}/>Слабые подсказки</label>{visibleRows.some(r=>r.semantics)&&<div><button disabled={transactionActive} onClick={()=>dispatch({type:'select-entities',entityIds:resultIds})}>Выбрать результаты</button><button onClick={()=>dispatch({type:'fit-entities',entityIds:resultIds,size})}>Fit результатов</button><button onClick={()=>dispatch({type:'isolate-entities',entityIds:resultIds,label:debounced})}>Показать только результаты</button></div>}<small className="search-count">{category === 'tables' ? tableResults.length : category === 'all' ? results.total : visibleRows.length} объектов · локально</small>
    {(category === 'tables' || (category === 'all' || category === 'text') && debounced) && tableResults.map(t => <details className="table-result" key={t.id}><summary>{t.title} · {t.rows.length} × {t.columns}</summary><small>{t.context} · {t.sourcePath.join(' → ')} · {t.confidence}{!t.instantiated ? ' · Определение без экземпляра · Размещение отсутствует / неизвестно в этом DXF' : ' · Размещено'}</small><p data-testid="table-recognized-rows">{t.explication.length} распознанных строк · Источник: определение блока {t.sourcePath[0]}</p><div className="table-scroll"><table><tbody>{t.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div><button disabled={!t.instantiated||!t.ownerIds.length} onClick={() => { dispatch({ type: 'select-entities', entityIds: t.ownerIds }); dispatch({ type: 'fit-entities', entityIds: t.ownerIds, size }); }}>Показать / Fit</button><TableGeometryPreview document={document} table={t}/><small>DXF: {t.handles.slice(0, 6).join(', ')} · Только чтение</small></details>)}
    <div className="search-results">{visibleRows.map(row => <div className="query-result" key={row.entityId}>
      <button type="button" disabled={transactionActive} onClick={() => dispatch({ type: 'select-entities', entityIds: [row.entityId] })}>{row.matches[0]?.text ?? row.name}</button><small>{currentViewIds && !currentViewIds.has(row.entityId) ? 'Скрыт в текущем виде · ' : ''}{row.entityType} · {row.layer} · DXF: {row.sourceLayer || '—'}</small>
      {row.semantics&&<details className="semantic-search-explanation"><summary>{row.semantics.label} · {row.semantics.tier}</summary>{row.semantics.reasons.map((reason,i)=><small key={i}>{reason}</small>)}</details>}
      {row.matches.map((m, i) => <small key={i}>{m.tag ?? ''} {m.path.join(' → ')}</small>)}
      <button type="button" disabled={transactionActive} onClick={() => dispatch({ type: 'fit-entities', entityIds: [row.entityId], size })}>Fit</button>
    </div>)}</div>{results.total > results.rows.length && <small>Показаны первые {results.rows.length}. Уточните поиск.</small>}
  </details>;
},(a,b)=>a.dispatch===b.dispatch&&a.size===b.size&&a.document===b.document&&a.transactionActive===b.transactionActive&&(['layoutId','dxfViewportId','viewportEditing','viewportNavigation','isolation'] as const).every(k=>a.state[k]===b.state[k]));
