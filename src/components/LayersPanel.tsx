import { memo, type Dispatch } from 'react';
import type { EditorAction, EditorState } from '../store/editor';
import { documentModelFrame } from '../geometry/georeferencing';
import { CoordinateReferencePanel } from './CoordinateReferencePanel';
import { Icon } from './Icon';

export const LayersPanel = memo(function LayersPanel({ state, dispatch, onCalibrate, inert = false }: { state: EditorState; dispatch: Dispatch<EditorAction>; onCalibrate: () => void; inert?: boolean }) {
  const { document } = state;
  return <aside inert={inert} className="left-panel" aria-label="Слои документа">
    <div className="panel-heading"><Icon name="layers" size={16} /><h2>Слои</h2><span className="badge">{document.layers.length}</span><button className="icon-button small" aria-label="Создать слой" title="Создать слой" onClick={() => dispatch({ type: 'create-layer' })}><Icon name="plus" size={16} /></button></div>
    <div className="layer-list">
      {[...document.layers].sort((a, b) => a.order - b.order).map((layer, index, layers) => {
        const count = document.entities.filter(entity => entity.layerId === layer.id).length;
        const color = document.styles.find(style => style.id === layer.styleId)?.stroke;
        return <div key={layer.id} className={`layer-row ${!layer.visible ? 'hidden-layer' : ''} ${state.selectedLayerId === layer.id ? 'active-layer' : ''}`}>
          <div className="layer-order"><button aria-label={`Поднять слой ${layer.name}`} disabled={index === 0} onClick={() => dispatch({ type: 'execute', command: { type: 'move-layer', layerId: layer.id, direction: -1 } })}>↑</button><button aria-label={`Опустить слой ${layer.name}`} disabled={index === layers.length - 1} onClick={() => dispatch({ type: 'execute', command: { type: 'move-layer', layerId: layer.id, direction: 1 } })}>↓</button></div>
          <span className="layer-color" style={{ background: color }} />
          <button type="button" className="layer-name" aria-label={`Выбрать слой ${layer.name}`} aria-pressed={state.selectedLayerId === layer.id} onDoubleClick={() => dispatch({ type: 'select-layer-objects', layerId: layer.id })} onClick={() => dispatch({ type: 'select-layer', layerId: layer.id })}><span>{layer.name}</span><small>{count} объектов{layer.locked ? ' · заблокирован' : ''}</small></button>
          <button className="icon-button small" aria-label={`${layer.visible ? 'Скрыть' : 'Показать'} слой ${layer.name}`} title={layer.visible ? 'Скрыть слой' : 'Показать слой'}
          aria-pressed={layer.visible} onClick={event => { event.stopPropagation(); dispatch({ type: 'execute', command: { type: 'set-layer-visibility', layerId: layer.id, visible: !layer.visible } }); }}><Icon name={layer.visible ? 'eye' : 'eye-off'} size={16} /></button>
          <button className="icon-button small" aria-label={`${layer.locked ? 'Разблокировать' : 'Заблокировать'} слой ${layer.name}`} title={layer.locked ? 'Разблокировать слой' : 'Заблокировать слой'}
            aria-pressed={layer.locked} onClick={event => { event.stopPropagation(); dispatch({ type: 'execute', command: { type: 'set-layer-lock', layerId: layer.id, locked: !layer.locked } }); }}><Icon name={layer.locked ? 'lock' : 'unlock'} size={15} /></button>
        </div>;
      })}
    </div>
    <div className="panel-section"><h3>Документ</h3>
      <dl className="document-facts"><dt>Система координат</dt><dd>{document.coordinateSystem.name ?? (documentModelFrame(document) === 'local' ? 'Локальная MODEL' : 'Проектная / direct')}</dd><dt>Единицы</dt><dd>Метры (м)</dd><dt>Оси модели</dt><dd>X / Y · Z вверх</dd><dt>Объекты</dt><dd>{document.entities.length} в модели</dd></dl>
    </div>
    <CoordinateReferencePanel state={state} dispatch={dispatch} onCalibrate={onCalibrate} />
    <div className="sidebar-note"><Icon name="crosshair" size={20} /><p>Точность в модели<small>Координаты хранятся без округления. Масштаб влияет только на вид.</small></p></div>
    <div className="panel-foot"><span className="live-dot" /> Локальный редактор <span className="version">v0.3</span></div>
  </aside>;
});
