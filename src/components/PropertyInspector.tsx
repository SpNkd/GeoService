import { useEffect, useState, type Dispatch } from 'react';
import { entityVertexIds, type Entity, type GeoDocument, type PointEntity } from '../domain/model';
import { distance, pathLength, polygonArea } from '../geometry';
import { formatCoordinate, formatMeasure } from '../geometry/format';
import { isLayerLocked } from '../domain/commands';
import { vertexFor } from '../renderer/selectors';
import type { EditorAction, EditorState } from '../store/editor';
import { Icon } from './Icon';

const typeNames: Record<Entity['type'], string> = { point: 'Точка', line: 'Линия', polyline: 'Полилиния', polygon: 'Полигон', text: 'Текст' };

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
  const disabled = isLayerLocked(document, entity);
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
    {disabled ? <p className="field-help lock-message">Слой заблокирован. Объект доступен только для просмотра.</p> : <p className="field-help">Изменения применяются сразу. Полная точность доступна в поле ввода.</p>}
  </div>;
}
function GeometryProperties({ entity, document }: { entity: Exclude<Entity, PointEntity>; document: GeoDocument }) {
  const ids = entityVertexIds(entity);
  const points = ids.map(id => vertexFor(document, id));
  const worldPoints = points.map(({ x, y, z }) => z === undefined ? { x, y } : { x, y, z });
  return <div className="property-section"><h3>Геометрия</h3><dl className="property-facts">
    {entity.type === 'line' && <><dt>Длина</dt><dd>{formatMeasure(distance(worldPoints[0]!, worldPoints[1]!))} м</dd></>}
    {entity.type === 'polyline' && <><dt>Длина</dt><dd>{formatMeasure(pathLength(worldPoints))} м</dd></>}
    {entity.type === 'polygon' && <><dt>Площадь</dt><dd>{formatMeasure(polygonArea(worldPoints))} м²</dd><dt>Периметр</dt><dd>{formatMeasure(pathLength(worldPoints, true))} м</dd></>}
    {entity.type === 'text' && <><dt>Содержание</dt><dd className="text-content">{entity.content}</dd><dt>Размер текста</dt><dd>{entity.fontSize} px</dd></>}
    <dt>Вершины</dt><dd>{points.length}</dd>
  </dl><div className="vertex-table"><table><thead><tr><th>Вершина</th><th>X, м</th><th>Y, м</th></tr></thead><tbody>
    {points.map(vertex => <tr key={vertex.id}><td title={vertex.id}>{vertex.id}</td><td>{formatCoordinate(vertex.x)}</td><td>{formatCoordinate(vertex.y)}</td></tr>)}
  </tbody></table></div></div>;
}

export function PropertyInspector({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const entity = state.document.entities.find(item => item.id === state.selectionId);
  const locked = entity ? isLayerLocked(state.document, entity) : false;
  return <aside className="right-panel" aria-label="Свойства объекта">
    <div className="panel-heading"><h2>Свойства</h2><span className="subtle">{entity ? '1 объект' : 'Нет выбора'}</span></div>
    {entity ? <div className="inspector-content">
      <div className="entity-heading"><span className="entity-icon"><Icon name={entity.type === 'polyline' ? 'line' : entity.type} size={23} /></span><div><h3>{entity.name}</h3><span>{typeNames[entity.type]}</span></div><button className="close-button" aria-label="Снять выбор" onClick={() => dispatch({ type: 'select', entityId: null })}>×</button></div>
      <div className="property-section"><h3>Общие</h3><dl className="property-facts"><dt>ID</dt><dd className="mono" data-testid="selected-id">{entity.id}</dd><dt>Тип</dt><dd>{typeNames[entity.type]}</dd></dl>
        <label className="layer-field">Слой<select aria-label="Слой объекта" value={entity.layerId} disabled={locked} onChange={event => dispatch({ type: 'execute', command: { type: 'set-entity-layer', entityId: entity.id, layerId: event.target.value } })}>
          {state.document.layers.map(layer => <option key={layer.id} value={layer.id} disabled={layer.locked}>{layer.name}</option>)}
        </select></label>
        {locked && <p className="read-only-banner">Слой заблокирован · только просмотр</p>}
      </div>
      {entity.type === 'point' ? <PointProperties key={entity.id} entity={entity} document={state.document} dispatch={dispatch} /> : <GeometryProperties entity={entity} document={state.document} />}
      {!locked && <button className="delete-object-button" onClick={() => dispatch({ type: 'execute', command: { type: 'delete-entity', entityId: entity.id } })}><Icon name="trash" size={15} />Удалить объект <span>Del</span></button>}
      <div className="property-note"><span className="live-dot" /> Объект в мировой системе координат</div>
    </div> : <div className="empty-inspector"><div className="empty-symbol"><Icon name="cursor" size={30} /></div><h3>Выберите объект</h3><p>Нажмите на точку, линию, полигон или подпись на схеме.</p><div className="empty-preview"><span>X</span><i /><span>Y</span><i /><span>Z</span><i /></div><small>Свойства и координаты появятся здесь</small></div>}
    <div className="inspector-footer"><span>Сохранение пока не подключено.</span><small>Изменения действуют до перезагрузки страницы.</small></div>
  </aside>;
}
