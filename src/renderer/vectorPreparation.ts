import type { Entity, GeoDocument, WorldPoint } from '../domain/model';
import type { BlockDefinition, VectorPrimitive } from '../vectors/types';
import { blockDefinition, blockMatrix, primitiveBounds, transformPoint } from '../vectors/geometry';

interface PreparedSet { origin: WorldPoint; primitives: VectorPrimitive[] }
const emptyBlocks: BlockDefinition[] = [];
const zero = { x: 0, y: 0 };
const caches = new WeakMap<BlockDefinition[], WeakMap<VectorPrimitive[], PreparedSet>>();
const revisions=new WeakMap<VectorPrimitive[],{dependencies:BlockDefinition[];prepared:PreparedSet}>();
/** Derived renderer coordinates only. Canonical geometry, provenance and world bounds stay untouched. */
export function prepareVectorSet(document: GeoDocument, primitives: VectorPrimitive[]): PreparedSet {
  const library = document.blocks ?? emptyBlocks;
  let cache = caches.get(library);
  if (!cache) { cache = new WeakMap(); caches.set(library, cache); }
  const cached = cache.get(primitives);
  if (cached) return cached;
  const dependencies:BlockDefinition[]=[],seen=new Set<string>();
  const visit=(ps:VectorPrimitive[])=>{for(const p of ps)if(p.kind==='block'&&!seen.has(p.blockDefinitionId)){seen.add(p.blockDefinitionId);const child=blockDefinition(document,p.blockDefinitionId);if(child){dependencies.push(child);visit(child.primitives);}}};
  visit(primitives);
  const revision=revisions.get(primitives);
  if(revision&&revision.dependencies.length===dependencies.length&&dependencies.every((b,i)=>b===revision.dependencies[i])){cache.set(primitives,revision.prepared);return revision.prepared;}
  const bounds = primitiveBounds(document, primitives);
  const origin = bounds.length ? { x: bounds[0]!.x / 2 + bounds[2]!.x / 2, y: bounds[0]!.y / 2 + bounds[2]!.y / 2 } : zero;
  const relative = (p: WorldPoint): WorldPoint => ({ ...p, x: p.x - origin.x, y: p.y - origin.y });
  const prepared = primitives.map((p): VectorPrimitive => {
    if (p.kind === 'path') return { ...p, points: p.points.map(relative) };
    if (p.kind === 'circle' || p.kind === 'arc') return { ...p, center: relative(p.center) };
    if (p.kind === 'text') return { ...p, position: relative(p.position) };
    const child = blockDefinition(document, p.blockDefinitionId);
    const childBounds = child ? primitiveBounds(document, child.primitives, [child.id]) : [];
    const childOrigin = childBounds.length ? { x: childBounds[0]!.x / 2 + childBounds[2]!.x / 2, y: childBounds[0]!.y / 2 + childBounds[2]!.y / 2 } : zero;
    // child local origin -> original base point/INSERT -> parent local origin.
    return { ...p, position: relative(transformPoint(childOrigin, blockMatrix(p, child?.basePoint ?? zero))) };
  });
  const result = { origin, primitives: prepared };
  cache.set(primitives, result);
  revisions.set(primitives,{dependencies,prepared:result});
  return result;
}
export function vectorRenderOrigin(document: GeoDocument, entity: Entity): WorldPoint {
  if (entity.type === 'arc' || entity.type === 'circle') return entity.center;
  if (entity.type === 'imported_graphic') {
    const origin = prepareVectorSet(document, entity.primitives).origin;
    return { x: entity.position.x + origin.x, y: entity.position.y + origin.y };
  }
  if (entity.type === 'block_instance') {
    const block = blockDefinition(document, entity.blockDefinitionId);
    if (block) return transformPoint(prepareVectorSet(document, block.primitives).origin, blockMatrix(entity, block.basePoint));
    return entity.position;
  }
  return zero;
}
