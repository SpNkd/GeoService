import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importDxf } from '../dxf/import';
import { applyCommand } from '../domain/commands';
import { validateDocument } from '../persistence/documentSchema';
import { validateVectorDocument } from '../vectors/geometry';
import { BlockDefinitions, VectorView } from '../renderer/VectorView';
import { entityPoints } from '../domain/model';
import type { BlockDefinition } from '../vectors/types';
const load=(name:string)=>{const b=readFileSync(new URL(`./fixtures/dxf/${name}.dxf`,import.meta.url));return importDxf(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),name+'.dxf').document;};
const entityFile=(entities:string,blocks='')=>new TextEncoder().encode(`0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`).buffer;
describe('DXF loss reporting and safe shared vector graph',()=>{
  it('maps old 3D POLYLINE without losing Z',()=>{
    const p=importDxf(entityFile('0\nPOLYLINE\n8\n0\n70\n8\n0\nVERTEX\n10\n100\n20\n200\n30\n3\n70\n32\n0\nVERTEX\n10\n105\n20\n206\n30\n4\n70\n32\n0\nSEQEND\n'),'3d.dxf');
    expect(p.document.entities[0]?.type).toBe('polyline');expect(entityPoints(p.document.entities[0]!,p.document.vertices)).toEqual([{x:100,y:200,z:3},{x:105,y:206,z:4}]);
  });
  it('open LW path stays a path; bulge is explicitly simplified, never a straight chord',()=>{
    const p=importDxf(entityFile('0\nLWPOLYLINE\n8\n0\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n'),'bulge.dxf');expect(p.document.entities[0]?.type).toBe('polyline');expect(entityPoints(p.document.entities[0]!,p.document.vertices).length).toBeGreaterThan(10);expect(p.report.types.LWPOLYLINE?.simplified).toBe(1);expect(p.report.warnings.join(' ')).toContain('0.01');
  });
  it('layers used inside definitions cannot be deleted even without top-level objects',()=>{const d=load('blocks_nested');expect(d.entities.every(e=>e.layerId!==d.layers[0]!.id)).toBe(true);expect(()=>applyCommand(d,{type:'delete-layer',layerId:d.layers[0]!.id})).toThrow(/blocks/);});
  it('SVG definitions are shared references with inherited layer 0/BYBLOCK paint',()=>{const d=load('blocks_nested'),html=renderToStaticMarkup(createElement(BlockDefinitions,{document:d}));expect((html.match(/id="geo-block-/g)??[])).toHaveLength(2);expect(html).toContain('stroke="currentColor"');expect(html).toContain('<use');const view=renderToStaticMarkup(createElement(VectorView,{entity:d.entities[0]!,document:d,viewport:d.viewport,size:{width:1000,height:700},color:'#ff0000',selected:false}));expect(view).toContain('<use');expect(view).toContain('color="#ff0000"');expect(view).not.toContain('<circle');});
  it('sanitizes cyclic DXF references before exposing the document, with a warning',()=>{const block='0\nBLOCK\n2\nLOOP\n10\n0\n20\n0\n0\nINSERT\n8\n0\n2\nLOOP\n10\n0\n20\n0\n0\nENDBLK\n';const p=importDxf(entityFile('0\nINSERT\n8\n0\n2\nLOOP\n10\n0\n20\n0\n',block),'cycle.dxf');expect(p.document.blocks?.[0]?.primitives).toHaveLength(0);expect(p.report.warnings.join(' ')).toContain('Циклическая');expect(()=>validateDocument(p.document)).not.toThrow();});
  it('rejects cached DAG paths deeper than depth budget, irrespective of definition order',()=>{const d=load('blocks_nested'),layerId=d.layers[0]!.id,blocks:BlockDefinition[]=Array.from({length:17},(_,i)=>({id:`b${i}`,sourceName:`b${i}`,basePoint:{x:0,y:0},primitives:i?[{kind:'block',layerId,colorMode:'byblock',blockDefinitionId:`b${i-1}`,position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1}]:[]}));expect(()=>validateVectorDocument({...d,entities:[],blocks})).toThrow(/depth/);});
  it('rejects exponential render expansion while retaining repeated instance definitions',()=>{const d=load('blocks_nested'),layerId=d.layers[0]!.id,blocks:BlockDefinition[]=Array.from({length:16},(_,i)=>({id:`b${i}`,sourceName:`b${i}`,basePoint:{x:0,y:0},primitives:i?Array.from({length:10},()=>({kind:'block' as const,layerId,colorMode:'byblock' as const,blockDefinitionId:`b${i-1}`,position:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1})):[{kind:'circle',layerId,colorMode:'byblock',center:{x:0,y:0},radius:1}]}));expect(()=>validateVectorDocument({...d,entities:[],blocks})).toThrow(/render budget/);});
  it('detects XREF and IMAGE, never imports an external URL/path into canonical geometry',()=>{const p=importDxf(entityFile('0\nINSERT\n8\n0\n2\nEXTERNAL\n10\n0\n20\n0\n0\nIMAGE\n5\nIMG\n8\n0\n1\nhttps://example.com/private.png\n','0\nBLOCK\n2\nEXTERNAL\n70\n4\n1\n/private/secret.dwg\n10\n0\n20\n0\n0\nENDBLK\n'),'external.dxf');expect(p.report.types.INSERT?.unsupported).toBe(1);expect(p.report.types.IMAGE?.unsupported).toBe(1);expect(p.report.warnings.join(' ')).toContain('XREF');expect(JSON.stringify(p.document)).not.toContain('/private/');expect(JSON.stringify(p.document)).not.toContain('https://');});
  it('sanitizes filename and rejects prototype-sensitive parser table names',()=>{const p=importDxf(entityFile('0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n1\n'),'/private/local/test.dxf');expect(p.document.sources?.[0]?.filename).toBe('test.dxf');expect(p.document.metadata.title).toBe('test.dxf');expect(()=>importDxf(entityFile('', '0\nBLOCK\n2\n__proto__\n10\n0\n20\n0\n0\nENDBLK\n'),'unsafe.dxf')).toThrow(/unsafe/);});
  it('solid HATCH has a real fill, pattern HATCH is visibly simplified',()=>{const d=load('mixed_proxy'),p=d.entities[0]!;if(p.type!=='imported_graphic')throw Error();expect(p.primitives[0]).toMatchObject({kind:'path',fill:true,fillOpacity:1});const html=renderToStaticMarkup(createElement(VectorView,{entity:p,document:d,viewport:d.viewport,size:{width:1000,height:700},color:'#ff0000',selected:false}));expect(html).toContain('fill-rule="evenodd"');expect(html).toContain('opacity="1"');});
});
