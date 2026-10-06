import { z } from 'zod';

export const DOCUMENT_QUERY_LIMITS = Object.freeze({ results: 10000, groups: 2000, evidencePerOwner: 20, searchRows: 100 });
export const semanticConceptSchema = z.enum(['buildings','roads','slopes','utilities','annotations','dimensions','text','blocks','hatches','symbols']);
export type SemanticConcept = z.infer<typeof semanticConceptSchema>;
const name = z.string().trim().min(1).max(128);
export const documentQuerySchema = z.discriminatedUnion('kind', [
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('all_entities')}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('entity_name'),name}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('geoservice_layer'),name}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('source_layer'),name}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('source_type'),sourceType:name}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('block_name'),name}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('text_contains'),text:name,sourceType:name.nullable()}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('block_attribute'),tag:name.nullable(),value:name.nullable()}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('entity_type'),entityType:z.enum(['point','line','polyline','polygon','text','label','dimension','symbol','block_instance','imported_graphic','arc','circle'])}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('semantic_concept'),concepts:z.array(semanticConceptSchema).min(1).max(10)}),
  z.strictObject({scope:z.enum(['current_view','current_layout','active_viewport','document']).optional(),kind:z.literal('current_selection')}),
]);
export type DocumentQuery = z.infer<typeof documentQuerySchema>;
export const documentActionSchema = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('find_entities'),query:documentQuerySchema}),
  z.strictObject({type:z.literal('select_entities'),query:documentQuerySchema}),
  z.strictObject({type:z.literal('fit_result'),query:documentQuerySchema}),
  z.strictObject({type:z.literal('isolate_result'),query:documentQuerySchema}),
  z.strictObject({type:z.literal('create_layer'),name}),
  z.strictObject({type:z.literal('move_entities_to_layer'),query:documentQuerySchema,target:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('existing_layer'),name}),
    z.strictObject({kind:z.literal('created_layer'),actionIndex:z.number().int().min(0).max(7)}),
  ])}),
  z.strictObject({type:z.literal('set_layer_visibility'),query:documentQuerySchema,visible:z.boolean()}),
]);
export type DocumentAction = z.infer<typeof documentActionSchema>;
export function isDocumentAction(action: {type:string}): action is DocumentAction { return documentActionSchema.options.some(option=>option.shape.type.value===action.type); }
