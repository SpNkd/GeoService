import { useEffect, useState, type Dispatch } from 'react';
import { entityPoints, type Entity, type PointEntity } from '../domain/model';
import { distance, pathLength, polygonArea } from '../geometry';
import { formatCoordinate, formatMeasure } from '../geometry/format';
import type { EditorAction, EditorState } from '../store/editor';
import { Icon } from './Icon';

const typeNames: Record<Entity['type'], string> = { point: 'Точка', line: 'Линия', polyline: 'Полилиния', polygon: 'Полигон', text: 'Текст' };

function CoordinateField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const parsed = draft.trim() !== '' ? Number(draft) : NaN;
  const valid = Number.isFinite(parsed);
  useEffect(() => {
    setDraft(previous => previous.trim() !== '' && Number(previous) === value ? previous : String(value));
  }, [value]);
  return <label className="coordinate-field"><span>{label}</span><div className={!valid ? 'invalid-input' : ''}>
    <input aria-label={label} type="text" inputMode="decimal" spellCheck={false} value={draft} aria-invalid={!valid}
      onChange={event => {
        const next = event.target.value;
        setDraft(next);
        if (next.trim() !== '' && Number.isFinite(Number(next))) onChange(Number(next));
      }}
      onBlur={() => setDraft(String(value))}
    /><span>м</span></div></label>;
}
function PointProperties({ entity, dispatch }: { entity: PointEntity; dispatch: Dispatch<EditorAction> }) {
  return <div className="property-section"><h3>Координаты</h3>
    <CoordinateField label="X" value={entity.position.x} onChange={x => dispatch({ type: 'command', command: { type: 'set-point-position', entityId: entity.id, position: { ...entity.position, x } } })} />
    <CoordinateField label="Y" value={entity.position.y} onChange={y => dispatch({ type: 'command', command: { type: 'set-point-position', entityId: entity.id, position: { ...entity.position, y } } })} />
    {entity.position.z !== undefined && <CoordinateField label="Z" value={entity.position.z} onChange={z => dispatch({ type: 'command', command: { type: 'set-point-position', entityId: entity.id, position: { ...entity.position, z } } })} />}
    <p className="field-help">Изменения применяются сразу. Полная точность доступна в поле ввода.</p>
  </div>;
}
function GeometryProperties({ entity }: { entity: Exclude<Entity, PointEntity> }) {
  const points = entityPoints(entity);
  return <div className="property-section"><h3>Геометрия</h3><dl className="property-facts">
    {entity.type === 'line' && <><dt>Длина</dt><dd>{formatMeasure(distance(entity.start, entity.end))} м</dd></>}
    {entity.type === 'polyline' && <><dt>Длина</dt><dd>{formatMeasure(pathLength(entity.vertices))} м</dd></>}
    {entity.type === 'polygon' && <><dt>Площадь</dt><dd>{formatMeasure(polygonArea(entity.vertices))} м²</dd><dt>Периметр</dt><dd>{formatMeasure(pathLength(entity.vertices, true))} м</dd></>}
    {entity.type === 'text' && <><dt>Содержание</dt><dd className="text-content">{entity.content}</dd><dt>Размер текста</dt><dd>{entity.fontSize} px</dd></>}
    <dt>{entity.type === 'text' ? 'Точка вставки' : 'Вершины'}</dt><dd>{points.length}</dd>
  </dl><div className="vertex-table"><table><thead><tr><th>№</th><th>X, м</th><th>Y, м</th></tr></thead><tbody>
    {points.map((point, index) => <tr key={index}><td>{index + 1}</td><td>{formatCoordinate(point.x)}</td><td>{formatCoordinate(point.y)}</td></tr>)}
  </tbody></table></div></div>;
}

export function PropertyInspector({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const entity = state.document.entities.find(item => item.id === state.selectionId);
  return <aside className="right-panel" aria-label="Свойства объекта">
    <div className="panel-heading"><h2>Свойства</h2><span className="subtle">{entity ? '1 объект' : 'Нет выбора'}</span></div>
    {entity ? <div className="inspector-content">
      <div className="entity-heading"><span className="entity-icon"><Icon name={entity.type === 'polyline' ? 'line' : entity.type} size={23} /></span><div><h3>{entity.name}</h3><span>{typeNames[entity.type]}</span></div><button className="close-button" aria-label="Снять выбор" onClick={() => dispatch({ type: 'select', entityId: null })}>×</button></div>
      <div className="property-section"><h3>Общие</h3><dl className="property-facts"><dt>ID</dt><dd className="mono" data-testid="selected-id">{entity.id}</dd><dt>Тип</dt><dd>{typeNames[entity.type]}</dd></dl>
        <label className="layer-field">Слой<select aria-label="Слой объекта" value={entity.layerId} onChange={event => dispatch({ type: 'command', command: { type: 'set-entity-layer', entityId: entity.id, layerId: event.target.value } })}>
          {state.document.layers.map(layer => <option key={layer.id} value={layer.id} disabled={layer.locked}>{layer.name}</option>)}
        </select></label>
      </div>
      {entity.type === 'point' ? <PointProperties key={entity.id} entity={entity} dispatch={dispatch} /> : <GeometryProperties entity={entity} />}
      <div className="property-note"><span className="live-dot" /> Объект в мировой системе координат</div>
    </div> : <div className="empty-inspector"><div className="empty-symbol"><Icon name="cursor" size={30} /></div><h3>Выберите объект</h3><p>Нажмите на точку, линию, полигон или подпись на схеме.</p><div className="empty-preview"><span>X</span><i /><span>Y</span><i /><span>Z</span><i /></div><small>Свойства и координаты появятся здесь</small></div>}
    <div className="inspector-footer"><span>Сохранение пока не подключено.</span><small>Изменения действуют до перезагрузки страницы.</small></div>
  </aside>;
}
