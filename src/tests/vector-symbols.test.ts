import { expect, it } from 'vitest';
import { requireSymbol } from '../symbols/registry';
import { rankSymbolMatches, renderSymbolSignature } from '../image/symbolRecognition';
import { detectVectorSymbols } from '../image/vectorSymbols';
import type { Candidate } from '../image/types';
it('native vector fixture has explicit known matching or reviewable ambiguity',()=>{
 const definition=requireSymbol('gas-process-demo','filter');
 const candidates:Candidate[]=definition.geometry.map((p,i)=>p.type==='circle'?{id:`c${i}`,type:'circle',center:{x:p.center.x*80+100,y:-p.center.y*80+100},radius:p.radius*80}:p.type==='rect'?{id:`c${i}`,type:'contour',points:[{x:p.position.x,y:p.position.y},{x:p.position.x+p.width,y:p.position.y},{x:p.position.x+p.width,y:p.position.y+p.height},{x:p.position.x,y:p.position.y+p.height}].map(p=>({x:p.x*80+100,y:-p.y*80+100}))}:{id:`c${i}`,type:p.type==='polygon'?'contour':p.type==='line'?'line':'polyline',points:(p.type==='line'?[p.start,p.end]:p.points).map(p=>({x:p.x*80+100,y:-p.y*80+100}))});
 const ranked=rankSymbolMatches(renderSymbolSignature(definition));expect(ranked[0]!.score).toBe(ranked[1]!.score);expect(detectVectorSymbols(candidates)[0]!.proposedSymbol).toBeUndefined();
 expect(detectVectorSymbols(candidates)).toHaveLength(1);
});
