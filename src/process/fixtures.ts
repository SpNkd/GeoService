/** Deterministic test/mock fixtures only; never used to interpret real natural language. */
import type { ProcessAction } from './schema';
import type { ProcessKind } from './semantics';
export const PROCESS_REQUESTS={A:'Собери линию: вход, кран, фильтр, регулятор давления, счётчик, выход.',B:'Нарисуй цепочку вход → фильтр → регулятор → выход.',C:'После выбранного фильтра поставь регулятор давления и счётчик.',D:'Между клапаном К-1 и регулятором РД-1 вставь фильтр.',E:'Сделай две параллельные линии после входного крана: фильтр → регулятор в каждой.',insert:'Между краном и фильтром вставь ещё один фильтр.',append:'После счётчика добавь запорный кран.'} as const;
export const processItems=(kinds:ProcessKind[])=>kinds.map((symbolKind,i)=>({ref:`step-${i+1}`,symbolKind,name:null}));
export function chainAction(kinds:ProcessKind[]):ProcessAction {const items=processItems(kinds);return {type:'create_process_chain',items,connections:items.slice(1).map((item,i)=>({from:items[i]!.ref,to:item.ref}))};}
export const INITIAL_PROCESS_KINDS:ProcessKind[]=['input','shutoff_valve','filter','pressure_regulator','gas_meter','output'];
export const PROCESS_FIXTURES=new Map<string,unknown>([
  [PROCESS_REQUESTS.A,{actions:[chainAction(INITIAL_PROCESS_KINDS)]}],
  [PROCESS_REQUESTS.B,{actions:[chainAction(['input','filter','pressure_regulator','output'])]}],
  [PROCESS_REQUESTS.C,{actions:[{type:'append_process_symbols',reference:{kind:'current_selection'},items:processItems(['pressure_regulator','gas_meter'])}]}],
  [PROCESS_REQUESTS.D,{actions:[{type:'insert_symbol_between',from:{kind:'named_entity',name:'К-1'},to:{kind:'named_entity',name:'РД-1'},item:processItems(['filter'])[0]}]}],
  [PROCESS_REQUESTS.insert,{actions:[{type:'insert_symbol_between',from:{kind:'named_entity',name:'кран'},to:{kind:'named_entity',name:'фильтр'},item:processItems(['filter'])[0]}]}],
  [PROCESS_REQUESTS.append,{actions:[{type:'append_process_symbols',reference:{kind:'named_entity',name:'счётчик'},items:processItems(['shutoff_valve'])}]}],
  [PROCESS_REQUESTS.E,{status:'unsupported'}],
]);
