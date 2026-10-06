import type { ProcessPlan } from '../process/plan';
import type { Viewport } from '../domain/model';
import type { ViewSize } from '../geometry';
import { SymbolView } from './SymbolView';
import { ConnectorView } from './ConnectorView';
export function ProcessGhost({plan,viewport,size}:{plan:ProcessPlan;viewport:Viewport;size:ViewSize}){
  if(plan.status!=='ready'||!plan.projectedDocument)return null;
  return <g data-testid="process-ghost" pointerEvents="none">{plan.symbols.map(e=><SymbolView key={e.id} entity={e} viewport={viewport} size={size} ghost color="#a56a1e"/>)}{plan.connectors.map(e=><g key={e.id} data-testid="process-connector-ghost" opacity={.55}><ConnectorView entity={e} document={plan.projectedDocument!} viewport={viewport} size={size} stroke="#a56a1e" lineWeight={1.6} dash="5 3" editable={false}/></g>)}</g>;
}
