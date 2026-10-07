import { useRef, type Dispatch } from 'react';
import type { EditorAction, EditorState } from '../store/editor';
import { viewRotation } from '../view/projection';
import { surveyNorthDirection } from '../geometry/georeferencing';
import { NumberField } from './NumberField';
export function ViewOrientation({state,dispatch}:{state:EditorState;dispatch:Dispatch<EditorAction>}){
 const ref=useRef<HTMLDetailsElement>(null);
 if(state.layoutId||state.viewMode!=='plan')return null;
 const apply=(angle:number)=>dispatch({type:'view-angle',angle});
 const align=(axis:'horizontal'|'vertical')=>{if(ref.current)ref.current.open=false;dispatch({type:'align-view',axis});};
 return <details ref={ref} className="view-orientation" data-popup><summary>Вид · {viewRotation(state.viewport).toFixed(1)}°</summary><div className="orientation-panel"><strong>Ориентация вида</strong><small>Поворот планового вида</small><div className="orientation-presets">{[-90,0,90,180].map(angle=><button key={angle} onClick={()=>apply(angle)} aria-label={`Повернуть вид ${angle}°`}>{angle>0?'+':''}{angle}°</button>)}</div><NumberField label="Поворот вида, °" value={viewRotation(state.viewport)} suffix="°" onCommit={apply}/><hr/><button aria-label="Север вверх" onClick={()=>apply(surveyNorthDirection(state.document.horizontalReference?.transform).rotationDegrees)}>↥ Север вверх</button><strong>Выровнять по двум точкам</strong><div className="orientation-align"><button aria-label="Выровнять горизонтально по 2 точкам" onClick={()=>align('horizontal')}>↔ Горизонтально</button><button aria-label="Выровнять вертикально по 2 точкам" onClick={()=>align('vertical')}>↕ Вертикально</button></div></div></details>;
}
