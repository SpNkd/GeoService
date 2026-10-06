import { useState, type ReactNode } from 'react';
import { CloseButton, IconButton } from './IconButton';
/** Small local view state: panels stay mounted, drafts and search filters survive navigation. */
export function EditorDock({side,children}:{side:'left'|'right';children:ReactNode}){
 const [collapsed,setCollapsed]=useState(false),[tab,setTab]=useState('all');
 const tabs:readonly (readonly [string,string])[]=side==='right'?[['properties','Свойства'],['search','Поиск'],['ai','AI']]:[];
 return <div className={`editor-dock ${side}-column ${collapsed?'dock-collapsed':''} dock-tab-${tab}`} data-dock={side}>
 <div className="dock-heading">{collapsed?<IconButton label={side==='left'?'Развернуть Виды и Слои':'Развернуть панели'} icon="layers" onClick={()=>setCollapsed(false)}/>:<><nav aria-label={side==='right'?'Панели редактора':'Виды и слои'}>{side==='left'?<strong>Виды / Слои</strong>:tabs.map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(tab===id?'all':id)}>{label}</button>)}</nav><CloseButton label={side==='left'?'Свернуть Виды и Слои':'Свернуть панели'} onClick={()=>setCollapsed(true)}/></>}</div>
 <div className="dock-content" hidden={collapsed}>{children}</div>
 </div>;
}
