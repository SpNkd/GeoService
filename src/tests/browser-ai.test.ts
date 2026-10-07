import { afterEach, expect, it } from 'vitest';
import { BrowserAiIntentProvider } from '../ai/provider';
import { setAiSettings } from '../ai/settings';
const key='visitor-key-for-isolated-tests';
const settings={enabled:true,provider:'openrouter' as const,apiKey:key,primaryModel:'qwen/qwen3.5-27b',fallbackModel:''};
afterEach(()=>setAiSettings(null));
it('static browser sends only public contract and user text directly to OpenRouter with the visitor key',async()=>{
 setAiSettings(settings);const calls:{url:string;init:RequestInit}[]=[];
 const result=await new BrowserAiIntentProvider(async(url,init)=>{calls.push({url:String(url),init:init!});return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({intent:{actions:[{type:'create_boundary_from_named_points',pointNames:['P1','P2','P3']}]},unsupported:false})}}]}));}).parseIntent({text:'Создай границу P1 P2 P3',signal:new AbortController().signal});
 expect(result).toMatchObject({actions:[{type:'create_boundary_from_named_points'}]});expect(calls).toHaveLength(1);expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
 expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe(`Bearer ${key}`);
 expect([...new Headers(calls[0]!.init.headers).keys()].sort()).toEqual(['authorization','content-type']);
 const body=JSON.parse(String(calls[0]!.init.body));expect(body.messages[1].content).toBe('Создай границу P1 P2 P3');expect(body.response_format.type).toBe('json_schema');expect(body.provider.data_collection).toBe('deny');expect(Object.keys(body).sort()).toEqual(['max_tokens','messages','model','provider','reasoning','response_format','temperature']);expect(String(calls[0]!.init.body)).not.toContain(key);
});
it('missing key or unsupported static provider never calls a local API or external endpoint',async()=>{
 let calls=0;const provider=new BrowserAiIntentProvider(async()=>{calls++;throw Error('should not be called');}),request={text:'Тест',signal:new AbortController().signal};
 setAiSettings({...settings,apiKey:''});await expect(provider.parseIntent(request)).rejects.toThrow('Настройках');setAiSettings({...settings,provider:'mock'});await expect(provider.parseIntent(request)).rejects.toThrow('выберите OpenRouter');expect(calls).toBe(0);
});
it('browser errors redact echoed visitor credentials before diagnostics or messages',async()=>{
 setAiSettings(settings);let diagnostics='';const provider=new BrowserAiIntentProvider(async()=>new Response(JSON.stringify({error:`Bearer ${key}`}),{status:401}));
 await expect(provider.parseIntent({text:'Тест',signal:new AbortController().signal,onDiagnostic:d=>{diagnostics=JSON.stringify(d);}})).rejects.toMatchObject({code:'AUTH_ERROR'});expect(diagnostics).not.toContain(key);expect(diagnostics).toContain('[REDACTED]');
});
