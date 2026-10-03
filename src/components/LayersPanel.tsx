import type { Dispatch } from 'react';
import type { EditorAction, EditorState } from '../store/editor';
import { Icon } from './Icon';

export function LayersPanel({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const { document } = state;
  const selected = document.entities.find(entity => entity.id === state.selectionId);
  return <aside className="left-panel" aria-label="Слои документа">
    <div className="panel-heading"><Icon name="layers" size={16} /><h2>Слои</h2><span className="badge">{document.layers.length}</span></div>
    <div className="layer-list">
      {[...document.layers].sort((a, b) => a.order - b.order).map(layer => {
        const count = document.entities.filter(entity => entity.layerId === layer.id).length;
        const color = document.styles.find(style => style.id === layer.styleId)?.stroke;
        return <div key={layer.id} className={`layer-row ${!layer.visible ? 'hidden-layer' : ''} ${selected?.layerId === layer.id ? 'active-layer' : ''}`}>
          <span className="layer-color" style={{ background: color }} />
          <div className="layer-name"><span>{layer.name}</span><small>{count} объектов{layer.locked ? ' · заблокирован' : ''}</small></div>
          <button className="icon-button small" aria-label={`${layer.visible ? 'Скрыть' : 'Показать'} слой ${layer.name}`} title={layer.visible ? 'Скрыть слой' : 'Показать слой'}
            aria-pressed={layer.visible} onClick={() => dispatch({ type: 'command', command: { type: 'set-layer-visibility', layerId: layer.id, visible: !layer.visible } })}><Icon name={layer.visible ? 'eye' : 'eye-off'} size={16} /></button>
          <button className="icon-button small" aria-label={`${layer.locked ? 'Разблокировать' : 'Заблокировать'} слой ${layer.name}`} title={layer.locked ? 'Разблокировать слой' : 'Заблокировать слой'}
            aria-pressed={layer.locked} onClick={() => dispatch({ type: 'command', command: { type: 'set-layer-lock', layerId: layer.id, locked: !layer.locked } })}><Icon name={layer.locked ? 'lock' : 'unlock'} size={15} /></button>
        </div>;
      })}
    </div>
    <div className="panel-section"><h3>Документ</h3>
      <dl className="document-facts"><dt>Система координат</dt><dd>Локальная / декартова</dd><dt>Единицы</dt><dd>Метры (м)</dd><dt>Оси</dt><dd>X → восток · Y → север</dd><dt>Объекты</dt><dd>{document.entities.length} в модели</dd></dl>
    </div>
    <div className="sidebar-note"><Icon name="crosshair" size={20} /><p>Точность в модели<small>Координаты хранятся без округления. Масштаб влияет только на вид.</small></p></div>
    <div className="panel-foot"><span className="live-dot" /> Локальный прототип <span className="version">v0.1</span></div>
  </aside>;
}
