import { z } from 'zod';
/** Runtime override only; explicit device persistence is owned by PreferencesStore, never GeoDocument. */
export const aiSettingsSchema = z.strictObject({ enabled: z.boolean(), provider: z.enum(['openrouter', 'openai', 'mock']), apiKey: z.string().max(512).regex(/^[\x21-\x7e]*$/), primaryModel: z.string().min(1).max(200).regex(/^[\w./:@+-]+$/), fallbackModel: z.string().max(200).regex(/^[\w./:@+-]*$/) });
export type AiSettings = z.infer<typeof aiSettingsSchema>;
let session: AiSettings | null = null;
let runtime={timeoutMs:45000,retryCount:0};
export function setAiRuntime(timeoutMs:number,retryCount:number){runtime={timeoutMs,retryCount};}
export function aiRuntime(){return runtime;}
export function setAiSettings(settings: AiSettings | null) { session = settings ? aiSettingsSchema.parse(settings) : null; }
export function aiSettingsHeaders(): Record<string, string> {
  if (!session) return {};
  if (!session.enabled) throw new Error('AI отключён');
  return { 'X-AI-Provider': session.provider, 'X-AI-Primary-Model': session.primaryModel, 'X-AI-Fallback-Model': session.fallbackModel, ...(session.apiKey ? { 'X-AI-API-Key': session.apiKey } : {}) };
}
