export interface SymbolPoint { x: number; y: number; z?: number }
export type SymbolPrimitive =
  | { type: 'line'; start: SymbolPoint; end: SymbolPoint }
  | { type: 'polyline' | 'polygon'; points: SymbolPoint[] }
  | { type: 'circle'; center: SymbolPoint; radius: number }
  | { type: 'rect'; position: SymbolPoint; width: number; height: number };
export interface SymbolPort { id: string; kind: 'process' | 'instrument'; position: SymbolPoint; directionDeg: number; role?: 'inlet' | 'outlet' | 'bidirectional' | 'instrument'; label?: string; maxConnections?: number }
export interface SymbolDefinition {
  id: string; name: string; aliases?: string[]; category: string; description?: string;
  geometry: SymbolPrimitive[];
  /** Metres per normalized local unit at instance scale 1. */
  defaultSize: number;
  allowedRotations?: number[]; ports: SymbolPort[]; metadata?: Record<string, string | number | boolean | null>;
}
export interface SymbolLibrary {
  id: string; name: string; version: string; description?: string; sourceStandards?: string[];
  categories: string[]; symbols: SymbolDefinition[];
}
export const MIN_SYMBOL_SCALE = 0.01;
export const MAX_SYMBOL_SCALE = 100;
export function normalizeSymbolRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new Error('Поворот должен быть конечным числом');
  const value = degrees % 360;
  return value < 0 ? value + 360 : value === 0 ? 0 : value;
}

export function nextSymbolRotation(current: number, allowed?: readonly number[]): number {
  return allowed ? allowed[(allowed.indexOf(current) + 1) % allowed.length]! : normalizeSymbolRotation(current + 90);
}
