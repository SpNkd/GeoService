export const BUILTIN_CONCEPT_IDS = ['buildings','roads','slopes','utilities','annotations','dimensions','text','blocks','hatches','symbols','pipe','gas_pipe','water_pipe','cable','electricity','fence','equipment','valve','well'] as const;
export type BuiltinConceptId = typeof BUILTIN_CONCEPT_IDS[number];
export interface SemanticConcept { id: string; name: string; aliases: string[]; parentConceptId?: string; description?: string }
export const FEATURE_KEYS = ['kind','sourceLayer','layer','sourceType','importKind','blockDefinition','blockName','definitionSignature','attributeKeys','textToken','styleMode','color','lineType','width','fill','opacity','textSize','length','area','vertices','closed','aspect','size','imageCandidate','libraryId','symbolId','symbolProperty','connections','connectedKind'] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];
export interface FeatureCondition { key: FeatureKey; value: string }
export type MatchTier = 'EXACT' | 'STRONG' | 'WEAK';
export interface SemanticAnnotation { entityId: string; conceptId: string; polarity: 'positive' | 'negative'; source: 'user-explicit' | 'rule-confirmed' }
export interface SemanticRule { id: string; conceptId: string; scope: 'document'; version: 1; conditions: FeatureCondition[]; supporting: FeatureCondition[]; enabled: boolean; enabledTiers: MatchTier[]; positiveExamples: string[]; exclusions: string[] }
export interface SemanticKnowledge { version: 1; concepts: SemanticConcept[]; annotations: SemanticAnnotation[]; rules: SemanticRule[] }
export const emptyKnowledge = (): SemanticKnowledge => ({ version: 1, concepts: [], annotations: [], rules: [] });
export const featureIdentity = (f: FeatureCondition) => JSON.stringify([f.key,f.value]);
