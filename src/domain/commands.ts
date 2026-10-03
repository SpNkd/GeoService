import type { GeoDocument, WorldPoint } from './model';

/** Both UI and future intent adapters must enter through this deterministic boundary. */
export type DocumentCommand =
  | { type: 'set-point-position'; entityId: string; position: WorldPoint }
  | { type: 'set-entity-layer'; entityId: string; layerId: string }
  | { type: 'set-layer-visibility'; layerId: string; visible: boolean }
  | { type: 'set-layer-lock'; layerId: string; locked: boolean };

export function applyCommand(document: GeoDocument, command: DocumentCommand): GeoDocument {
  if (command.type === 'set-layer-visibility' || command.type === 'set-layer-lock') {
    if (!document.layers.some(layer => layer.id === command.layerId)) throw new Error('Слой не найден');
    return {
      ...document,
      layers: document.layers.map(layer => layer.id !== command.layerId ? layer : {
        ...layer,
        ...(command.type === 'set-layer-visibility' ? { visible: command.visible } : { locked: command.locked }),
      }),
    };
  }
  const entity = document.entities.find(item => item.id === command.entityId);
  if (!entity) throw new Error('Объект не найден');
  const layer = document.layers.find(item => item.id === entity.layerId);
  if (!layer || layer.locked) throw new Error('Слой заблокирован или отсутствует');
  if (command.type === 'set-point-position') {
    if (entity.type !== 'point') throw new Error('Команда ожидает точку');
    const { x, y, z } = command.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || (z !== undefined && !Number.isFinite(z))) {
      throw new Error('Координаты должны быть конечными числами');
    }
    return { ...document, entities: document.entities.map(item => item.id === entity.id ? { ...entity, position: { ...command.position } } : item) };
  }
  const destination = document.layers.find(item => item.id === command.layerId);
  if (!destination || destination.locked) throw new Error('Целевой слой заблокирован или отсутствует');
  return { ...document, entities: document.entities.map(item => item.id === entity.id ? { ...item, layerId: destination.id } : item) };
}
