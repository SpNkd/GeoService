import { getLibrary, registerSymbolLibrary } from '../symbols/registry';
import { analyzeTopology } from './analyze';
import type { AnalysisRequest } from './types';
self.onmessage=({data}:MessageEvent<AnalysisRequest>)=>{try{for(const library of data.libraries??[])if(!getLibrary(library.id))registerSymbolLibrary(library);self.postMessage({graph:analyzeTopology(data.document,data.scope,data.decisions)});}catch(error){self.postMessage({error:error instanceof Error?error.message:'Не удалось восстановить связи. Сузьте область анализа.'});}};
