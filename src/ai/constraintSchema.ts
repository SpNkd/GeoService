import { z } from 'zod';
const name = z.string().trim().min(1).max(128);
export const constraintReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('action'),actionIndex:z.number().int().min(0).max(7),result:z.enum(['point','object','boundary'])}),
  z.strictObject({kind:z.literal('named_entity'),name}),
  z.strictObject({kind:z.literal('current_selection')}),
]);
export type ConstraintReference = z.infer<typeof constraintReferenceSchema>;
const distance = z.number().finite().nonnegative();
export const insetsSchema = z.strictObject({north:distance,south:distance,east:distance,west:distance});
export const boundaryPlacementSchema = z.strictObject({type:z.literal('inside_boundary'),reference:constraintReferenceSchema,
  anchor:z.enum(['center','north','south','east','west','north_east','north_west','south_east','south_west']),inset:insetsSchema,
  minimumClearance:distance,offsetAlongSide:z.number().finite().nullable()});
export const pointPlacementSchema = z.discriminatedUnion('type', [boundaryPlacementSchema,
  z.strictObject({type:z.literal('between'),from:constraintReferenceSchema,to:constraintReferenceSchema}),
  z.strictObject({type:z.literal('relative_to'),reference:constraintReferenceSchema,direction:z.enum(['north','south','east','west']),distance}),
]);
export const extraConstraintSchema=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('fixed_side_distance'),side:z.enum(['north','south','east','west']),distance}),
 z.strictObject({type:z.literal('anchor'),value:z.enum(['center','north','south','east','west','north_east','north_west','south_east','south_west'])}),
 z.strictObject({type:z.literal('containment'),value:z.enum(['inside','outside'])}),
 z.strictObject({type:z.literal('alignment'),relation:z.enum(['parallel','perpendicular']),reference:constraintReferenceSchema}),
]);
export type ExtraConstraint=z.infer<typeof extraConstraintSchema>;
export const extraConstraintsSchema=z.array(extraConstraintSchema).min(1).max(12).optional();
export const spatialPointSchema = z.strictObject({type:z.literal('create_spatial_point'),name,placement:pointPlacementSchema});
export const routeSchema = z.strictObject({type:z.literal('create_route'),name,source:constraintReferenceSchema,target:constraintReferenceSchema,
  boundary:constraintReferenceSchema.nullable(),mode:z.enum(['DIRECT','FOLLOW_BOUNDARY','ORTHOGONAL','SHORTEST_INSIDE','ASK']),
  boundaryOffset:distance});
export const rectangleOrientationSchema = z.enum(['MODEL','SWAPPED','ASK']);
export type BoundaryPlacement = z.infer<typeof boundaryPlacementSchema>;
export interface LocalQuestion { questionId:string;prompt:string;kind:'single_choice'|'entity_choice';options:{value:string;label:string}[];context:string }
export type LocalAnswers = ReadonlyMap<string,string>;
export type CoordinateProvenance='USER_EXPLICIT'|'RESOLVER_DERIVED'|'LLM_INVENTED';
export interface CoordinateProof { provenance:Exclude<CoordinateProvenance,'LLM_INVENTED'>;actionIndex:number;constraint:string;coordinates:{x:number;y:number}[];dependencies:number[] }
export function constraintReferences(action:unknown):ConstraintReference[] {
  if(!action||typeof action!=='object')return [];
  const a=action as Record<string,unknown>, p=a.placement as Record<string,unknown>|undefined;
  return [p?.reference,p?.from,p?.to,a.source,a.target,a.boundary,...(Array.isArray(a.constraints)?a.constraints.flatMap(c=>c&&typeof c==='object'&&'reference'in c?[c.reference]:[]):[])].filter((r):r is ConstraintReference=>constraintReferenceSchema.safeParse(r).success);
}

/** Stable backward dependency graph; validation rejects incompatible producer types. */
export function dependencyIndices(action:unknown):number[] {
 const a=action as Record<string,unknown>,p=a.placement as Record<string,unknown>|undefined;
 const legacy=[a.boundaryActionIndex,p?.polygonActionIndex,...[a.reference,p?.reference].flatMap(r=>r&&typeof r==='object'&&'kind'in r&&r.kind==='prior_action_result'&&'actionIndex'in r?[r.actionIndex]:[])];
 return [...new Set([...constraintReferences(action).flatMap(r=>r.kind==='action'?[r.actionIndex]:[]),...legacy.filter((v):v is number=>typeof v==='number')])];
}

export const routeLabels:Record<'DIRECT'|'FOLLOW_BOUNDARY'|'ORTHOGONAL'|'SHORTEST_INSIDE'|'ASK',string>={DIRECT:'Напрямую',FOLLOW_BOUNDARY:'По границе',ORTHOGONAL:'Под прямым углом',SHORTEST_INSIDE:'Кратчайший внутри',ASK:'Выбор маршрута'};
