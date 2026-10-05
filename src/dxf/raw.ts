/** Focused group inventory for missing parser fields/types; geometry still uses dxf-parser. */
export interface Group { code: number; value: string }
export interface RawRecord { type: string; groups: Group[]; section: string; block?: string }
export const value=(r:RawRecord,code:number)=>r.groups.find(g=>g.code===code)?.value;
export const number=(r:RawRecord,code:number,fallback=0)=>{const v=value(r,code);if(v===undefined)return fallback;const n=Number(v);if(!Number.isFinite(n))throw new Error(`DXF ${r.type}: non-finite group ${code}`);return n;};
export function scanRecords(text:string):RawRecord[] {
  const lines=text.replace(/^\uFEFF/,'').trimEnd().split(/\r\n|\n|\r/);if(lines.length%2)throw new Error('DXF: incomplete group pair');let section='',block:string|undefined,current:RawRecord|undefined;const out:RawRecord[]=[];
  const finish=()=>{if(!current)return;if(current.type==='SECTION')section=value(current,2)??'';else if(current.type==='BLOCK')block=value(current,2);else if(current.type==='ENDBLK')block=undefined;current.section=section;if(block!==undefined)current.block=block;if(['ENTITIES','BLOCKS','TABLES'].includes(section))out.push(current);};
  let eof=false;
  for(let i=0;i+1<lines.length;i+=2){const code=Number(lines[i]!.trim()),v=lines[i+1]!.trim();if(!Number.isInteger(code)||code<0||code>1071)throw new Error('DXF: invalid group code');if(code===0){finish();current={type:v,groups:[],section};if(v==='EOF')eof=true;}if(current)current.groups.push({code,value:v});}
  finish();if(!eof||!text.includes('ENTITIES'))throw new Error('DXF: отсутствует ENTITIES или EOF');return out;
}
