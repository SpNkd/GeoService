import type { Entity, GeoDocument, PointEntity, TextEntity } from '../domain/model';

export function createSampleDocument(): GeoDocument {
  const points: PointEntity[] = [
    { id: 'p1', name: 'P1', type: 'point', layerId: 'survey-points', position: { x: 1000, y: 2000, z: 152.34 } },
    { id: 'p2', name: 'P2', type: 'point', layerId: 'survey-points', position: { x: 1060, y: 2000, z: 152.425 } },
    { id: 'p3', name: 'P3', type: 'point', layerId: 'survey-points', position: { x: 1060, y: 2040, z: 152.61 } },
    { id: 'p4', name: 'P4', type: 'point', layerId: 'survey-points', position: { x: 1000, y: 2040, z: 152.505 } },
    { id: 'sp1', name: 'ГТ-01', type: 'point', layerId: 'survey-points', position: { x: 1008.234567, y: 2010.221, z: 152.34 } },
    { id: 'sp2', name: 'ГТ-02', type: 'point', layerId: 'survey-points', position: { x: 1047.82, y: 2027.41, z: 152.785 } },
    { id: 'sp3', name: 'ГТ-03', type: 'point', layerId: 'survey-points', position: { x: 1049.125, y: 2008.54, z: 152.195 } },
  ];
  // Point labels are derived by the renderer so changing a point never detaches its label.
  // Standalone text below remains a first-class, independently selectable entity.
  const texts: TextEntity[] = [
    { id: 'building-label', name: 'Подпись здания', type: 'text', layerId: 'annotations', position: { x: 1021, y: 2024 }, content: 'ЗДАНИЕ 01', fontSize: 12 },
    { id: 'site-label', name: 'Подпись участка', type: 'text', layerId: 'annotations', position: { x: 1015, y: 2035 }, content: 'УЧАСТОК 01 · 2 400 м²', fontSize: 11 },
  ];
  const entities: Entity[] = [
    { id: 'boundary-01', name: 'Граница участка', type: 'polygon', layerId: 'boundary', vertices: [{ x: 1000, y: 2000 }, { x: 1060, y: 2000 }, { x: 1060, y: 2040 }, { x: 1000, y: 2040 }] },
    { id: 'building-01', name: 'Здание 01', type: 'polygon', layerId: 'buildings', vertices: [{ x: 1020, y: 2014 }, { x: 1038, y: 2014 }, { x: 1038, y: 2026 }, { x: 1020, y: 2026 }] },
    { id: 'baseline-01', name: 'Базовая линия', type: 'line', layerId: 'boundary', styleId: 'auxiliary', start: { x: 1008.234567, y: 2010.221 }, end: { x: 1049.125, y: 2008.54 } },
    { id: 'survey-path', name: 'Съёмочный ход', type: 'polyline', layerId: 'survey-points', styleId: 'auxiliary', vertices: [{ x: 1008.234567, y: 2010.221 }, { x: 1011.5, y: 2030 }, { x: 1047.82, y: 2027.41 }] },
    ...points, ...texts,
  ];
  return {
    schemaVersion: 1,
    metadata: { id: 'demo-site-01', title: 'Участок 01', description: 'Демонстрационная геодезическая схема' },
    coordinateSystem: { kind: 'local-cartesian', name: 'Локальная система', xAxis: 'east', yAxis: 'north', zAxis: 'up' },
    units: { length: 'm', area: 'm2' },
    layers: [
      { id: 'boundary', name: 'Граница участка', visible: true, locked: false, order: 0, styleId: 'boundary' },
      { id: 'buildings', name: 'Здания', visible: true, locked: false, order: 1, styleId: 'building' },
      { id: 'survey-points', name: 'Геодезические точки', visible: true, locked: false, order: 2, styleId: 'survey' },
      { id: 'annotations', name: 'Аннотации', visible: true, locked: false, order: 3, styleId: 'annotation' },
    ],
    entities,
    styles: [
      { id: 'boundary', stroke: '#21836e', fill: '#21836e08', lineWeight: 1.8 },
      { id: 'building', stroke: '#425c73', fill: '#e4ebf1', lineWeight: 1.8 },
      { id: 'survey', stroke: '#ba7240', fill: '#ffffff', lineWeight: 1.5 },
      { id: 'annotation', stroke: '#546675', fill: 'none', lineWeight: 1 },
      { id: 'auxiliary', stroke: '#93a5b0', fill: 'none', lineWeight: 1, dash: '5 5' },
    ],
    viewport: { center: { x: 1030, y: 2020 }, pixelsPerUnit: 10 },
  };
}
