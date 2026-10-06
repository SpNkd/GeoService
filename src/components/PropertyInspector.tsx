import { NESTED_MOVE_MESSAGE, resolveDeepSelection } from '../editor/deepSelection';
import { createProvenanceIndex } from '../dxf/provenance';
import { ConnectorProperties } from './ConnectorProperties';
import { SymbolProperties } from './SymbolProperties';
import type { ViewSize } from '../geometry';
import { formatCoordinate } from '../geometry/format';
import { transformPoint, blockDefinition } from '../vectors/geometry';
import { layerBounds } from '../geometry/entityBounds';
import { documentSurveyXY, modelToAbsoluteZ } from '../geometry/georeferencing';
import { MoveSelectionPanel } from './MoveSelectionPanel';
import { Fragment, memo, useEffect, useMemo, useState, type Dispatch } from 'react';
import { entityVertexIds, type Entity, type GeoDocument, type PointEntity, type TextEntity, type LabelEntity } from '../domain/model';
import { distance, pathLength, polygonArea } from '../geometry';
import { formatAzimuth, formatDistance, formatMeasure } from '../geometry/format';
import { isLayerLocked, canEditVertex } from '../domain/commands';
import { azimuth, polygonSelfIntersects } from '../geometry/survey';
import { vertexFor } from '../renderer/selectors';
import type { EditorAction, EditorState } from '../store/editor';
import { Icon } from './Icon';
import { createLabelCommand, newGeometryId } from '../domain/geometryIntent';
import { resolveLabelTemplate, resolvedLabelPosition } from '../geometry/labels';

const typeNames: Record<Entity['type'], string> = { connector:'Соединение',point: 'Точка', line: 'Линия', polyline: 'Полилиния', polygon: 'Полигон', text: 'Текст', label: 'Связанная подпись', dimension: 'Размер', symbol: 'Символ', arc: 'Дуга', circle: 'Окружность', block_instance: 'DXF блок', imported_graphic: 'Импортированная графика' };

