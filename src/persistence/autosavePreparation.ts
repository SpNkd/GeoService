import type { GeoDocument } from '../domain/model';
import { serializeDocument } from './serialization';
export interface PreparedAutosave { document: GeoDocument; approximateSerializedBytes: number }
export type AutosavePreparation = (document: GeoDocument) => Promise<PreparedAutosave>;
/** Node/unit fallback and the small-browser compatibility path retain the same validation boundary. */
export const prepareAutosaveSynchronously: AutosavePreparation = async document => {
  const serialized=serializeDocument(document);
  return {document:JSON.parse(serialized) as GeoDocument,approximateSerializedBytes:new TextEncoder().encode(serialized).byteLength};
};
let worker: Worker | undefined, nextId=0;
const pending=new Map<number,{resolve:(result:PreparedAutosave)=>void;reject:(error:Error)=>void}>();
/** Validation, JSON encoding and canonicalization run off the editor thread. IndexedDB write ordering stays in the store. */
export const prepareAutosaveDocument: AutosavePreparation = document => {
  if(typeof Worker==='undefined')return prepareAutosaveSynchronously(document);
  if(!worker) {
    worker=new Worker(new URL('./autosave.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=(event:MessageEvent<{id:number;document?:GeoDocument;bytes?:number;error?:string}>)=>{
      const task=pending.get(event.data.id);if(!task)return;pending.delete(event.data.id);
      if(event.data.error)task.reject(new Error(event.data.error));
      else task.resolve({document:event.data.document!,approximateSerializedBytes:event.data.bytes!});
    };
    worker.onerror=()=>{for(const task of pending.values())task.reject(new Error('Не удалось подготовить автосохранение в Worker.'));pending.clear();worker?.terminate();worker=undefined;};
  }
  return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});try{worker!.postMessage({id,document});}catch(error){pending.delete(id);reject(error);}});
};
