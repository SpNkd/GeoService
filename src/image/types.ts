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
  source: 'image-vectorization'; sourceAssetId: string; vectorizationRunId: string;
  candidateType: Candidate['type']; confidence?: number;
}
interface CandidateBase { id: string; confidence?: number }
export type GeometryCandidate = CandidateBase & (
  { type: 'line' | 'polyline' | 'contour'; points: PixelPoint[] } |
  { type: 'circle'; center: PixelPoint; radius: number }
);
/** Extension hooks only: V1 never invents OCR text or confirmed library matches. */
export type RegionCandidate = CandidateBase & { type: 'text' | 'symbol'; bounds: { x: number; y: number; width: number; height: number }; recognizedText?: string; proposedSymbol?: { libraryId: string; symbolId: string; confirmed: boolean } };
export type Candidate = GeometryCandidate | RegionCandidate;
export interface ExtractionOptions { detail: 'low' | 'medium' | 'high'; noise: 'low' | 'medium' | 'high'; join: boolean }
export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }
export const ANALYSIS_EDGE = 1200;
export const CANDIDATE_LIMIT = 5000;
export const DEFAULT_EXTRACTION: ExtractionOptions = { detail: 'medium', noise: 'medium', join: true };
export interface ExtractionResult { candidates: Candidate[]; timings: { detection: number; cleanup: number }; analysisWidth: number; analysisHeight: number }
