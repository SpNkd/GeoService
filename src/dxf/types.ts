import type { GeoDocument } from '../domain/model';
import type { DxfEncoding } from './encoding';
export interface DxfOptions { encoding?: DxfEncoding; units?: 'mm' | 'cm' | 'm'; frame?: 'local' | 'projected' }
export interface TypeReport { total:number; converted:number; simplified:number; proxy:number; unsupported:number }
export interface DxfReport { filename:string; version:string; encoding:string; declaredCodepage:string; originalUnits:number; factor:number; requiresUnitsChoice:boolean; requiresEncodingChoice:boolean; layerCount:number; modelSpaceCount:number; blockCount:number; blockInstances:number; paperSpaceCount:number; types:Record<string,TypeReport>; blockTypes:Record<string,TypeReport>; warnings:string[]; timings:Record<string,number>; normalizedPrimitives:number }
export interface DxfPlan { document:GeoDocument; currentLayerId:string; report:DxfReport }