function CoordinateField({ label, value, disabled, onChange, onEditStart, onEditEnd }: { label: string; value: number | undefined; disabled: boolean; onChange: (value: number) => void; onEditStart: () => void; onEditEnd: () => void }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const valid = draft.trim() === '' || Number.isFinite(Number(draft));
  useEffect(() => {
    setDraft(previous => previous.trim() !== '' && Number(previous) === value ? previous : value === undefined ? '' : String(value));
  }, [value]);
  return <label className="coordinate-field"><span>{label}</span><div className={!valid ? 'invalid-input' : ''}>
    <input aria-label={label} type="text" inputMode="decimal" spellCheck={false} value={draft} aria-invalid={!valid} disabled={disabled} onFocus={onEditStart}
      onChange={event => {
        const next = event.target.value;
        setDraft(next);
        if (next.trim() !== '' && Number.isFinite(Number(next))) onChange(Number(next));
      }}
      onBlur={() => { setDraft(value === undefined ? '' : String(value)); onEditEnd(); }}
    /><span>м</span></div></label>;
}
function PointProperties({ entity, document, dispatch }: { entity: PointEntity; document: GeoDocument; dispatch: Dispatch<EditorAction> }) {
  const vertex = vertexFor(document, entity.vertexId);
  const survey = documentSurveyXY(document, vertex), absolute = modelToAbsoluteZ(vertex.z, document.verticalReference);
  const disabled = isLayerLocked(document, entity) || !canEditVertex(document, entity.vertexId);
  const change = (key: 'x' | 'y' | 'z', value: number) => {
    const { x, y, z } = vertex;
    const position = key === 'x' ? { x: value, y, ...(z !== undefined ? { z } : {}) }
      : key === 'y' ? { x, y: value, ...(z !== undefined ? { z } : {}) } : { x, y, z: value };
    dispatch({ type: 'transient', command: { type: 'update-vertex', vertexId: vertex.id, position } });
  };
  return <div className="property-section"><h3>Координаты · MODEL</h3>
    <div className="vertex-id-row"><span>Вершина</span><code>{vertex.id}</code></div>
    <CoordinateField label="X" value={vertex.x} disabled={disabled} onChange={x => change('x', x)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} />
    <CoordinateField label="Y" value={vertex.y} disabled={disabled} onChange={y => change('y', y)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} />
    <CoordinateField label="Z" value={vertex.z} disabled={disabled} onChange={z => change('z', z)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} />
    <div className="derived-coordinates"><h3>SURVEY · только просмотр</h3><dl><dt>E</dt><dd data-testid="point-survey-e">{survey ? formatCoordinate(survey.e) : '—'}</dd><dt>N</dt><dd data-testid="point-survey-n">{survey ? formatCoordinate(survey.n) : '—'}</dd>{document.verticalReference && <><dt>H абсолютная</dt><dd data-testid="point-absolute-h">{absolute === undefined ? '—' : formatCoordinate(absolute)}</dd></>}</dl></div>
    {disabled ? <p className="field-help lock-message">Вершина используется заблокированным слоем. Координаты доступны только для просмотра.</p> : <p className="field-help">Изменения применяются сразу. Полная точность доступна в поле ввода.</p>}
  </div>;
}
function GeometryProperties({ entity, document, locked, dispatch }: { entity: Exclude<Entity, PointEntity>; document: GeoDocument; locked: boolean; dispatch: Dispatch<EditorAction> }) {
  if (entity.type === 'label') return <div className="property-section"><h3>Связанная подпись</h3><dl className="property-facts"><dt>Цель</dt><dd>{document.entities.find(item => item.id === entity.targetId)?.name ?? 'Не найдена'}</dd></dl></div>;
  const ids = entityVertexIds(entity);
  const points = ids.map(id => vertexFor(document, id));
  const worldPoints = points.map(({ x, y, z }) => z === undefined ? { x, y } : { x, y, z });
  return <div className="property-section"><h3>Геометрия</h3><dl className="property-facts">
    {entity.type === 'line' && <><dt>Длина</dt><dd>{formatMeasure(distance(worldPoints[0]!, worldPoints[1]!))} м</dd></>}
    {(entity.type === 'line' || entity.type === 'dimension') && <><dt>Азимут</dt><dd>{formatAzimuth(azimuth(worldPoints[0]!, worldPoints[1]!))}</dd></>}
    {entity.type === 'dimension' && <><dt>Длина размера</dt><dd>{formatDistance(distance(worldPoints[0]!, worldPoints[1]!))} м</dd></>}
    {entity.type === 'polyline' && <><dt>Длина</dt><dd>{formatMeasure(pathLength(worldPoints))} м</dd></>}
    {entity.type === 'polygon' && <><dt>Площадь</dt><dd>{formatMeasure(polygonArea(worldPoints))} м²</dd><dt>Периметр</dt><dd>{formatMeasure(pathLength(worldPoints, true))} м</dd></>}
    {entity.type === 'text' && <><dt>Содержание</dt><dd className="text-content">{entity.content}</dd><dt>Размер текста</dt><dd>{entity.fontSize} px</dd></>}
    <dt>Вершины</dt><dd>{points.length}</dd>
  </dl>{entity.type === 'dimension' && <><DimensionReferences entity={entity} document={document} locked={locked} dispatch={dispatch} /><DimensionOffsetField entity={entity} locked={locked} dispatch={dispatch} /><DimensionTextPositionField entity={entity} locked={locked} dispatch={dispatch} /></>}<div className="vertex-table"><table><thead><tr><th>Вершина</th><th>X, м</th><th>Y, м</th></tr></thead><tbody>
    {points.map((vertex, i) => <tr key={`${vertex.id}:${i}`}><td title={vertex.id}>{vertex.id}</td><td>{formatCoordinate(vertex.x)}</td><td>{formatCoordinate(vertex.y)}</td></tr>)}
  </tbody></table></div>{entity.type === 'polygon' && polygonSelfIntersects(worldPoints) && <p className="geometry-warning">Граница самопересекается. Проверьте вершины.</p>}</div>;
}

