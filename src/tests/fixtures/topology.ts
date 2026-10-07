import { createNewDocument } from '../../domain/newDocument';
import type { GeoDocument, WorldPoint } from '../../domain/model';
import { symbol } from './connectorDocument';
export function addPath(d:GeoDocument,id:string,points:WorldPoint[],sharedIds?:string[]){const ids=points.map((_,i)=>sharedIds?.[i]??`${id}-v${i}`);points.forEach((p,i)=>d.vertices[ids[i]!]={id:ids[i]!,...p});d.entities.push(points.length===2?{id,name:id,type:'line',layerId:'buildings',startVertexId:ids[0]!,endVertexId:ids[1]!}:{id,name:id,type:'polyline',layerId:'buildings',vertexIds:ids as [string,string,...string[]]});return d;}
export function topologyFixture(kind:'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'='A'){
 const d=createNewDocument();d.metadata.id=`topology-${kind}`;d.entities=[symbol('valve','valve',0),symbol('regulator','pressure-regulator',8)];
 if(kind==='B'){d.entities[0]={...symbol('valve','valve',0),scale:.01};addPath(d,'route',[{x:0,y:0},{x:7,y:0}]);}
 else if(kind==='G'){d.entities[1]=symbol('instrument','instrument-point',8,1);addPath(d,'route',[{x:1,y:0},{x:8,y:0}]);}
 else if(kind==='H')addPath(d,'route',[{x:1,y:0},{x:2,y:0},{x:2,y:2},{x:5,y:2},{x:5,y:-2},{x:6,y:-2},{x:6,y:0},{x:7,y:0}]);
 else if(kind==='E'||kind==='F'){addPath(d,'left',[{x:1,y:0},{x:4,y:0}]);addPath(d,'right',[{x:kind==='E'?4.04:4.5,y:0},{x:7,y:0}]);}
 else {addPath(d,'route',[{x:1,y:0},{x:7,y:0}]);if(kind==='C')addPath(d,'branch',[{x:4,y:0},{x:4,y:3}]);if(kind==='D')addPath(d,'cross',[{x:4,y:-3},{x:4,y:3}]);}
 return d;
}
export function processFixtureDocument(){const d=createNewDocument();d.metadata.id='topology-process';const definitions=['equipment-block','valve','filter','pressure-regulator','equipment-block'];d.entities=definitions.map((definition,i)=>({...symbol(`s${i}`,definition,i*6),name:['Input','Valve','Filter','Regulator','Output'][i]!}));for(let i=0;i<4;i++)addPath(d,`path${i}`,[{x:i*6+1,y:0},{x:(i+1)*6-1,y:0}]);return d;}
