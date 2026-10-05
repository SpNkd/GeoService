import { importDxf } from './import';
import type { DxfOptions } from './types';
self.onmessage=(event:MessageEvent<{buffer:ArrayBuffer;filename:string;options:DxfOptions}>)=>{
  try { const plan=importDxf(event.data.buffer,event.data.filename,event.data.options,phase=>self.postMessage({phase}));self.postMessage({plan}); }
  catch(error){self.postMessage({error:error instanceof Error?error.message:'Не удалось открыть DXF'});}
};
