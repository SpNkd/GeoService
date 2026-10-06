import { useMemo } from 'react';
import type { GeoDocument, ImportedGraphicEntity } from '../domain/model';
import type { TableCandidate } from '../tables/detect';
import { fitToBounds } from '../geometry';
import { CanvasStratum } from '../renderer/CanvasStratum';
import { renderItems } from '../renderer/selectors';
/** Derived readonly definition preview. Never dispatched as a document or owner selection. */
export function TableGeometryPreview({ document, table }: {
    document: GeoDocument;
    table: TableCandidate;
}) { const size = { width: 420, height: 270 }, block = document.blocks?.find(b => b.sourceName === table.sourcePath[0]), preview = useMemo(() => { if (!block)
    return null; const entity: ImportedGraphicEntity = { id: 'table-definition-preview', name: block.sourceName, type: 'imported_graphic', position: { x: 0, y: 0 }, primitives: block.primitives, layerId: block.primitives[0]?.layerId ?? document.layers[0]!.id }; return { ...document, layers: document.layers.map(l => l.visible ? l : { ...l, visible: true }), entities: [entity] }; }, [block, document]), items = useMemo(() => preview ? renderItems(preview) : [], [preview]), camera = fitToBounds(table.box, size, 20); return preview && camera ? <details className="table-geometry-preview"><summary>Показать определение / Fit</summary><small>Локальные координаты определения · только чтение{!table.instantiated ? ' · без положения экземпляра в Model/Paper Space' : ''}</small><svg width="100%" viewBox="0 0 420 270" aria-label="Геометрия таблицы"><CanvasStratum document={preview} items={items} viewport={camera} size={size}/></svg></details> : null; }