function DimensionReferences({ entity, document, locked, dispatch }: { entity: Extract<Entity, { type: 'dimension' }>; document: GeoDocument; locked: boolean; dispatch: Dispatch<EditorAction> }) {
  const reference = (endpoint: 'start' | 'end') => {
    const vertexId = endpoint === 'start' ? entity.startVertexId : entity.endVertexId;
    const vertex = document.vertices[vertexId]!;
    const point = document.entities.find(item => item.type === 'point' && item.vertexId === vertexId);
    return { vertexId, vertex, name: point?.name ?? 'Вершина' };
  };
  return <div className="dimension-reference-fields"><h3>Привязки к вершинам</h3>{(['start', 'end'] as const).map(endpoint => {
    const { vertexId, vertex, name } = reference(endpoint), survey = documentSurveyXY(document, vertex);
    return <div className="dimension-reference-row" key={endpoint}>
      <div><strong>{endpoint === 'start' ? 'Начало' : 'Конец'} · {name}</strong><code>{vertexId}</code><span>MODEL X {formatCoordinate(vertex.x)} · Y {formatCoordinate(vertex.y)} м</span>{survey && <span>SURVEY E {formatCoordinate(survey.e)} · N {formatCoordinate(survey.n)} м</span>}</div>
      <button type="button" className="secondary-action" disabled={locked} onClick={() => dispatch({ type: 'begin-dimension-pick', dimensionId: entity.id, endpoint })}>{locked ? 'Только просмотр' : 'Выбрать на схеме'}</button>
    </div>;
  })}</div>;
}

