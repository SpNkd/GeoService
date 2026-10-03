import type { Entity, GeoDocument, Vertex } from '../domain/model';
import { worldVertex } from '../domain/model';

const point = (id: string, x: number, y: number, z?: number): Vertex => worldVertex(id, z === undefined ? { x, y } : { x, y, z });

export function createSampleDocument(): GeoDocument {
  const vertices: Record<string, Vertex> = Object.fromEntries([
    point('v-p1', 1000, 2000, 152.34), point('v-p2', 1060, 2000, 152.425),
    point('v-p3', 1060, 2040, 152.61), point('v-p4', 1000, 2040, 152.505),
    point('v-sp1', 1008.234567, 2010.221, 152.34), point('v-sp2', 1047.82, 2027.41, 152.785),
    point('v-sp3', 1049.125, 2008.54, 152.195), point('v-path-mid', 1011.5, 2030),
    point('v-building-1', 1020, 2014), point('v-building-2', 1038, 2014),
    point('v-building-3', 1038, 2026), point('v-building-4', 1020, 2026),
    point('v-building-label', 1021, 2024), point('v-site-label', 1015, 2035),
  ].map(vertex => [vertex.id, vertex]));
  const entities: Entity[] = [
    { id: 'boundary-01', name: 'Граница участка', type: 'polygon', layerId: 'boundary', vertexIds: ['v-p1', 'v-p2', 'v-p3', 'v-p4'] },
    { id: 'building-01', name: 'Здание 01', type: 'polygon', layerId: 'buildings', vertexIds: ['v-building-1', 'v-building-2', 'v-building-3', 'v-building-4'] },
    { id: 'baseline-01', name: 'Базовая линия', type: 'line', layerId: 'boundary', styleId: 'auxiliary', startVertexId: 'v-sp1', endVertexId: 'v-sp3' },
    { id: 'survey-path', name: 'Съёмочный ход', type: 'polyline', layerId: 'survey-points', styleId: 'auxiliary', vertexIds: ['v-sp1', 'v-path-mid', 'v-sp2'] },
    { id: 'p1', name: 'P1', type: 'point', layerId: 'survey-points', vertexId: 'v-p1' },
    { id: 'p2', name: 'P2', type: 'point', layerId: 'survey-points', vertexId: 'v-p2' },
    { id: 'p3', name: 'P3', type: 'point', layerId: 'survey-points', vertexId: 'v-p3' },
    { id: 'p4', name: 'P4', type: 'point', layerId: 'survey-points', vertexId: 'v-p4' },
    { id: 'sp1', name: 'ГТ-01', type: 'point', layerId: 'survey-points', vertexId: 'v-sp1' },
    { id: 'sp2', name: 'ГТ-02', type: 'point', layerId: 'survey-points', vertexId: 'v-sp2' },
    { id: 'sp3', name: 'ГТ-03', type: 'point', layerId: 'survey-points', vertexId: 'v-sp3' },
    { id: 'building-label', name: 'Подпись здания', type: 'text', layerId: 'annotations', vertexId: 'v-building-label', content: 'ЗДАНИЕ 01', fontSize: 12 },
    { id: 'site-label', name: 'Подпись участка', type: 'text', layerId: 'annotations', vertexId: 'v-site-label', content: 'УЧАСТОК 01 · 2 400 м²', fontSize: 11 },
  ];
  return {
    schemaVersion: 2,
    metadata: { id: 'demo-site-01', title: 'Участок 01', description: 'Демонстрационная геодезическая схема' },
    coordinateSystem: { kind: 'local', name: 'Локальная система', xAxis: 'east', yAxis: 'north', zAxis: 'up' },
    units: { length: 'm', area: 'm2' }, vertices,
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
