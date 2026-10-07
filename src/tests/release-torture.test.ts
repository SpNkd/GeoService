import { expect,it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { releaseTorture } from './fixtures/releaseTorture';
import { editorReducer } from '../store/editor';
import { serializeDocument,deserializeDocument } from '../persistence/serialization';
import { createAutosaveStore } from '../persistence/autosave';
import { validateConnectivity,connectivityIndex } from '../connectors/model';
import { resolveDocumentQuery, searchDocument } from '../documentOperations/query';
import { createProvenanceIndex } from '../dxf/provenance';

it('composite document survives every Undo/Redo revision, indexes and serialization',()=>{
 const {state:final,snapshots,steps}=releaseTorture();let state=final;
 expect(steps).toHaveLength(11);expect(final.document.entities.some(e=>e.type==='connector'&&e.topologySource)).toBe(true);
 for(let i=steps.length;i>=0;i--){
  expect(state.document).toEqual(snapshots[i]);expect(deserializeDocument(serializeDocument(state.document))).toEqual(snapshots[i]);
  validateConnectivity(state.document);
  const connectors=state.document.entities.filter(e=>e.type==='connector');
  expect([...connectivityIndex(state.document).byConnector.keys()].sort()).toEqual(connectors.map(e=>e.id).sort());
  expect(searchDocument(state.document,'RC ATTRIBUTE').entityIds).toEqual(i>=6?['mark-a']:[]);
  expect(createProvenanceIndex(state.document).searchBlockAttributes('RC ATTRIBUTE').map(hit=>hit.ownerEntityId)).toEqual(i>=6?['mark-a']:[]);
  const reopened=deserializeDocument(serializeDocument(state.document)),query={kind:'semantic_concept' as const,concepts:['pipe' as const]};
  const current=resolveDocumentQuery(query,state.document),fresh=resolveDocumentQuery(query,reopened);
  // A reopened immutable document has a new local revision identity; matches/evidence must agree.
  expect({...current,documentRevision:0}).toEqual({...fresh,documentRevision:0});
  expect(state.selectedEntityIds.every(id=>state.document.entities.some(e=>e.id===id))).toBe(true);
  if(i)state=editorReducer(state,{type:'undo'});
 }
 for(let i=1;i<=steps.length;i++){state=editorReducer(state,{type:'redo'});expect(state.document).toEqual(snapshots[i]);validateConnectivity(state.document);}
 expect(state.past).toHaveLength(steps.length);expect(state.future).toHaveLength(0);
});
it('composite autosave, restore, Save/Open preserves geometry, provenance, semantics and connectors',async()=>{
 const {document}=releaseTorture(),api=createAutosaveStore({indexedDB:new IDBFactory()});
 await api.saveAutosave(document,true);expect((await api.loadAutosave())?.document).toEqual(document);
 expect(deserializeDocument(serializeDocument(document))).toEqual(document);
 expect(JSON.stringify(document)).not.toContain('apiKey');
});
