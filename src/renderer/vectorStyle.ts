import { frozenPresentationLayers } from '../layouts/context';
import { lineTypes,styleIntent } from '../styles/model';
import type { Entity, GeoDocument } from '../domain/model';
import type { PrimitiveStyle } from '../vectors/types';

export interface Paint { stroke: string; lineWeight: number; dash: string | undefined;opacity?:number;fill?:string;fillOpacity?:number;textColor?:string;textSize?:number|undefined }
const indexes=new WeakMap<GeoDocument,{layers:Map<string,GeoDocument['layers'][number]>;styles:Map<string,GeoDocument['styles'][number]>}>();
export function createVectorStyleResolver(document: GeoDocument, owner?:Entity) {
  let index=indexes.get(document);if(!index){index={layers:new Map(document.layers.map(l=>[l.id,l])),styles:new Map(document.styles.map(s=>[s.id,s]))};indexes.set(document,index);}const {layers,styles}=index;
  return (p: PrimitiveStyle, parent: Paint, inheritAll = false): Paint & { visible: boolean } => {
    const layer = layers.get(p.layerId), style = styles.get(layer?.styleId ?? '');
    const inherit = inheritAll || layer?.name === '0';
    const ownerLayer=owner?layers.get(owner.layerId):undefined,overrides=owner?.style;
    const value=(key:keyof import('../styles/model').StyleValues)=>styleIntent(key,overrides,ownerLayer?.style,layer?.style,()=>({strokeColor:styles.get(ownerLayer?.styleId??'')?.stroke,lineWidth:styles.get(ownerLayer?.styleId??'')?.lineWeight,lineType:lineTypes.find(t=>t.dash===styles.get(ownerLayer?.styleId??'')?.dash)?.id,opacity:1,fillColor:styles.get(ownerLayer?.styleId??'')?.fill,fillOpacity:1,textColor:styles.get(ownerLayer?.styleId??'')?.stroke,textSize:undefined})[key]);
    const baseline={
      visible: !frozenPresentationLayers(document)?.has(p.layerId) && p.visible !== false && (inherit || layer?.visible === true),
      stroke: p.colorMode === 'explicit' ? p.stroke ?? parent.stroke : p.colorMode === 'byblock' || inherit ? parent.stroke : style?.stroke ?? parent.stroke,
      lineWeight: p.lineWeight ?? (inherit ? parent.lineWeight : style?.lineWeight ?? parent.lineWeight),
      dash: p.dash ?? (inherit ? parent.dash : style?.dash ?? parent.dash),
    };
    return {...baseline,stroke:value('strokeColor') as string??baseline.stroke,lineWeight:value('lineWidth') as number??baseline.lineWeight,dash:overrides?.lineType===null&&ownerLayer?.style?.lineType===undefined?styles.get(ownerLayer?.styleId??'')?.dash:value('lineType')!==undefined?lineTypes.find(t=>t.id===value('lineType'))?.dash:baseline.dash,opacity:value('opacity') as number??parent.opacity??1,fill:value('fillColor') as string??(owner?.type==='polygon'?parent.fill:undefined),fillOpacity:value('fillOpacity') as number??parent.fillOpacity??1,textColor:value('textColor') as string??value('strokeColor') as string??baseline.stroke,textSize:value('textSize') as number|undefined};
  };
}
