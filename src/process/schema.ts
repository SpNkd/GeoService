import { z } from 'zod';
import { PROCESS_KINDS } from './semantics';
export const PROCESS_LIMITS=Object.freeze({symbols:50,connectors:80,branches:0});
const name=z.string().trim().min(1).max(128);
export const processItemSchema=z.strictObject({ref:z.string().regex(/^step-[1-9][0-9]*$/).max(32),symbolKind:z.enum(PROCESS_KINDS),name:name.nullish()});
export const processReferenceSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('named_entity'),name}),z.strictObject({kind:z.literal('current_selection')}),
]);
export const processActionSchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('create_process_chain'),items:z.array(processItemSchema).min(1).max(50),connections:z.array(z.strictObject({from:name,to:name})).max(80)}),
  z.strictObject({type:z.literal('append_process_symbols'),reference:processReferenceSchema,items:z.array(processItemSchema).min(1).max(50)}),
  z.strictObject({type:z.literal('insert_symbol_between'),from:processReferenceSchema,to:processReferenceSchema,item:processItemSchema}),
]);
export type ProcessAction=z.infer<typeof processActionSchema>;
export type ProcessItem=z.infer<typeof processItemSchema>;
export type ProcessReference=z.infer<typeof processReferenceSchema>;
export function isProcessAction(a:{type:string}):a is ProcessAction{return processActionSchema.options.some(o=>o.shape.type.value===a.type);}
export function validateProcessActions(actions:readonly ProcessAction[]):void {
  let symbols=0,connectors=0;
  for(const a of actions){const items=a.type==='insert_symbol_between'?[a.item]:a.items;symbols+=items.length;connectors+=a.type==='create_process_chain'?a.connections.length:a.type==='insert_symbol_between'?2:a.items.length;
    if(new Set(items.map(i=>i.ref)).size!==items.length)throw new Error('Повторяющиеся semantic refs');
    if(a.type==='create_process_chain'){
      // V1 topology is exactly one ordered chain; no hidden junction or omitted item.
      if(a.connections.length!==Math.max(0,items.length-1)||a.connections.some((c,i)=>c.from!==items[i]?.ref||c.to!==items[i+1]?.ref))throw new Error('V1 поддерживает одну последовательную цепочку без ответвлений');
    }
  }
  if(symbols>PROCESS_LIMITS.symbols||connectors>PROCESS_LIMITS.connectors)throw new Error('Превышен лимит 50 символов / 80 соединений');
}
