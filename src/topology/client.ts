import type { GeoDocument } from '../domain/model';
import { analysisRequest } from './scope';
import type { GraphDecisions, Scope, TopologyGraph } from './types';
export function reconstructTopology(document:GeoDocument,scope:Scope,decisions:GraphDecisions,signal:AbortSignal):Promise<TopologyGraph>{return new Promise((resolve,reject)=>{
 if(signal.aborted){reject(new DOMException('Отменено','AbortError'));return;}
 let worker:Worker;try{worker=new Worker(new URL('./analysis.worker.ts',import.meta.url),{type:'module'});}catch{reject(new Error('Локальный процесс анализа недоступен. Геометрия сохранена.'));return;}
 const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();},cancel=()=>{finish();reject(new DOMException('Отменено','AbortError'));},timer=setTimeout(()=>{finish();reject(new Error('Анализ занял более 30 секунд. Уменьшите область анализа.'));},30000);
 signal.addEventListener('abort',cancel,{once:true});worker.onerror=worker.onmessageerror=()=>{finish();reject(new Error('Локальный процесс анализа завершился с ошибкой. Геометрия сохранена.'));};
 worker.onmessage=({data}:MessageEvent<{graph?:TopologyGraph;error?:string}>)=>{finish();if(data.graph)resolve(data.graph);else reject(new Error(data.error??'Анализ не завершён.'));};
 try{worker.postMessage(analysisRequest(document,scope,decisions));}catch{finish();reject(new Error('Не удалось подготовить геометрию для локального анализа.'));}
 });}
