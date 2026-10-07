import type { ConnectorEndpoint, GeoDocument, WorldPoint } from '../domain/model';
import type { Bounds } from '../geometry';
export type Point = Pick<WorldPoint,'x'|'y'>;
export type Classification = 'CONFIRMED'|'STRONG'|'AMBIGUOUS'|'REJECTED';
export type Scope = {kind:'selection';ids:string[]}|{kind:'layer';layerId:string}|{kind:'concept';conceptId:string}|{kind:'area';bounds:Bounds}|{kind:'image-group';runId:string};
export interface PortOption {endpoint:ConnectorEndpoint;point:Point;label:string;kind:'process'|'instrument';directionDeg:number;available:boolean;distance:number;reason?:string}
export interface TopologyNode {id:string;point:Point;kind:'symbol_port'|'line_endpoint'|'geometric_junction'|'free_endpoint';ports:PortOption[];degree:number}
export interface TopologyEdge {id:string;from:string;to:string;kind:'traced_route'|'candidate_connection';sourceGeometryIds:string[];gapId?:string}
export interface Finding {id:string;kind:'junction'|'crossing'|'gap'|'free';point:Point;classification:Classification;evidence:string[];sourceGeometryIds:string[];distance?:number;angleDeg?:number;reviewed?:boolean;canonical?:boolean;degree?:number}
export interface RouteCandidate {id:string;edgeIds:string[];nodeIds:string[];points:Point[];sourceGeometryIds:string[];startOptions:PortOption[];endOptions:PortOption[];gapIds:string[];branched:boolean;classification:Classification;evidence:string[]}
export interface TopologyGraph {nodes:TopologyNode[];edges:TopologyEdge[];routes:RouteCandidate[];findings:Finding[];warnings:string[];diagnostics:{geometryCount:number;segments:number;suppressed:number;pairChecks:number;tolerances:{exact:number;port:number;gap:number;angleDeg:number};timings:{graph:number;intersections:number;ports:number;tracing:number;preview:number;total:number}}}
export interface GraphDecisions {junctions?:Record<string,boolean>;crossings?:Record<string,'connected'|'crossing'>;gaps?:Record<string,boolean>}
export interface RouteReview {status:'confirmed'|'rejected'|'unresolved';start?:ConnectorEndpoint;end?:ConnectorEndpoint}
export interface Review {routes:Record<string,RouteReview>;graph:GraphDecisions}
export interface TopologyProvenance {source:'topology-reconstruction';sourceGeometryIds:string[];sourceImageRunId?:string;resolution:'user-confirmed'}
export interface AnalysisRequest {libraries?:import('../symbols/types').SymbolLibrary[];document:GeoDocument;scope:Scope;decisions:GraphDecisions}
