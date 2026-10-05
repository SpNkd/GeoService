import { describe, expect, it } from 'vitest';
import { moveDocument } from './fixtures/moveDocument';
import { symbolDocument } from './fixtures/symbolDocument';
import { absoluteMoveCommand, selectionModelAnchor, type MoveAnchor } from '../domain/exactMove';
import { applyCommand } from '../domain/commands';
import { layerBounds, modelSelectionBounds } from '../geometry/entityBounds';
import { editorReducer, initialEditorState, isDocumentDirty } from '../store/editor';
import { documentSurveyXY } from '../geometry/georeferencing';
import { fitToBounds, worldToScreen } from '../geometry';
const anchors:MoveAnchor[]=['center','bottom-left','bottom-right','top-left','top-right'];
describe('exact MODEL move through the shared command boundary',()=>{
  it.each(anchors)('Point and Text use canonical position for %s',anchor=>{
    const d=moveDocument();for(const [id,vertexId] of [['point','e'],['text','t']] as const){
      expect(selectionModelAnchor(d,[id],anchor)).toEqual({x:d.vertices[vertexId]!.x,y:d.vertices[vertexId]!.y});
      const after=applyCommand(d,absoluteMoveCommand(d,[id],{x:50.125,y:25.375},anchor));
      expect(after.vertices[vertexId]).toMatchObject({x:50.125,y:25.375});
    }
  });
  it.each(anchors)('Polygon anchor %s arrives at exact position, preserving shared IDs and Z',anchor=>{
    const d=moveDocument(),command=absoluteMoveCommand(d,['house'],{x:50.125,y:25.375},anchor);
    const current=selectionModelAnchor(d,['house'],anchor);
    expect(command).toMatchObject({type:'move-entities',delta:{x:50.125-current.x,y:25.375-current.y}});
    const after=applyCommand(d,command);expect(selectionModelAnchor(after,['house'],anchor)).toEqual({x:50.125,y:25.375});expect(after.vertices.a!.z).toBe(2);
    expect(after.entities).toBe(d.entities);expect(Object.keys(after.vertices)).toEqual(Object.keys(d.vertices));
  });
  it.each(anchors)('Group anchor %s from MODEL bounds, shared vertex moves once',anchor=>{
    const d=moveDocument(),ids=['house','line','point'],p=selectionModelAnchor(d,ids,anchor),requested={x:100,y:200};
    const after=applyCommand(d,absoluteMoveCommand(d,ids,requested,anchor));
    expect(selectionModelAnchor(after,ids,anchor)).toEqual(requested);
    expect(after.vertices.a!.x).toBe(d.vertices.a!.x+100-p.x);expect(after.vertices.e!.y).toBe(d.vertices.e!.y+200-p.y);
  });
  it('relative Δ remains unchanged, full precision and single Undo/Redo/no-op',()=>{
    const d=moveDocument();let state=initialEditorState(d);
    const noOp=absoluteMoveCommand(d,['house'],selectionModelAnchor(d,['house']));
    state=editorReducer(state,{type:'execute',command:noOp});expect(state.document).toBe(d);expect(state.past).toHaveLength(0);expect(isDocumentDirty(state)).toBe(false);
    const target={x:50.123456789,y:25.987654321};state=editorReducer(state,{type:'execute',command:absoluteMoveCommand(d,['house'],target)});
    expect(state.past).toEqual([d]);expect(selectionModelAnchor(state.document,['house']).x).toBeCloseTo(target.x,12);
    const after=state.document;state=editorReducer(state,{type:'undo'});expect(state.document).toBe(d);expect(editorReducer(state,{type:'redo'}).document).toBe(after);
    expect(applyCommand(d,{type:'move-entities',entityIds:['house'],delta:{x:5,y:-2}}).vertices.a).toEqual({id:'a',x:5,y:-2,z:2});
  });
  it.each(['buildings','boundary','dimensions','annotations'])('Absolute has identical topology locks for %s',layer=>{
    const d=moveDocument();d.layers.find(l=>l.id===layer)!.locked=true;expect(()=>absoluteMoveCommand(d,['house'],{x:50,y:25})).toThrow(/заблокирован/);
  });
  it('MODEL-only Absolute in Survey UI derives new E/N without recalibration',()=>{
    const d=applyCommand(moveDocument(),{type:'set-horizontal-reference',pairs:[{pointEntityId:'control-a',survey:{e:1000,n:2000}},{pointEntityId:'control-b',survey:{e:1000,n:2020}}]});
    let s=editorReducer(initialEditorState(d),{type:'coordinate-display',mode:'survey'});
    s=editorReducer(s,{type:'execute',command:absoluteMoveCommand(d,['point'],{x:50,y:25})});expect(s.document.vertices.e).toMatchObject({x:50,y:25});
    expect(s.document.horizontalReference).toBe(d.horizontalReference);const survey=documentSurveyXY(s.document,s.document.vertices.e!)!;expect(survey.e).toBeCloseTo(985);expect(survey.n).toBeCloseTo(2058);
  });
  it('Label/Dimension group anchors use derived selectable geometry',()=>{
    const d=moveDocument(),ids=['house','label','dim-0'];expect(modelSelectionBounds(d,ids)!.minY).toBeLessThan(0);
    const target={x:20,y:30},after=applyCommand(d,absoluteMoveCommand(d,ids,target));expect(selectionModelAnchor(after,ids)).toEqual(target);
  });
});
describe('fit layer is camera-only',()=>{
  const size={width:900,height:600};
  it.each([{visible:true,locked:false},{visible:false,locked:false},{visible:true,locked:true},{visible:false,locked:true}])('fits full target content including symbols under %j',policy=>{
    const d=symbolDocument();Object.assign(d.layers.find(l=>l.id==='buildings')!,policy);
    let s=initialEditorState(d);s=editorReducer(s,{type:'fit-layer',layerId:'buildings',size});
    const b=layerBounds(d,'buildings')!;expect(b).toEqual({minX:0,minY:0,maxX:21,maxY:9.22});expect(s.viewport).toEqual(fitToBounds(b,size,85));
    expect(s.document).toBe(d);expect(s.past).toHaveLength(0);expect(s.future).toHaveLength(0);expect(isDocumentDirty(s)).toBe(false);
    expect(s.savedFingerprint).toBe(initialEditorState(d).savedFingerprint);expect(d.layers.find(l=>l.id==='buildings')).toMatchObject(policy);
    for(const point of [{x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}]){const p=worldToScreen(point,s.viewport,size);expect(p.x).toBeGreaterThanOrEqual(85);expect(p.x).toBeLessThanOrEqual(815);expect(p.y).toBeGreaterThanOrEqual(85);expect(p.y).toBeLessThanOrEqual(515);}
  });
  it('empty layer safe, unknown safe, other layers irrelevant',()=>{
    const d=moveDocument();d.layers.push({id:'empty',name:'Empty',visible:false,locked:true,order:10,styleId:d.styles[0]!.id});const s=initialEditorState(d);
    expect(editorReducer(s,{type:'fit-layer',layerId:'empty',size})).toBe(s);expect(editorReducer(s,{type:'fit-layer',layerId:'missing',size})).toBe(s);
    const b=layerBounds(d,'buildings');d.vertices.e!.x=1e6;expect(layerBounds(d,'buildings')).toEqual(b);
  });
  it('Text, Label, Dimension, Point, Polyline/Line extents are finite MODEL bounds',()=>{
    const d=moveDocument();for(const id of ['annotations','dimensions','boundary','survey-points']){const b=layerBounds(d,id)!;expect(b).not.toBeNull();expect(Object.values(b).every(Number.isFinite)).toBe(true);}
    expect(layerBounds(d,'annotations')!.maxX).toBeGreaterThan(d.vertices.t!.x);
    expect(layerBounds(d,'dimensions')!.minY).toBeLessThan(0);
  });
});
it('Fit preserves an already dirty document and its existing Undo/Redo stacks',()=>{
  let s=initialEditorState(symbolDocument());s=editorReducer(s,{type:'execute',command:{type:'update-entity',entityId:'valve',patch:{name:'К-1'}}});const before=s;
  s=editorReducer(s,{type:'fit-layer',layerId:'buildings',size:{width:900,height:600}});expect(isDocumentDirty(s)).toBe(true);expect(s.document).toBe(before.document);expect(s.past).toBe(before.past);expect(s.future).toBe(before.future);expect(s.savedFingerprint).toBe(before.savedFingerprint);
});
