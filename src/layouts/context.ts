import {navigationViewport,type ViewportNavigation} from './camera';
import { resolveSelectionScope } from './selection';
import type { GeoDocument } from '../domain/model';
import type { EditorState } from '../store/editor';
const freezes=new WeakMap<GeoDocument,ReadonlySet<string>>();
export const frozenPresentationLayers=(document:GeoDocument)=>freezes.get(document);
const views=new WeakMap<GeoDocument,WeakMap<object,GeoDocument>>();
export function viewportDocument(document:GeoDocument,viewport:NonNullable<GeoDocument['dxfLayouts']>[number]['viewports'][number]):GeoDocument{let cache=views.get(document);if(!cache){cache=new WeakMap();views.set(document,cache);}const hit=cache.get(viewport.frozenSourceLayerNames);if(hit)return hit;const names=new Set(viewport.frozenSourceLayerNames),frozen=new Set(document.layers.filter(l=>names.has(l.source?.originalLayer??l.name)).map(l=>l.id));const result={...document,layers:document.layers.map(l=>frozen.has(l.id)&&l.visible?{...l,visible:false}:l)};freezes.set(result,frozen);cache.set(viewport.frozenSourceLayerNames,result);return result;}
export function activeLayout(state:Pick<EditorState,'document'|'layoutId'>){return state.document.dxfLayouts?.find(l=>l.id===state.layoutId);}
export function activeDxfViewport(state:Pick<EditorState,'document'|'layoutId'|'dxfViewportId'> & {viewportEditing?:boolean;viewportNavigation?:ViewportNavigation|null}){const layout=activeLayout(state);const vp=layout?.viewports.find(v=>v.id===state.dxfViewportId)??layout?.viewports[0];return vp?navigationViewport(vp,state):undefined;}
export function currentViewEntityIds(state:Pick<EditorState,'document'|'layoutId'|'dxfViewportId'> & {viewportNavigation?:ViewportNavigation|null;viewportEditing?:boolean;isolation?:EditorState['isolation']},document:GeoDocument){const result=resolveSelectionScope(document,{kind:'current-view'},state);return new Set([...result.modelIds,...result.paperIds]);}
export const viewContextKey=(state:EditorState)=>JSON.stringify([state.layoutId,state.dxfViewportId,state.viewportEditing,state.viewportNavigation,state.isolation]);
