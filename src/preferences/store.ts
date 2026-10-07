import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { setAiSettings, setAiRuntime } from '../ai/settings';
export const PREFERENCES_KEY='geoservice.preferences.v1',DEVICE_KEY='geoservice.ai-device-key.v1';
const model=z.string().min(1).max(200).regex(/^[\w./:@+-]+$/);
export const preferencesSchema=z.strictObject({version:z.literal(1),gridVisible:z.boolean(),snapEnabled:z.boolean(),snapGrid:z.boolean(),gridStep:z.number().finite().positive().max(1e6),ortho:z.boolean(),rightTab:z.enum(['properties','search','ai']),diagnostics:z.boolean(),renderer:z.enum(['canvas','svg']).default('canvas'),aiCustomized:z.boolean(),rememberApiKey:z.boolean(),ai:z.strictObject({enabled:z.boolean(),provider:z.enum(['openrouter','openai','mock']),primaryModel:model,fallbackModel:model.or(z.literal('')),timeoutMs:z.number().int().min(1000).max(120000),retryCount:z.number().int().min(0).max(1)})});
export type Preferences=z.infer<typeof preferencesSchema>;
export const defaultPreferences:Preferences={version:1,gridVisible:true,snapEnabled:true,snapGrid:false,gridStep:1,ortho:false,rightTab:'properties',diagnostics:false,renderer:'canvas',aiCustomized:false,rememberApiKey:false,ai:{enabled:true,provider:'openrouter',primaryModel:'qwen/qwen3.5-27b',fallbackModel:'qwen/qwen3-30b-a3b-instruct-2507',timeoutMs:45000,retryCount:0}};
export function migratePreferences(raw:unknown,legacyStep?:string|null):Preferences {
 const parsed=preferencesSchema.safeParse(raw);if(parsed.success)return parsed.data;
 // Known legacy is the isolated snap-step key; unknown/newer versions are never guessed.
 const step=Number(legacyStep);return {...defaultPreferences,ai:{...defaultPreferences.ai},...(step>0&&Number.isFinite(step)&&step<=1e6?{gridStep:step}:{})};
}
let current:Preferences|undefined,sessionKey='',storageError='';const listeners=new Set<()=>void>();
export function getPreferences():Preferences {
 if(!current){try{current=migratePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY)??'null'),localStorage.getItem('geoservice.snap-step'));if(current.rememberApiKey){const saved=z.strictObject({version:z.literal(1),apiKey:z.string().max(512).regex(/^[\x21-\x7e]*$/)}).safeParse(JSON.parse(localStorage.getItem(DEVICE_KEY)??'null'));if(saved.success)sessionKey=saved.data.apiKey;}}catch{current=migratePreferences(null);}
 syncAi();}return current;
}
function syncAi(){if(!current)return;const {enabled,provider,primaryModel,fallbackModel}=current.ai;if(current.aiCustomized)setAiSettings({enabled,provider,primaryModel,fallbackModel,apiKey:sessionKey});setAiRuntime(current.ai.timeoutMs,current.ai.retryCount);}
export function updatePreferences(patch:Partial<Preferences>){const before=getPreferences(),next=preferencesSchema.parse({...before,...patch,ai:patch.ai??before.ai});current=next;syncAi();try{localStorage.setItem(PREFERENCES_KEY,JSON.stringify(next));storageError='';}catch{storageError='Настройки не сохранены: хранилище браузера недоступно.';}listeners.forEach(l=>l());}
export const getPreferenceStorageError=()=>storageError;
export const getApiKey=()=>{getPreferences();return sessionKey;};
export function setApiKey(key:string,remember=getPreferences().rememberApiKey){sessionKey=z.string().max(512).regex(/^[\x21-\x7e]*$/).parse(key);updatePreferences({rememberApiKey:remember,aiCustomized:true});try{if(remember&&key)localStorage.setItem(DEVICE_KEY,JSON.stringify({version:1,apiKey:key}));else localStorage.removeItem(DEVICE_KEY);}catch{storageError='Ключ не сохранён: хранилище браузера недоступно.';}listeners.forEach(l=>l());}
export function usePreferences(){return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l);},getPreferences,getPreferences);}
/** Safe public server defaults: no credential values. Does not overwrite user choices or persist them. */
export function adoptServerAiDefaults(data:{provider?:string;primaryModel?:string;fallbackModel?:string}){
 const before=getPreferences();if(before.aiCustomized)return;const parsed=preferencesSchema.safeParse({...before,ai:{...before.ai,...(data.provider&&['mock','openrouter','openai'].includes(data.provider)?{provider:data.provider}:{}),...(data.primaryModel?{primaryModel:data.primaryModel}:{}),...(data.fallbackModel!==undefined?{fallbackModel:data.fallbackModel}:{})}});if(parsed.success){current=parsed.data;listeners.forEach(l=>l());}
}
