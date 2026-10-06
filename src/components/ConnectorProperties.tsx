import type { Dispatch } from 'react';
import type { ConnectorEntity } from '../domain/model';
import type { EditorAction, EditorState } from '../store/editor';
import { connectorLength, resolvePort } from '../connectors/model';
import { formatDistance } from '../geometry/format';
export function ConnectorProperties({entity,state,locked,dispatch}:{entity:ConnectorEntity;state:EditorState;locked:boolean;dispatch:Dispatch<EditorAction>}) {
  return <div className="property-section"><h3>Соединение</h3>
    {(['start','end'] as const).map(endpoint=>{const resolved=resolvePort(state.document,entity[endpoint]);return <div key={endpoint}><label>{endpoint==='start'?'Начало':'Конец'}<output data-testid={`connector-${endpoint}`}>{resolved.entity.name} · {resolved.port.id}</output></label><button className="secondary-action" disabled={locked||Boolean(state.transactionBefore)} aria-label={`Выбрать порт: ${endpoint==='start'?'начало':'конец'}`} onClick={()=>dispatch({type:'begin-connector-retarget',entityId:entity.id,endpoint})}>Выбрать порт</button></div>;})}
    <label>Маршрутизация<select aria-label="Маршрутизация соединения" disabled={locked||Boolean(state.transactionBefore)} value={entity.routing} onChange={event=>dispatch({type:'execute',command:{type:'set-connector-routing',entityId:entity.id,routing:event.target.value as 'direct'|'orthogonal'}})}><option value="orthogonal">Ортогональная</option><option value="direct">Прямая</option></select></label>
    <dl className="property-facts"><dt>Длина</dt><dd>{formatDistance(connectorLength(state.document,entity))} м</dd></dl>
    <p className="property-note">Перетащите конечный grip на свободный совместимый порт. Символы остаются на месте. Esc отменяет выбор.</p>
  </div>;
}
