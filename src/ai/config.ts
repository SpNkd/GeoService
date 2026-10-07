/** Shared public defaults and routing policy. Environment values are supplied only by the local server. */
export const DEFAULT_PRIMARY_MODEL = 'qwen/qwen3.5-27b';
export const DEFAULT_FALLBACK_MODELS = ['qwen/qwen3-30b-a3b-instruct-2507'];
export const OPENROUTER_ROUTING = { allow_fallbacks: true, require_parameters: true, data_collection: 'deny' } as const;
export interface AiServerConfig { AI_PROVIDER?: string; OPENAI_API_KEY?: string; OPENROUTER_API_KEY?: string; AI_MODEL?: string; AI_PRIMARY_MODEL?: string; AI_FALLBACK_MODELS?: string; AI_IGNORED_PROVIDERS?: string }
export function modelConfig(config: AiServerConfig) {
  return { primaryModel: config.AI_PRIMARY_MODEL?.trim() || config.AI_MODEL?.trim() || DEFAULT_PRIMARY_MODEL,
    fallbackModels: config.AI_FALLBACK_MODELS === undefined ? [...DEFAULT_FALLBACK_MODELS] : [...new Set(config.AI_FALLBACK_MODELS.split(',').map(value => value.trim()).filter(Boolean))] };
}

// Known reasoning-switch capability, centralized with model IDs. Instruct endpoints do not support it.
export const hasReasoningSwitch = (model: string) => model === DEFAULT_PRIMARY_MODEL;
export function routingConfig(config: AiServerConfig) {
  const ignore = config.AI_IGNORED_PROVIDERS?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  return { ...OPENROUTER_ROUTING, ...(ignore.length ? { ignore } : {}) };
}
