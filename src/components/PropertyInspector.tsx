import { memo, useEffect, useState, type Dispatch } from 'react';
import { entityVertexIds, type Entity, type GeoDocument, type PointEntity, type TextEntity, type LabelEntity } from '../domain/model';
import { distance, pathLength, polygonArea } from '../geometry';
import { formatAzimuth, formatCoordinate, formatDistance, formatMeasure } from '../geometry/format';
import { isLayerLocked, canEditVertex } from '../domain/commands';
import { azimuth, polygonSelfIntersects } from '../geometry/survey';
import { vertexFor } from '../renderer/selectors';
import type { EditorAction, EditorState } from '../store/editor';
import { Icon } from './Icon';
import { createLabelCommand, newGeometryId } from '../domain/geometryIntent';
import { resolveLabelTemplate, resolvedLabelPosition } from '../geometry/labels';

const typeNames: Record<Entity['type'], string> = { point: 'Точка', line: 'Линия', polyline: 'Полилиния', polygon: 'Полигон', text: 'Текст', label: 'Связанная подпись', dimension: 'Размер' };

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
  const disabled = isLayerLocked(document, entity) || !canEditVertex(document, entity.vertexId);
  const change = (key: 'x' | 'y' | 'z', value: number) => {
    const { x, y, z } = vertex;
    const position = key === 'x' ? { x: value, y, ...(z !== undefined ? { z } : {}) }
      : key === 'y' ? { x, y: value, ...(z !== undefined ? { z } : {}) } : { x, y, z: value };
    dispatch({ type: 'transient', command: { type: 'update-vertex', vertexId: vertex.id, position } });
  };
  return <div className="property-section"><h3>Координаты</h3>
    <div className="vertex-id-row"><span>Вершина</span><code>{vertex.id}</code></div>
    <CoordinateField label="X" value={vertex.x} disabled={disabled} onChange={x => change('x', x)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} />
    <CoordinateField label="Y" value={vertex.y} disabled={disabled} onChange={y => change('y', y)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} />
    <CoordinateField label="Z" value={vertex.z} disabled={disabled} onChange={z => change('z', z)} onEditStart={() => dispatch({ type: 'begin-transaction' })} onEditEnd={() => dispatch({ type: 'commit-transaction' })} />
    {disabled ? <p className="field-help lock-message">Вершина используется заблокированным слоем. Координаты доступны только для просмотра.</p> : <p className="field-help">Изменения применяются сразу. Полная точность доступна в поле ввода.</p>}
  </div>;
}
function GeometryProperties({ entity, document }: { entity: Exclude<Entity, PointEntity>; document: GeoDocument }) {
  if (entity.type === 'label') return <div className="property-section"><h3>Связанная подпись</h3><dl className="property-facts"><dt>Цель</dt><dd>{document.entities.find(item => item.id === entity.targetId)?.name ?? 'Не найдена'}</dd></dl></div>;
  const ids = entityVertexIds(entity);
  const points = ids.map(id => vertexFor(document, id));
  const worldPoints = points.map(({ x, y, z }) => z === undefined ? { x, y } : { x, y, z });
  return <div className="property-section"><h3>Геометрия</h3><dl className="property-facts">
    {entity.type === 'line' && <><dt>Длина</dt><dd>{formatMeasure(distance(worldPoints[0]!, worldPoints[1]!))} м</dd></>}
    {(entity.type === 'line' || entity.type === 'dimension') && <><dt>Азимут</dt><dd>{formatAzimuth(azimuth(worldPoints[0]!, worldPoints[1]!))}</dd></>}
    {entity.type === 'dimension' && <><dt>Horizontal</dt><dd>{formatDistance(distance(worldPoints[0]!, worldPoints[1]!))}</dd><dt>Offset</dt><dd>{formatDistance(entity.offset)}</dd></>}
    {entity.type === 'polyline' && <><dt>Длина</dt><dd>{formatMeasure(pathLength(worldPoints))} м</dd></>}
    {entity.type === 'polygon' && <><dt>Площадь</dt><dd>{formatMeasure(polygonArea(worldPoints))} м²</dd><dt>Периметр</dt><dd>{formatMeasure(pathLength(worldPoints, true))} м</dd></>}
    {entity.type === 'text' && <><dt>Содержание</dt><dd className="text-content">{entity.content}</dd><dt>Размер текста</dt><dd>{entity.fontSize} px</dd></>}
    <dt>Вершины</dt><dd>{points.length}</dd>
  </dl><div className="vertex-table"><table><thead><tr><th>Вершина</th><th>X, м</th><th>Y, м</th></tr></thead><tbody>
    {points.map((vertex, i) => <tr key={`${vertex.id}:${i}`}><td title={vertex.id}>{vertex.id}</td><td>{formatCoordinate(vertex.x)}</td><td>{formatCoordinate(vertex.y)}</td></tr>)}
  </tbody></table></div>{entity.type === 'polygon' && polygonSelfIntersects(worldPoints) && <p className="geometry-warning">Граница самопересекается. Проверьте вершины.</p>}</div>;
}

