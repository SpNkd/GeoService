import { serializeDocument } from './serialization';
import type { GeoDocument } from '../domain/model';
self.onmessage=(event:MessageEvent<{id:number;document:GeoDocument}>)=>{
  try {const serialized=serializeDocument(event.data.document);self.postMessage({id:event.data.id,document:JSON.parse(serialized),bytes:new TextEncoder().encode(serialized).byteLength});}catch(error){self.postMessage({id:event.data.id,error:error instanceof Error?error.message:'Документ не прошёл проверку.'});}
};
