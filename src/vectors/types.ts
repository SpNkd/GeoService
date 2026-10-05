import type { WorldPoint } from '../domain/model';
/** Safe document-local geometry. Never raw SVG/HTML or external resources. */
export interface SourceProvenance { kind: 'dxf'; sourceDocumentId: string; handle?: string; originalType: string; originalLayer: string; blockName?: string; blockPath?: string[] }
export interface SourceDocument { id: string; filename: string; format: 'DXF'; dxfVersion: string; encoding: string; originalUnits: number; unitScaleToMeters?: number }
export interface PrimitiveStyle { layerId: string; colorMode: 'bylayer' | 'byblock' | 'explicit'; stroke?: string; lineWeight?: number; dash?: string; visible?: boolean; fillGroup?: string; fillOpacity?: number; source?: SourceProvenance }
export interface BlockTransform { position: WorldPoint; rotationDeg: number; scaleX: number; scaleY: number; scaleZ?: number }
export type VectorPrimitive = PrimitiveStyle & (
  | { kind: 'path'; points: WorldPoint[]; closed: boolean; fill?: boolean }
  | { kind: 'circle'; center: WorldPoint; radius: number }
  | { kind: 'arc'; center: WorldPoint; radius: number; startAngle: number; endAngle: number }
  | { kind: 'text'; position: WorldPoint; content: string; height: number; rotationDeg: number }
  | ({ kind: 'block'; blockDefinitionId: string; attributes?: Record<string, string> } & BlockTransform)
);
export interface BlockDefinition { id: string; sourceName: string; basePoint: WorldPoint; primitives: VectorPrimitive[] }
export const VECTOR_LIMITS = { blocks: 2000, primitives: 200000, points: 1000000, depth: 16, renderedPrimitives: 500000 } as const;