function LayerProperties({ layer, state, dispatch, size }: { size: ViewSize; layer: GeoDocument['layers'][number]; state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const [name, setName] = useState(layer.name);
  useEffect(() => setName(layer.name), [layer.name]);
  const count = state.document.entities.filter(entity => entity.layerId === layer.id).length;
  return <div className="inspector-content">
    <div className="entity-heading"><span className="entity-icon"><Icon name="layers" size={23} /></span><div><h3>Слой</h3><span>{layer.id === state.currentLayerId ? 'Текущий слой' : 'Выбранный слой'}</span></div></div>
    <div className="property-section"><h3>Свойства слоя</h3>
      <label className="layer-property-name"><span>Название</span><input aria-label="Название слоя" value={name} onChange={event => setName(event.target.value)} onBlur={() => { if (name.trim() && name !== layer.name) dispatch({ type: 'execute', command: { type: 'update-layer', layerId: layer.id, name: name.trim() } }); else setName(layer.name); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      <dl className="property-facts"><dt>Объекты</dt><dd>{count}</dd><dt>Видимость</dt><dd>{layer.visible ? 'Виден' : 'Скрыт'}</dd><dt>Состояние</dt><dd>{layer.locked ? 'Заблокирован' : 'Доступен'}</dd></dl>
      <button className="secondary-action" title="Центрировать и масштабировать вид по содержимому слоя" disabled={!layerBounds(state.document, layer.id)} onClick={() => dispatch({ type: 'fit-layer', layerId: layer.id, size })}>Вписать слой</button>
      <button className="secondary-action" disabled={!count} onClick={() => dispatch({ type: 'select-layer-objects', layerId: layer.id })}>Выбрать все объекты слоя</button><button className="secondary-action" onClick={() => dispatch({ type: 'execute', command: { type: 'delete-layer', layerId: layer.id } })}>Удалить слой</button>
    </div>
  </div>;
}

function TextContentField({ entity, locked, dispatch }: { entity: TextEntity; locked: boolean; dispatch: Dispatch<EditorAction> }) {
  const [value, setValue] = useState(entity.content);
  useEffect(() => setValue(entity.content), [entity.content]);
  return <label className="coordinate-field"><span>Текст</span><input aria-label="Текст" value={value} disabled={locked} onChange={event => setValue(event.target.value)} onBlur={() => {
    if (value.trim() && value !== entity.content) dispatch({ type: 'execute', command: { type: 'update-entity', entityId: entity.id, patch: { content: value } } });
    else setValue(entity.content);
  }} /></label>;
}

function DimensionOffsetField({ entity, locked, dispatch }: { entity: Extract<Entity, { type: 'dimension' }>; locked: boolean; dispatch: Dispatch<EditorAction> }) {
  const [draft, setDraft] = useState(String(entity.offset));
  useEffect(() => setDraft(String(entity.offset)), [entity.offset]);
  const commit = () => {
    if (draft.trim() && Number.isFinite(Number(draft))) {
      const offset = Number(draft);
      if (offset !== entity.offset) dispatch({ type: 'execute', command: { type: 'update-entity', entityId: entity.id, patch: { offset } } });
    } else setDraft(String(entity.offset));
  };
  return <label className="coordinate-field"><span>Отступ размера</span><div><input aria-label="Отступ размера" type="text" inputMode="decimal" spellCheck={false} value={draft} disabled={locked}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><span>м</span></div></label>;
}

function DimensionTextPositionField({ entity, locked, dispatch }: { entity: Extract<Entity, { type: 'dimension' }>; locked: boolean; dispatch: Dispatch<EditorAction> }) {
  const [draft, setDraft] = useState(String(entity.textPosition ?? 0.5));
  useEffect(() => setDraft(String(entity.textPosition ?? 0.5)), [entity.textPosition]);
  const commit = () => {
    const value = Number(draft);
    if (draft.trim() && Number.isFinite(value)) {
      const textPosition = Math.max(0.05, Math.min(0.95, value));
      if (textPosition !== (entity.textPosition ?? 0.5)) dispatch({ type: 'execute', command: { type: 'update-entity', entityId: entity.id, patch: { textPosition } } });
      setDraft(String(textPosition));
    } else setDraft(String(entity.textPosition ?? 0.5));
  };
  return <label className="coordinate-field"><span>Положение текста</span><input aria-label="Положение текста" type="number" min="0.05" max="0.95" step="0.01" value={draft} disabled={locked} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

function LabelProperties({ entity, document, locked, dispatch }: { entity: LabelEntity; document: GeoDocument; locked: boolean; dispatch: Dispatch<EditorAction> }) {
  const [template, setTemplate] = useState(entity.template);
  useEffect(() => setTemplate(entity.template), [entity.template]);
  const preview = resolveLabelTemplate(document, entity), position = resolvedLabelPosition(document, entity);
  return <div className="property-section"><h3>Связанная подпись</h3>
    <dl className="property-facts"><dt>Цель</dt><dd>{document.entities.find(item => item.id === entity.targetId)?.name ?? 'Не найдена'}</dd><dt>Preview</dt><dd>{preview}</dd></dl>
    <label className="coordinate-field"><span>Шаблон</span><textarea aria-label="Шаблон подписи" value={template} disabled={locked} onChange={event => setTemplate(event.target.value)} onBlur={() => { if (template !== entity.template) dispatch({ type: 'execute', command: { type: 'update-entity', entityId: entity.id, patch: { template } } }); }} /></label>
    {position && <dl className="property-facts"><dt>X</dt><dd>{formatCoordinate(position.x)}</dd><dt>Y</dt><dd>{formatCoordinate(position.y)}</dd></dl>}
    <CoordinateField label="Offset X" value={entity.dx} disabled={locked} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })}
      onChange={dx => dispatch({ type: 'transient', command: { type: 'update-entity', entityId: entity.id, patch: { dx } } })} />
    <CoordinateField label="Offset Y" value={entity.dy} disabled={locked} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })}
      onChange={dy => dispatch({ type: 'transient', command: { type: 'update-entity', entityId: entity.id, patch: { dy } } })} />
    {locked && <p className="read-only-banner">Слой заблокирован · только просмотр</p>}
  </div>;
}

function TextCoordinates({ entity, document, locked, dispatch }: { entity: TextEntity; document: GeoDocument; locked: boolean; dispatch: Dispatch<EditorAction> }) {
  const vertex = vertexFor(document, entity.vertexId);
  const change = (axis: 'x' | 'y', value: number) => dispatch({ type: 'transient', command: { type: 'move-text', entityId: entity.id, vertexId: newGeometryId('v'),
    position: axis === 'x' ? { x: value, y: vertex.y, ...(vertex.z === undefined ? {} : { z: vertex.z }) } : { x: vertex.x, y: value, ...(vertex.z === undefined ? {} : { z: vertex.z }) } } });
  return <div><CoordinateField label="X" value={vertex.x} disabled={locked} onChange={x => change('x', x)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} />
    <CoordinateField label="Y" value={vertex.y} disabled={locked} onChange={y => change('y', y)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} /></div>;
}