function LayerProperties({ layer, state, dispatch }: { layer: GeoDocument['layers'][number]; state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const [name, setName] = useState(layer.name);
  useEffect(() => setName(layer.name), [layer.name]);
  const count = state.document.entities.filter(entity => entity.layerId === layer.id).length;
  return <div className="inspector-content">
    <div className="entity-heading"><span className="entity-icon"><Icon name="layers" size={23} /></span><div><h3>Слой</h3><span>{layer.id === state.currentLayerId ? 'Текущий слой' : 'Выбранный слой'}</span></div></div>
    <div className="property-section"><h3>Свойства слоя</h3>
      <label className="coordinate-field"><span>Название</span><input aria-label="Название слоя" value={name} onChange={event => setName(event.target.value)} onBlur={() => { if (name.trim() && name !== layer.name) dispatch({ type: 'execute', command: { type: 'update-layer', layerId: layer.id, name: name.trim() } }); else setName(layer.name); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      <dl className="property-facts"><dt>Объекты</dt><dd>{count}</dd><dt>Видимость</dt><dd>{layer.visible ? 'Виден' : 'Скрыт'}</dd><dt>Состояние</dt><dd>{layer.locked ? 'Заблокирован' : 'Доступен'}</dd></dl>
      <button disabled={!count} onClick={() => dispatch({ type: 'select-layer-objects', layerId: layer.id })}>Выбрать все объекты слоя</button>
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

export const PropertyInspector = memo(function PropertyInspector({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const entity = state.document.entities.find(item => item.id === state.selectionId);
  const selectedLayer = state.document.layers.find(layer => layer.id === state.selectedLayerId);
  const locked = entity ? isLayerLocked(state.document, entity) : false;
  return <aside className="right-panel" aria-label="Свойства объекта">
    <div className="panel-heading"><h2>Свойства</h2><span className="subtle">{selectedLayer ? 'Слой' : state.selectedEntityIds.length > 1 ? `${state.selectedEntityIds.length} объектов` : entity ? '1 объект' : `Текущий: ${state.document.layers.find(layer => layer.id === state.currentLayerId)?.name ?? '—'}`}</span></div>
    {state.orderedPointIds.length >= 2 && <div className="ordered-selection"><h3>Точки по порядку · {state.orderedPointIds.length}</h3><ol>{state.orderedPointIds.map(id => <li key={id}>{state.document.entities.find(entity => entity.id === id)?.name}</li>)}</ol><div><button onClick={() => dispatch({ type: 'from-selected-points', kind: 'polyline' })}>Создать полилинию</button><button disabled={state.orderedPointIds.length < 3} onClick={() => dispatch({ type: 'from-selected-points', kind: 'polygon' })}>Создать границу</button></div></div>}
    {selectedLayer ? <LayerProperties layer={selectedLayer} state={state} dispatch={dispatch} /> : entity ? <div className="inspector-content">
      <div className="entity-heading"><span className="entity-icon"><Icon name={entity.type === 'polyline' ? 'line' : entity.type === 'label' ? 'text' : entity.type} size={23} /></span><div><h3>{entity.name}</h3><span>{typeNames[entity.type]}</span></div><button className="close-button" aria-label="Снять выбор" onClick={() => dispatch({ type: 'select', entityId: null })}>×</button></div>
      <div className="property-section"><h3>Общие</h3><dl className="property-facts"><dt>ID</dt><dd className="mono" data-testid="selected-id">{entity.id}</dd><dt>Тип</dt><dd>{typeNames[entity.type]}</dd></dl>
        <label className="layer-field">Слой<select aria-label="Слой объекта" value={entity.layerId} disabled={locked} onChange={event => dispatch({ type: 'execute', command: { type: 'set-entity-layer', entityId: entity.id, layerId: event.target.value } })}>
          {state.document.layers.map(layer => <option key={layer.id} value={layer.id} disabled={layer.locked}>{layer.name}</option>)}
        </select></label>
        {locked && <p className="read-only-banner">Слой заблокирован · только просмотр</p>}
      </div>
      {entity.type === 'point' ? <PointProperties key={entity.id} entity={entity} document={state.document} dispatch={dispatch} /> : entity.type === 'label' ? <LabelProperties entity={entity} document={state.document} locked={locked} dispatch={dispatch} /> : entity.type === 'text' ? <div className="property-section"><h3>Текст</h3><TextContentField entity={entity} locked={locked} dispatch={dispatch} /><TextCoordinates entity={entity} document={state.document} locked={locked} dispatch={dispatch} /></div> : <GeometryProperties entity={entity} document={state.document} />}
      {entity.type !== 'label' && entity.type !== 'text' && <button onClick={() => { try { const command = createLabelCommand(state.document, entity.id); dispatch({ type: 'execute', command }); if (command.type === 'add-entity') dispatch({ type: 'select', entityId: command.entity.id }); } catch (error) { dispatch({ type: 'report-error', message: error instanceof Error ? error.message : 'Не удалось создать подпись' }); } }}>Добавить подпись</button>}
      {!locked && <button className="delete-object-button" onClick={() => dispatch({ type: 'execute', command: { type: 'delete-entity', entityId: entity.id } })}><Icon name="trash" size={15} />Удалить объект <span>Del</span></button>}
      <div className="property-note"><span className="live-dot" /> Объект в мировой системе координат</div>
    </div> : <div className="empty-inspector"><div className="empty-symbol"><Icon name="cursor" size={30} /></div><h3>Выберите объект</h3><p>Нажмите на точку, линию, полигон или подпись на схеме.</p><div className="empty-preview"><span>X</span><i /><span>Y</span><i /><span>Z</span><i /></div><small>Свойства и координаты появятся здесь</small></div>}
    <div className="inspector-footer"><span>Изменения сохраняются в этом браузере.</span><small>Save экспортирует полный документ в JSON.</small></div>
  </aside>;
});
