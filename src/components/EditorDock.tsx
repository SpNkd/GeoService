import { updatePreferences,usePreferences } from '../preferences/store';
import { useState, type ReactNode } from 'react';
import { CloseButton, IconButton } from './IconButton';
/** Small local view state: panels stay mounted, drafts and search filters survive navigation. */
export function EditorDock({side,children}:{side:'left'|'right';children:ReactNode}){
 const preferences=usePreferences(),[collapsed,setCollapsed]=useState(false),tab=side==='right'?preferences.rightTab:'all';
 const tabs:readonly (readonly [string,string])[]=side==='right'?[['properties','Свойства'],['search','Поиск'],['ai','AI']]:[];
 return <div className={`editor-dock ${side}-column ${collapsed?'dock-collapsed':''} dock-tab-${tab}`} data-dock={side}>
 <div className="dock-heading">{collapsed?<IconButton label={side==='left'?'Развернуть Виды и Слои':'Развернуть панели'} icon="layers" onClick={()=>setCollapsed(false)}/>:<><nav role={side==='right'?'tablist':undefined} aria-label={side==='right'?'Панели редактора':'Виды и слои'}>{side==='left'?<strong>Виды / Слои</strong>:tabs.map(([id,label])=><button key={id} id={`editor-tab-${id}`} aria-controls={`editor-panel-${id}`} role="tab" aria-selected={tab===id} aria-pressed={tab===id} onClick={()=>updatePreferences({rightTab:id as 'properties'|'search'|'ai'})}>{label}</button>)}</nav><CloseButton label={side==='left'?'Свернуть Виды и Слои':'Свернуть панели'} onClick={()=>setCollapsed(true)}/></>}</div>
 <div className="dock-content" hidden={collapsed}>{children}</div>
 </div>;
}
