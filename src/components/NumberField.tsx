import { useEffect, useState } from 'react';
/** Shared numeric draft: text editing remains local until Enter/blur; external values stay synchronized. */
export function NumberField({label,value,suffix,min,max,step='any',onCommit}:{label:string;value:number;suffix?:string;min?:number;max?:number;step?:string|number;onCommit:(value:number)=>void}){
 const [draft,setDraft]=useState(String(value));useEffect(()=>setDraft(String(value)),[value]);
 const commit=()=>{const n=Number(draft);if(draft.trim()&&Number.isFinite(n)&&(min===undefined||n>=min)&&(max===undefined||n<=max))onCommit(n);else setDraft(String(value));};
 return <label className="number-field">{label}<span><input aria-label={label} type="number" min={min} max={max} step={step} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();}}}/>{suffix&&<span aria-hidden="true">{suffix}</span>}</span></label>;
}
