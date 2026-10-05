import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, it } from 'vitest';
import { importDxf } from '../src/dxf/import';
import { createProvenanceIndex } from '../src/dxf/provenance';
import { serializeDocument, deserializeDocument } from '../src/persistence/serialization';
import { visibleBounds } from '../src/renderer/selectors';
import { fitToBounds } from '../src/geometry';
const path=process.env.DXF_REFERENCE;
it.skipIf(!path)('reference DXF conversion, persistence, index and Fit benchmark (local file only)',()=>{
  global.gc?.();const before=process.memoryUsage(),readStart=performance.now(),b=readFileSync(path!),readMs=performance.now()-readStart,start=performance.now();
  const plan=importDxf(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),basename(path!)),importMs=performance.now()-start;
  const fitStart=performance.now(),fit=fitToBounds(visibleBounds(plan.document),{width:1000,height:700},85),fitMs=performance.now()-fitStart;
  const index=createProvenanceIndex(plan.document),counts=Object.fromEntries(['_ГП_ЗИС','ГП_здания и сооружения'].map(n=>[n,index.getEntitiesBySourceLayer(n).length]));
  const saveStart=performance.now(),json=serializeDocument(plan.document),saveMs=performance.now()-saveStart,openStart=performance.now(),opened=deserializeDocument(json),openMs=performance.now()-openStart;
  expect(opened).toEqual(plan.document);expect(plan.report.modelSpaceCount).toBe(458);expect(plan.document.entities).toHaveLength(458);expect(plan.document.layers).toHaveLength(127);expect(plan.document.blocks).toHaveLength(450);expect(index.getBlockInstancesBySourceName('VOLUME')).toHaveLength(62);expect(fit).not.toBeNull();
  global.gc?.();const after=process.memoryUsage();const results={filename:basename(path!),readMs,importMs,timings:plan.report.timings,fitMs,saveMs,openMs,jsonBytes:Buffer.byteLength(json),heapDeltaMiB:(after.heapUsed-before.heapUsed)/1024**2,rssMiB:after.rss/1024**2,storedPrimitives:plan.report.normalizedPrimitives,blockAttributeReport:plan.report.blockTypes.ATTRIB,entities:plan.document.entities.length,blocks:plan.document.blocks?.length,indexCounts:counts,blockCounts:{'_ЗИС_13':index.getBlockInstancesBySourceName('_ЗИС_13').length,VOLUME:index.getBlockInstancesBySourceName('VOLUME').length}};writeFileSync('docs/audit-results/dxf-reference.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
});