function LabelPresets({ entity, state, dispatch }: { entity: Entity; state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const presets = entity.type === 'symbol' ? [['Имя', '{name}']] : entity.type === 'point' ? [['Имя', '{name}'], ['Имя + Z', '{name} · Z={z}'], ['Координаты', 'X={x} · Y={y}'], ['Абсолютная высота', 'H={h_absolute}']]
    : entity.type === 'polygon' ? [['Название', '{name}'], ['Площадь', 'S={area} м²'], ['Периметр', 'P={perimeter} м'], ['Название + площадь', '{name} · S={area} м²']]
    : [['Длина', 'L={length} м'], ['Название', '{name}'], ['Название + длина', '{name} · L={length} м']];
  const [template, setTemplate] = useState(presets[0]![1]!);
  return <div className="property-section"><h3>Подписи</h3><label className="layer-field">Preset<select aria-label="Вариант подписи" value={template} onChange={event => setTemplate(event.target.value)}>{presets.map(([name, value]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <button aria-label="Добавить подпись" className="secondary-action" onClick={() => { try { const command = createLabelCommand(state.document, entity.id, newGeometryId, template); dispatch({ type: 'execute', command }); if (command.type === 'add-entity') dispatch({ type: 'select', entityId: command.entity.id }); } catch (error) { dispatch({ type: 'report-error', message: error instanceof Error ? error.message : 'Не удалось создать подпись' }); } }}>+ Добавить подпись</button></div>;
}

function BlockAttributeEditor({state,dispatch,tag,value,index,sourceHandle,primitive,ownerId}:{state:EditorState;dispatch:Dispatch<EditorAction>;tag:string;value:string;index:number;sourceHandle?:string;primitive:Extract<import('../vectors/types').VectorPrimitive,{kind:'text'}>;ownerId:string}) {
  const [draft,setDraft]=useState(value),owner=state.document.entities.find(e=>e.id===ownerId),definition=owner?.type==='block_instance'?blockDefinition(state.document,owner.blockDefinitionId):undefined;
  useEffect(()=>setDraft(value),[value]);
  const layer=state.document.layers.find(l=>l.id===primitive.layerId),disabled=!definition||owner?.type!=='block_instance'||isLayerLocked(state.document,owner)||!layer||layer.locked;
  const commit=()=>{if(draft===value)return;dispatch({type:'execute',command:{type:'update-block-attribute',entityId:ownerId,tag,attributeIndex:index,...(sourceHandle?{sourceHandle}:{}),patch:{value:draft}}});};
  const model=transformPoint(primitive.position,resolveDeepSelection(state.document,state.deepSelection!)?.matrix??[1,0,0,1,0,0]);
  const rotation=primitive.rotationDeg+(owner?.type==='block_instance'&&owner.attributeCoordinateSpace==='block-local'?owner.rotationDeg:0);
  return <><dl className="property-facts"><dt>Владелец</dt><dd>{definition?.sourceName??owner?.name}</dd><dt>Tag</dt><dd>{tag}</dd><dt>Тип</dt><dd>Атрибут блока</dd><dt>MODEL X/Y</dt><dd>{formatCoordinate(model.x)} / {formatCoordinate(model.y)} м</dd><dt>Поворот</dt><dd>{formatCoordinate(rotation)}°</dd><dt>Высота</dt><dd>{formatCoordinate(primitive.height)} м</dd><dt>Исходный слой</dt><dd>{primitive.source?.originalLayer??layer?.name??primitive.layerId}</dd><dt>Source handle</dt><dd>{primitive.source?.handle??'—'}</dd></dl>
    <label className="coordinate-field"><span>Значение</span><input aria-label="Значение атрибута" value={draft} disabled={disabled} maxLength={10000} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();}}}/></label>
    <button type="button" className="secondary-action" disabled={disabled||draft===value} onClick={commit}>Применить</button>
    <p className="field-help">Enter или «Применить» сохраняет это значение у выбранной вставки. Перетащите атрибут на схеме, чтобы изменить его позицию.</p></>;
}

export const PropertyInspector = memo(function PropertyInspector({ state, dispatch, size }: { size: ViewSize; state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const entity = state.document.entities.find(item => item.id === state.selectionId);
  const semanticIndex = useMemo(()=>createProvenanceIndex(state.document),[state.document]);
  const summary = useMemo(()=>entity?semanticIndex.getEntitySemanticSummary(entity.id):undefined,[entity,semanticIndex]);
  const deep = state.deepSelection ? resolveDeepSelection(state.document,state.deepSelection) : null;
  const heading = entity?.type==='block_instance' ? summary?.blockName ?? entity.name : entity?.type==='imported_graphic' ? entity.semanticContent?.primaryText ?? entity.name : entity?.name;
  const subtitle = entity?.type==='imported_graphic' && entity.source?.originalType==='MULTILEADER' ? 'Мультивыноска' : entity?.type==='imported_graphic' && entity.source?.originalType==='DIMENSION' ? 'DXF размер' : entity ? typeNames[entity.type] : '';
  const selectedLayer = state.document.layers.find(layer => layer.id === state.selectedLayerId);
  const locked = entity ? isLayerLocked(state.document, entity) : false;
  return <aside className="right-panel" aria-label="Свойства объекта">
    <div className="panel-heading"><h2>Свойства</h2><span className="subtle">{selectedLayer ? 'Слой' : state.selectedEntityIds.length > 1 ? `${state.selectedEntityIds.length} объектов` : entity ? '1 объект' : `Текущий: ${state.document.layers.find(layer => layer.id === state.currentLayerId)?.name ?? '—'}`}</span></div>
    {state.selectedEntityIds.length>1 && <p data-testid="group-properties"><strong>Выбрано: {state.selectedEntityIds.length} объектов</strong> · Переместить… / M</p>}
    <MoveSelectionPanel state={state} dispatch={dispatch} />
    {state.orderedPointIds.length >= 2 && <div className="ordered-selection"><h3>Точки по порядку · {state.orderedPointIds.length}</h3><ol>{state.orderedPointIds.map(id => <li key={id}>{state.document.entities.find(entity => entity.id === id)?.name}</li>)}</ol><div><button onClick={() => dispatch({ type: 'from-selected-points', kind: 'polyline' })}>Создать полилинию</button><button disabled={state.orderedPointIds.length < 3} onClick={() => dispatch({ type: 'from-selected-points', kind: 'polygon' })}>Создать границу</button></div></div>}
    {selectedLayer ? <LayerProperties layer={selectedLayer} state={state} dispatch={dispatch} size={size} /> : deep && state.deepSelection ? <div className="inspector-content" data-testid="deep-properties">
      {state.deepSelection.attribute&&state.deepSelection.sourceType==='ATTRIB'&&deep.primitive.kind==='text'&&state.deepSelection.attributeTag ? <>
        <div className="entity-heading"><div><h3>Атрибут блока</h3><span>{summary?.blockName??entity?.name}</span></div></div>
        <BlockAttributeEditor key={`${state.deepSelection.ownerEntityId}:${state.deepSelection.attributeTag}`} state={state} dispatch={dispatch} tag={state.deepSelection.attributeTag} value={deep.primitive.content} primitive={deep.primitive} index={state.deepSelection.primitivePath[0]!} ownerId={state.deepSelection.ownerEntityId} {...(deep.source?.handle?{sourceHandle:deep.source.handle}:{})}/>
        <dl className="property-facts"><dt>ID владельца</dt><dd data-testid="selected-id">{state.deepSelection.ownerEntityId}</dd><dt>Путь</dt><dd>{[...state.deepSelection.blockPath,state.deepSelection.sourceType].join(' → ')} · {state.deepSelection.primitivePath.join('.')}</dd></dl>
      </> : <>
        <div className="entity-heading"><div><h3>{deep.primitive.kind==='text'?deep.primitive.content:state.deepSelection.sourceType}</h3><span>Вложенный элемент · только просмотр</span></div></div>
        <dl className="property-facts"><dt>Владелец</dt><dd>{summary?.blockName??entity?.name}</dd><dt>ID владельца</dt><dd data-testid="selected-id">{state.deepSelection.ownerEntityId}</dd>
          <dt>Путь</dt><dd>{[...state.deepSelection.blockPath,state.deepSelection.sourceType].join(' → ')} · {state.deepSelection.primitivePath.join('.')}</dd><dt>Тип</dt><dd>{state.deepSelection.sourceType}</dd><dt>Исходный слой</dt><dd>{deep.source?.originalLayer??deep.primitive.layerId}</dd><dt>Source handle</dt><dd>{deep.source?.handle??'—'}</dd>
          {deep.primitive.kind==='text'&&<><dt>Текст</dt><dd>{deep.primitive.content}</dd></>}
          <dt>MODEL X/Y</dt><dd>{'position' in deep.primitive?(()=>{const p=transformPoint(deep.primitive.position,deep.matrix);return `${formatCoordinate(p.x)} / ${formatCoordinate(p.y)} м`;})():'center' in deep.primitive?`${deep.primitive.center.x} / ${deep.primitive.center.y}`:deep.primitive.points.map(p=>`${p.x} / ${p.y}`).slice(0,4).join('; ')}</dd></dl>
        <p className="read-only-banner">{state.deepSelection.sourceType==='ATTDEF'?'ATTDEF — шаблон определения. Его правка затронула бы экземпляры; редактор определения блока пока не поддерживается.':state.deepSelection.sourceType==='TEXT'||state.deepSelection.sourceType==='MTEXT'?'Этот текст входит в определение блока. Изменение затронуло бы все экземпляры блока. Редактор определения блока пока не реализован.':NESTED_MOVE_MESSAGE}</p>
      </>}
    </div> : entity ? <div className="inspector-content">
      <div className="entity-heading"><span className="entity-icon"><Icon name={entity.type==='connector'?'line':['arc','circle','block_instance','imported_graphic'].includes(entity.type) ? 'symbol' : entity.type === 'polyline' ? 'line' : entity.type === 'symbol' ? 'symbol' : entity.type === 'label' ? 'text' : entity.type} size={23} /></span><div><h3>{heading}</h3><span>{subtitle}</span></div><button className="close-button" aria-label="Снять выбор" onClick={() => dispatch({ type: 'select', entityId: null })}>×</button></div>
      <div className="property-section"><h3>Общие</h3><dl className="property-facts"><dt>ID</dt><dd className="mono" data-testid="selected-id">{entity.id}</dd><dt>Тип</dt><dd>{subtitle}</dd></dl>
        <label className="layer-field">Слой<select aria-label="Слой объекта" value={entity.layerId} disabled={locked} onChange={event => dispatch({ type: 'execute', command: { type: 'set-entity-layer', entityId: entity.id, layerId: event.target.value } })}>
          {state.document.layers.map(layer => <option key={layer.id} value={layer.id} disabled={layer.locked}>{layer.name}</option>)}
        </select></label>
        {locked && <p className="read-only-banner">Слой заблокирован · только просмотр</p>}
      </div>
      {entity.source && <div className="property-section"><h3>Источник DXF</h3><dl className="property-facts"><dt>Тип</dt><dd>{entity.source.originalType}</dd><dt>Исходный слой</dt><dd>{entity.source.originalLayer}</dd><dt>Handle</dt><dd>{entity.source.handle ?? '—'}</dd></dl></div>}
      {entity.type === 'block_instance' && <div className="property-section"><h3>Блок</h3><dl className="property-facts"><dt>Имя</dt><dd>{summary?.blockName}</dd><dt>Название экземпляра</dt><dd>{entity.name}</dd><dt>Вложенных primitives</dt><dd>{summary?.primitiveCount}</dd><dt>Экземпляров definition</dt><dd>{summary?.instanceCount}</dd><dt>MODEL X/Y</dt><dd>{entity.position.x} / {entity.position.y}</dd><dt>Поворот</dt><dd>{entity.rotationDeg}°</dd><dt>Scale X/Y/Z</dt><dd>{entity.scaleX} / {entity.scaleY} / {entity.scaleZ??1}</dd>{Object.entries(entity.attributes??{}).map(([k,v])=><Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl><p>Move Selection перемещает экземпляр целиком.</p></div>}
      {(entity.type === 'arc' || entity.type === 'circle') && <div className="property-section"><h3>Дуга / окружность</h3><dl className="property-facts"><dt>Центр X/Y</dt><dd>{entity.center.x} / {entity.center.y}</dd><dt>Радиус</dt><dd>{entity.radius} м</dd>{entity.type==='arc'&&<><dt>Углы, рад</dt><dd>{entity.startAngle} / {entity.endAngle}</dd></>}</dl><p>Move / слой доступны; редактор дуги пока отсутствует.</p></div>}
      {entity.type === 'imported_graphic' && entity.semanticContent && <div className="property-section" data-testid="imported-semantic-content"><h3>{subtitle}</h3><dl className="property-facts">{entity.semanticContent.primaryText&&<><dt>Текст</dt><dd>{entity.semanticContent.primaryText}</dd></>}{entity.semanticContent.measuredValue!==undefined&&<><dt>Значение</dt><dd>{entity.semanticContent.measuredValue}</dd></>}{entity.semanticContent.dimensionType!==undefined&&<><dt>DXF dimension type</dt><dd>{entity.semanticContent.dimensionType}</dd></>}</dl><p className="field-help">Импортированный composite · семантика только для просмотра.</p></div>}
      {entity.type === 'imported_graphic' && <div className="property-section"><h3>Векторный proxy</h3><p>{entity.primitives.length} primitives. Доступны Move, смена слоя и удаление.</p></div>}
      {entity.type==='connector'?<ConnectorProperties entity={entity} state={state} locked={locked} dispatch={dispatch}/>:entity.type === 'symbol' ? <SymbolProperties key={entity.id} entity={entity} document={state.document} locked={locked} dispatch={dispatch} /> : entity.type === 'point' ? <PointProperties key={entity.id} entity={entity} document={state.document} dispatch={dispatch} /> : entity.type === 'label' ? <LabelProperties entity={entity} document={state.document} locked={locked} dispatch={dispatch} /> : entity.type === 'text' ? <div className="property-section"><h3>Текст</h3><TextContentField entity={entity} locked={locked} dispatch={dispatch} /><TextCoordinates entity={entity} document={state.document} locked={locked} dispatch={dispatch} /></div> : ['arc','circle','block_instance','imported_graphic'].includes(entity.type) ? null : <GeometryProperties entity={entity} document={state.document} locked={locked} dispatch={dispatch} />}
      {['point', 'line', 'polyline', 'polygon', 'symbol'].includes(entity.type) && <LabelPresets key={`labels:${entity.id}`} entity={entity} state={state} dispatch={dispatch} />}
      {!locked && <button className="delete-object-button" onClick={() => dispatch({ type: 'execute', command: { type: 'delete-entity', entityId: entity.id } })}><Icon name="trash" size={15} />Удалить объект <span>Del</span></button>}
      <div className="property-note"><span className="live-dot" /> Объект в мировой системе координат</div>
    </div> : <div className="empty-inspector"><div className="empty-symbol"><Icon name="cursor" size={30} /></div><h3>Выберите объект</h3><p>Нажмите на точку, линию, полигон или подпись на схеме.</p><div className="empty-preview"><span>X</span><i /><span>Y</span><i /><span>Z</span><i /></div><small>Свойства и координаты появятся здесь</small></div>}
    <div className="inspector-footer"><span>Изменения сохраняются в этом браузере.</span><small>Save экспортирует полный документ в JSON.</small></div>
  </aside>;
},(a,b)=>a.dispatch===b.dispatch&&a.size===b.size&&(Object.keys(a.state) as (keyof EditorState)[]).every(key=>key==='viewport'||a.state[key]===b.state[key]));
