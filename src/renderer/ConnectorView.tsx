import type { ConnectorEntity, GeoDocument, Viewport } from '../domain/model';
import type { ViewSize } from '../geometry';
import { worldToScreen } from '../geometry';
import { connectorRoute } from '../connectors/model';
import { vectorPath } from '../vectors/path';
export function ConnectorView({entity,document,viewport,size,stroke,lineWeight,dash,editable}:{entity:ConnectorEntity;document:GeoDocument;viewport:Viewport;size:ViewSize;stroke:string;lineWeight:number;dash?:string|undefined;editable:boolean}) {
  const points=connectorRoute(document,entity).map(p=>worldToScreen(p,viewport,size)),d=vectorPath(points,false);
  return <>
    <path data-connector-hit="" d={d} stroke="transparent" strokeWidth={14} fill="none"/>
    <path data-testid="connector-route" d={d} stroke={stroke} strokeWidth={lineWeight} strokeDasharray={dash} strokeLinejoin="round" fill="none" pointerEvents="none"/>
    {editable&&(['start','end'] as const).map((endpoint,i)=>{const p=i?points.at(-1)!:points[0]!;return <rect key={endpoint} data-connector-grip={endpoint} x={p.x-5} y={p.y-5} width={10} height={10} fill="white" stroke="#277ec1" strokeWidth={1.5}/>;})}
  </>;
}
