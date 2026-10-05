import { vectorPath } from '../vectors/path';
import { memo } from 'react';
import type { Entity, GeoDocument, Viewport } from '../domain/model';
import type { VectorPrimitive } from '../vectors/types';
import { blockMatrix, vectorEntityBounds, arcSweep } from '../vectors/geometry';
import { worldToScreen, type ViewSize } from '../geometry';
const blockSvgId=(id:string)=>`geo-block-${Array.from(id).map(c=>c.codePointAt(0)!.toString(16)).join('-')}`;
function arcPath(p:Extract<VectorPrimitive,{kind:'arc'}>):string {
  const a={x:p.center.x+p.radius*Math.cos(p.startAngle),y:p.center.y+p.radius*Math.sin(p.startAngle)},sweep=arcSweep(p.startAngle,p.endAngle),end=p.startAngle+sweep,b={x:p.center.x+p.radius*Math.cos(end),y:p.center.y+p.radius*Math.sin(end)};
  if(sweep>=2*Math.PI-1e-12)return `M${p.center.x+p.radius},${p.center.y}a${p.radius},${p.radius} 0 1 1 ${-2*p.radius},0a${p.radius},${p.radius} 0 1 1 ${2*p.radius},0`;
  return `M${a.x},${a.y}A${p.radius},${p.radius} 0 ${sweep>Math.PI?1:0} 1 ${b.x},${b.y}`;
}
const pathData=(p:Extract<VectorPrimitive,{kind:'path'}>)=>vectorPath(p.points,p.closed);
function PrimitiveSet({document,primitives,inheritAll=false}:{document:GeoDocument;primitives:VectorPrimitive[];inheritAll?:boolean}) {
  const layers=new Map(document.layers.map(l=>[l.id,l])),styles=new Map(document.styles.map(s=>[s.id,s])),blocks=new Map(document.blocks?.map(b=>[b.id,b])??[]);
  // Compound fill is restricted to one HATCH, never unrelated block primitives.
  const fillGroups=new Map<string,Extract<VectorPrimitive,{kind:'path'}>[]>();
  for(const p of primitives)if(p.kind==='path'&&p.fill&&p.fillGroup&&p.visible!==false&&(inheritAll||layers.get(p.layerId)?.name==='0'||layers.get(p.layerId)?.visible===true)){const ps=fillGroups.get(p.fillGroup)??[];ps.push(p);fillGroups.set(p.fillGroup,ps);}
  return <>
    {[...fillGroups.entries()].map(([id,ps])=>{const p=ps[0]!,layer=layers.get(p.layerId),inherit=inheritAll||layer?.name==='0',stroke=p.colorMode==='explicit'?p.stroke:p.colorMode==='byblock'||inherit?'currentColor':styles.get(layer?.styleId??'')?.stroke??'currentColor';return <path key={id} d={ps.map(pathData).join(' ')} fill={stroke} fillRule="evenodd" stroke="none" opacity={p.fillOpacity??1} pointerEvents="visiblePainted" />;})}
    {primitives.map((p,i)=>{
      const layer=layers.get(p.layerId),style=styles.get(layer?.styleId??''),inherit=inheritAll||layer?.name==='0';if(p.visible===false||!inherit&&!layer?.visible)return null;
      const stroke=p.colorMode==='explicit'?p.stroke:p.colorMode==='byblock'||inherit?'currentColor':style?.stroke??'currentColor';
      const common={stroke,strokeWidth:p.lineWeight??(inherit?undefined:style?.lineWeight),strokeDasharray:p.dash??(inherit?undefined:style?.dash),vectorEffect:'non-scaling-stroke' as const};
      if(p.kind==='path')return <path key={i} d={pathData(p)} {...common} fill={p.fill&&!p.fillGroup?stroke:'none'} fillOpacity={p.fillOpacity??1} fillRule="evenodd" pointerEvents="visiblePainted" />;
      if(p.kind==='circle')return <circle key={i} cx={p.center.x} cy={p.center.y} r={p.radius} {...common} fill="none" />;
      if(p.kind==='arc')return <path key={i} d={arcPath(p)} {...common} fill="none" />;
      if(p.kind==='text')return <text key={i} transform={`translate(${p.position.x} ${p.position.y}) rotate(${p.rotationDeg}) scale(1 -1)`} fill={stroke} stroke="none" fontSize={p.height} fontFamily="sans-serif">{p.content.split('\n').map((line,j)=><tspan key={j} x={0} dy={j?1.2*p.height:0}>{line}</tspan>)}</text>;
      const block=blocks.get(p.blockDefinitionId);return block?<use key={i} href={`#${blockSvgId(block.id)}`} transform={`matrix(${blockMatrix(p,block.basePoint).join(' ')})`} color={stroke} strokeWidth={p.lineWeight??(inherit?undefined:style?.lineWeight)} strokeDasharray={p.dash??(inherit?undefined:style?.dash)} />:null;
    })}
  </>;
}
/** SVG definitions are prepared once; repeated and nested INSERTs reference them with <use>. */
export const BlockDefinitions=memo(function BlockDefinitions({document}:{document:GeoDocument}) {
  return <defs aria-hidden="true">{document.blocks?.map(b=><g key={b.id} id={blockSvgId(b.id)}><PrimitiveSet document={document} primitives={b.primitives} /></g>)}</defs>;
},(a,b)=>a.document.blocks===b.document.blocks&&a.document.layers===b.document.layers&&a.document.styles===b.document.styles);
export function VectorView({entity,document,viewport,size,color,selected,lineWeight=1}:{entity:Entity;document:GeoDocument;viewport:Viewport;size:ViewSize;color:string;selected:boolean;lineWeight?:number}) {
  const bounds=vectorEntityBounds(document,entity),screen=bounds.map(p=>worldToScreen(p,viewport,size));let content:React.ReactNode;
  const pp=viewport.pixelsPerUnit;
  if(entity.type==='arc'||entity.type==='circle'){
    const c=worldToScreen(entity.center,viewport,size),p:VectorPrimitive={kind:entity.type,center:{x:0,y:0},radius:entity.radius,layerId:entity.layerId,colorMode:'byblock',...(entity.type==='arc'?{startAngle:entity.startAngle,endAngle:entity.endAngle}:{})} as VectorPrimitive;
    content=<g transform={`translate(${c.x} ${c.y}) scale(${pp} ${-pp})`}><PrimitiveSet document={document} primitives={[p]} inheritAll /></g>;
  }else if(entity.type==='block_instance'){
    const b=document.blocks?.find(b=>b.id===entity.blockDefinitionId);if(!b)return null;
    const c=worldToScreen(entity.position,viewport,size),m=blockMatrix({...entity,position:{x:0,y:0}},b.basePoint);
    content=<g transform={`translate(${c.x} ${c.y}) scale(${pp} ${-pp})`}><use href={`#${blockSvgId(b.id)}`} transform={`matrix(${m.join(' ')})`} /><PrimitiveSet document={document} primitives={entity.attributePrimitives??[]} inheritAll /></g>;
  }else if(entity.type==='imported_graphic'){
    const c=worldToScreen(entity.position,viewport,size);content=<g transform={`translate(${c.x} ${c.y}) scale(${pp} ${-pp})`}><PrimitiveSet document={document} primitives={entity.primitives} inheritAll /></g>;
  }
  const xs=screen.map(p=>p.x),ys=screen.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
  return <g color={color} strokeWidth={lineWeight}>
    {screen.length>0&&<rect data-move-body="" x={x-5} y={y-5} width={Math.max(10,w+10)} height={Math.max(10,h+10)} fill="transparent" stroke={selected?color:'none'} strokeWidth={1} strokeDasharray="4 3" pointerEvents={selected?"all":"none"} />}
    {content}
  </g>;
}
