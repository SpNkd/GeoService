import {useState,useEffect} from 'react';
import {assetRegistry} from './registry';
export function useRasterAsset(id:string){const [state,setState]=useState<{id:string;bitmap:ImageBitmap|null;loaded:boolean}>({id,bitmap:null,loaded:false});useEffect(()=>{let active=true;assetRegistry.retain(id);void assetRegistry.bitmap(id).then(bitmap=>{if(active)setState({id,bitmap,loaded:true});});return()=>{active=false;assetRegistry.releaseBitmap(id);};},[id]);return state.id===id?state:{id,bitmap:null,loaded:false};}
