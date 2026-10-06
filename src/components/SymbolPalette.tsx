import { CloseButton } from './IconButton';
import {useEditorPopover} from '../editor/focus';
import { useState,useRef } from 'react';
import { listLibraries } from '../symbols/registry';
import { SymbolView } from '../renderer/SymbolView';
export function SymbolPalette({onChoose,onClose}:{onChoose:(libraryId:string,symbolId:string)=>void;onClose:()=>void}) {
  const popup=useRef<HTMLElement>(null);useEditorPopover(popup,onClose);
  const [query,setQuery]=useState(''),[libraryId,setLibraryId]=useState(listLibraries()[0]!.id),[category,setCategory]=useState('');
  const library=listLibraries().find(l=>l.id===libraryId)!,needle=query.trim().toLocaleLowerCase('ru');
  const symbols=library.symbols.filter(s=>(!category||s.category===category)&&[s.name,...s.aliases??[],s.category].some(text=>text.toLocaleLowerCase('ru').includes(needle)));
  return <section ref={popup} className="symbol-palette" role="dialog" aria-label="Библиотека символов" data-shortcut-suppressed onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}}}>
    <div className="panel-heading"><h2>Символы</h2><CloseButton label="Закрыть символы" onClick={onClose}/></div>
    <label>Библиотека<select aria-label="Библиотека символов" value={libraryId} onChange={e=>{setLibraryId(e.target.value);setCategory('');}}>{listLibraries().map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <p className="property-note">{library.description}</p>
    <input autoFocus aria-label="Поиск символов" placeholder="Название, alias или категория" value={query} onChange={e=>setQuery(e.target.value)}/>
    <select aria-label="Категория символов" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Все категории</option>{library.categories.map(c=><option key={c}>{c}</option>)}</select>
    <div className="symbol-palette-grid">{symbols.map(s=><button key={s.id} aria-label={`Вставить символ: ${s.name}`} onClick={()=>onChoose(library.id,s.id)}><svg width="76" height="56" viewBox="0 0 76 56" aria-hidden="true"><SymbolView entity={{type:'symbol',id:'preview',name:s.name,layerId:'preview',libraryId:library.id,symbolId:s.id,position:{x:0,y:0},rotationDeg:0,scale:1}} viewport={{center:{x:0,y:0},pixelsPerUnit:40/s.defaultSize}} size={{width:76,height:56}}/></svg><span>{s.name}</span></button>)}</div>
    {!symbols.length&&<p>Символы не найдены</p>}
  </section>;
}
