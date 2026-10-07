export interface PixelPoint { x: number; y: number }
/** Source pixel boundary coordinates, clockwise TL/TR/BR/BL. Never image bytes. */
export type ImageQuad = [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
export interface ImageCalibration {
  quad: ImageQuad;
  rectifiedWidth: number;
  rectifiedHeight: number;
  reference?: { a: PixelPoint; b: PixelPoint; distanceMeters: number };
}
export interface ImageProvenance {
  source: 'image-vectorization' | 'image-ocr' | 'image-symbol-match'; sourceAssetId: string; vectorizationRunId: string;
  candidateType: Candidate['type']; confidence?: number; originalText?:string; candidateGroupId?:string; libraryId?:string; symbolId?:string; matchClass?:'strong'|'possible';
}
interface CandidateBase { id: string; confidence?: number }
export type GeometryCandidate = CandidateBase & (
  { type: 'line' | 'polyline' | 'contour'; points: PixelPoint[] } |
  { type: 'circle'; center: PixelPoint; radius: number }
);
/** Transient review candidates; only explicitly confirmed results become entities. */
export type RegionCandidate = CandidateBase & { type: 'text' | 'symbol'; bounds: { x: number; y: number; width: number; height: number }; recognizedText?: string; originalText?:string; rotationDeg?:number; confirmed?:boolean; groupId?:string; semanticConceptId?:string; semanticConfirmed?:boolean; evidence?:string[]; proposedSymbol?: { libraryId: string; symbolId: string; confirmed: boolean; matchClass?:'strong'|'possible'; rotationDeg?:number; localWidth?:number; localCenter?:PixelPoint }|undefined };
export type Candidate = GeometryCandidate | RegionCandidate;
export interface ExtractionOptions { detail: 'low' | 'medium' | 'high'; noise: 'low' | 'medium' | 'high'; join: boolean; lighting?:'global'|'adaptive' }
export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }
export const ANALYSIS_EDGE = 1200;
export const CANDIDATE_LIMIT = 5000;
export const DEFAULT_EXTRACTION: ExtractionOptions = { detail: 'medium', noise: 'medium', join: true };
export interface ExtractionResult { candidates: Candidate[]; timings: { detection: number; textDetection?:number; cleanup: number }; analysisWidth: number; analysisHeight: number }
