import { forwardRef, memo, useImperativeHandle, useState } from 'react';
import type { EditorState } from '../store/editor';
import { screenToWorld, type ScreenPoint, type ViewSize } from '../geometry';
import { modelViewportCamera } from '../layouts/camera';
import { activeDxfViewport } from '../layouts/context';
import { documentSurveyXY } from '../geometry/georeferencing';
import { formatCoordinate } from '../geometry/format';
import { Icon } from './Icon';
export interface CursorReadoutHandle { update(point: ScreenPoint | null): void }
/** Pointer feedback belongs to this small leaf, rather than invalidating the editor tree. */
export const CursorReadout = memo(forwardRef<CursorReadoutHandle,{state:EditorState;size:ViewSize}>(function CursorReadout({state,size},ref){
 const [point,setPoint]=useState<ScreenPoint|null>(null);
 useImperativeHandle(ref,()=>({update:setPoint}),[]);
 const vp=activeDxfViewport(state),world=point&&state.viewMode==='plan'?state.layoutId?state.viewportEditing&&state.layoutViewport&&vp?screenToWorld(point,modelViewportCamera(vp,state.layoutViewport,size),size):null:screenToWorld(point,state.viewport,size):null;
 const survey=world&&state.coordinateDisplay==='survey'?documentSurveyXY(state.document,world):null;
 return <div className="status-coordinates"><Icon name="crosshair" size={14}/><span>{state.coordinateDisplay==='model'?'X':'E'} <b data-testid="cursor-x">{state.coordinateDisplay==='model'?world?formatCoordinate(world.x):'—':survey?formatCoordinate(survey.e):'—'}</b></span><span>{state.coordinateDisplay==='model'?'Y':'N'} <b data-testid="cursor-y">{state.coordinateDisplay==='model'?world?formatCoordinate(world.y):'—':survey?formatCoordinate(survey.n):'—'}</b></span><span>м</span></div>;
}));
