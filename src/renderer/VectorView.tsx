import { vectorPath } from '../vectors/path';
import { memo } from 'react';
import type { Entity, GeoDocument, Viewport } from '../domain/model';
import type { VectorPrimitive } from '../vectors/types';
import { blockDefinition, blockMatrix, vectorEntityBounds, arcSweep } from '../vectors/geometry';
import { worldToScreen, type ViewSize } from '../geometry';
import { prepareVectorSet, vectorRenderOrigin } from './vectorPreparation';
import { createVectorStyleResolver } from './vectorStyle';
const blockSvgId=(id:string)=>`geo-block-${Array.from(id).map(c=>c.codePointAt(0)!.toString(16)).join('-')}`;
function arcPath(p:Extract<VectorPrimitive,{kind:'arc'}>):string {
  const a={x:p.center.x+p.radius*Math.cos(p.startAngle),y:p.center.y+p.radius*Math.sin(p.startAngle)},sweep=arcSweep(p.startAngle,p.endAngle),end=p.startAngle+sweep,b={x:p.center.x+p.radius*Math.cos(end),y:p.center.y+p.radius*Math.sin(end)};
  if(sweep>=2*Math.PI-1e-12)return `M${p.center.x+p.radius},${p.center.y}a${p.radius},${p.radius} 0 1 1 ${-2*p.radius},0a${p.radius},${p.radius} 0 1 1 ${2*p.radius},0`;
  return `M${a.x},${a.y}A${p.radius},${p.radius} 0 ${sweep>Math.PI?1:0} 1 ${b.x},${b.y}`;
}
const pathData=(p:Extract<VectorPrimitive,{kind:'path'}>)=>vectorPath(p.points,p.closed);
/** Prepared local SVG coordinates; nested references already account for canonical base points. */
export const PrimitiveSet = memo(function PrimitiveSet({document,primitives,inheritAll=false}:{document:GeoDocument;primitives:VectorPrimitive[];inheritAll?:boolean}) {
  const blocks=new Map(document.blocks?.map(b=>[b.id,b])??[]);
  const resolve=createVectorStyleResolver(document),parent={stroke:'currentColor',lineWeight:NaN,dash:undefined};
  // Compound fill is restricted to one HATCH, never unrelated block primitives.
  const fillGroups=new Map<string,Extract<VectorPrimitive,{kind:'path'}>[]>();
  for(const p of primitives)if(p.kind==='path'&&p.fill&&p.fillGroup&&resolve(p,parent,inheritAll).visible){const ps=fillGroups.get(p.fillGroup)??[];ps.push(p);fillGroups.set(p.fillGroup,ps);}
  return <>
    {[...fillGroups.entries()].map(([id,ps])=>{const p=ps[0]!,{stroke}=resolve(p,parent,inheritAll);return <path key={id} d={ps.map(pathData).join(' ')} fill={stroke} fillRule="evenodd" stroke="none" opacity={p.fillOpacity??1} pointerEvents="visiblePainted" />;})}
    {primitives.map((p,i)=>{
      const paint=resolve(p,parent,inheritAll);if(!paint.visible)return null;
      const stroke=paint.stroke;
      const common={stroke,strokeWidth:Number.isFinite(paint.lineWeight)?paint.lineWeight:undefined,strokeDasharray:paint.dash,vectorEffect:'non-scaling-stroke' as const};
      if(p.kind==='path')return <path key={i} d={pathData(p)} {...common} fill={p.fill&&!p.fillGroup?stroke:'none'} fillOpacity={p.fillOpacity??1} fillRule="evenodd" pointerEvents="visiblePainted" />;
      if(p.kind==='circle')return <circle key={i} cx={p.center.x} cy={p.center.y} r={p.radius} {...common} fill="none" />;
      if(p.kind==='arc')return <path key={i} d={arcPath(p)} {...common} fill="none" />;
      if(p.kind==='text')return <text key={i} transform={`translate(${p.position.x} ${p.position.y}) rotate(${p.rotationDeg}) scale(1 -1)`} fill={stroke} stroke="none" fontSize={p.height} fontFamily="sans-serif">{p.content.split('\n').map((line,j)=><tspan key={j} x={0} dy={j?1.2*p.height:0}>{line}</tspan>)}</text>;
      const block=blocks.get(p.blockDefinitionId);return block?<use key={i} href={`#${blockSvgId(block.id)}`} transform={`matrix(${blockMatrix(p,{x:0,y:0}).join(' ')})`} color={stroke} strokeWidth={common.strokeWidth} strokeDasharray={common.strokeDasharray} />:null;
    })}
  </>;
}, (a,b)=>{
  if(a.primitives!==b.primitives||a.inheritAll!==b.inheritAll||a.document.blocks!==b.document.blocks)return false;
  if(a.document.layers===b.document.layers&&a.document.styles===b.document.styles)return true;
  const layersA=new Map(a.document.layers.map(l=>[l.id,l])),layersB=new Map(b.document.layers.map(l=>[l.id,l])),stylesA=new Map(a.document.styles.map(s=>[s.id,s])),stylesB=new Map(b.document.styles.map(s=>[s.id,s]));
  return a.primitives.every(p=>{const la=layersA.get(p.layerId),lb=layersB.get(p.layerId);return la===lb&&stylesA.get(la?.styleId??'')===stylesB.get(lb?.styleId??'');});
});
/** SVG definitions are prepared once; repeated and nested INSERTs reference them with <use>. */
export const BlockDefinitions=memo(function BlockDefinitions({document,roots}:{document:GeoDocument;roots?:readonly string[]}) {
  const needed=new Set<string>();
  const visit=(id:string)=>{if(needed.has(id))return;needed.add(id);const b=blockDefinition(document,id);for(const p of b?.primitives??[])if(p.kind==='block')visit(p.blockDefinitionId);};
  roots?.forEach(visit);
  return <defs aria-hidden="true">{document.blocks?.filter(b=>!roots||needed.has(b.id)).map(b=><g key={b.id} id={blockSvgId(b.id)}><PrimitiveSet document={document} primitives={prepareVectorSet(document,b.primitives).primitives} /></g>)}</defs>;
},(a,b)=>a.roots===b.roots&&a.document.blocks===b.document.blocks&&a.document.layers===b.document.layers&&a.document.styles===b.document.styles);
const VectorContent = memo(function VectorContent({ entity, document }: { entity: Entity; document: GeoDocument }) {
  if (entity.type === 'arc' || entity.type === 'circle') {
    const primitive = { ...entity, center:{x:0,y:0}, kind: entity.type, colorMode: 'byblock' } as VectorPrimitive;
    return <PrimitiveSet document={document} primitives={[primitive]} inheritAll />;
  }
  if (entity.type === 'block_instance') {
    const block = blockDefinition(document, entity.blockDefinitionId);
    if (!block) return null;
    const matrix = blockMatrix(entity, block.basePoint), origin = vectorRenderOrigin(document, entity);
    const attributes = prepareVectorSet(document, entity.attributePrimitives ?? []);
    return <><use href={`#${blockSvgId(block.id)}`} transform={`matrix(${[...matrix.slice(0,4),0,0].join(' ')})`} /><g transform={`translate(${entity.position.x + attributes.origin.x - origin.x} ${entity.position.y + attributes.origin.y - origin.y})`}><PrimitiveSet document={document} primitives={attributes.primitives} inheritAll /></g></>;
  }
  if (entity.type === 'imported_graphic') return <PrimitiveSet document={document} primitives={prepareVectorSet(document,entity.primitives).primitives} inheritAll />;
  return null;
}, (a,b)=>{
  if(a.document.blocks!==b.document.blocks||a.document.layers!==b.document.layers||a.document.styles!==b.document.styles)return false;
  const x=a.entity,y=b.entity;if(x===y)return true;
  if(x.type==='block_instance'&&y.type==='block_instance')return x.blockDefinitionId===y.blockDefinitionId&&x.rotationDeg===y.rotationDeg&&x.scaleX===y.scaleX&&x.scaleY===y.scaleY&&x.attributePrimitives===y.attributePrimitives;
  if(x.type==='imported_graphic'&&y.type==='imported_graphic')return x.primitives===y.primitives;
  if(x.type==='circle'&&y.type==='circle')return x.radius===y.radius;
  return x.type==='arc'&&y.type==='arc'&&x.radius===y.radius&&x.startAngle===y.startAngle&&x.endAngle===y.endAngle;
});
export function VectorView({entity,document,viewport,size,color,selected,lineWeight=1}:{entity:Entity;document:GeoDocument;viewport:Viewport;size:ViewSize;color:string;selected:boolean;lineWeight?:number}) {
  const anchor=worldToScreen(vectorRenderOrigin(document,entity),viewport,size);
  const screen = vectorEntityBounds(document, entity).map(p => worldToScreen(p, viewport, size)), pp = viewport.pixelsPerUnit;
  const xs=screen.map(p=>p.x),ys=screen.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
  return <g color={color} strokeWidth={lineWeight}>
    {selected && screen.length > 0 && <rect data-move-body="" x={x-5} y={y-5} width={Math.max(10,w+10)} height={Math.max(10,h+10)} fill="transparent" stroke={color} strokeWidth={1} strokeDasharray="4 3" pointerEvents="all" />}
    <g transform={`translate(${anchor.x} ${anchor.y}) scale(${pp} ${-pp})`}><VectorContent entity={entity} document={document} /></g>
  </g>;
}
