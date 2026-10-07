import {describe,expect,it} from 'vitest';
import {defaultPreferences,migratePreferences,preferencesSchema} from '../preferences/store';
import {pdfVectors,type PdfMatrix} from '../pdf/operators';
const ops={save:1,restore:2,transform:3,constructPath:4,stroke:5,fill:6,paintImageXObject:7,clip:8};
const matrix:PdfMatrix=[1,0,0,-1,0,400];
describe('local PDF operator adapter',()=>{
 it('native line is direct, uses page y transform and never raster/OCR',()=>{const result=pdfVectors({fnArray:[4],argsArray:[[5,[new Float32Array([0,10,20,1,200,20])],[10,20,200,20]]]},ops,matrix);expect(result.imageCount).toBe(0);expect(result.candidates).toEqual([{id:'',type:'line',points:[{x:10,y:380},{x:200,y:380}]}]);});
 it('state transforms compose and restore between paths',()=>{const path=[5,[new Float32Array([0,0,0,1,100,0])],[0,0,100,0]],result=pdfVectors({fnArray:[1,3,4,2,4],argsArray:[[],[0,1,-1,0,20,30],path,[],path]},ops,matrix);expect(result.candidates[0]).toMatchObject({points:[{x:20,y:370},{x:20,y:270}]});expect(result.candidates[1]).toMatchObject({points:[{x:0,y:400},{x:100,y:400}]});});
 it('scans detected; mixed content does not generate raster duplicate paths',()=>{const result=pdfVectors({fnArray:[7,4],argsArray:[['image'],[5,[new Float32Array([0,0,0,1,10,0])],[0,0,10,0]]]},ops,matrix);expect(result.imageCount).toBe(1);expect(result.candidates).toHaveLength(1);});
 it('unsupported clipping yields explicit warning, not unclipped geometry',()=>{const result=pdfVectors({fnArray:[8,4],argsArray:[[],[5,[new Float32Array([0,0,0,1,10,0])],[0,0,10,0]]]},ops,matrix);expect(result.candidates).toEqual([]);expect(result.warnings).toHaveLength(1);});
});
describe('versioned preferences separate from drawing',()=>{
 it('migrates legacy grid step and rejects invalid/newer versions',()=>{expect(migratePreferences(null,'2.5').gridStep).toBe(2.5);expect(migratePreferences({version:9}).version).toBe(1);expect(migratePreferences(null,'NaN').gridStep).toBe(1);});
 it('normal preferences do not contain API key or document data',()=>{expect(preferencesSchema.safeParse({...defaultPreferences,apiKey:'test'}).success).toBe(false);expect(defaultPreferences.rememberApiKey).toBe(false);expect(defaultPreferences.rightTab).toBe('properties');});
});
