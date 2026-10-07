import { ANALYSIS_EDGE, type ExtractionOptions, type ExtractionResult, type ImageCalibration, type ImageQuad, type PixelImage } from './types';
export function analysisSize(width: number, height: number, edge = ANALYSIS_EDGE) { const ratio = Math.min(1, edge / Math.max(width, height)); return { width: Math.max(2, Math.round(width * ratio)), height: Math.max(2, Math.round(height * ratio)) }; }
export function prepareImage(bitmap: ImageBitmap): PixelImage {
  const size = analysisSize(bitmap.width, bitmap.height), canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
  try { const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Canvas недоступен.'); ctx.drawImage(bitmap, 0, 0, size.width, size.height); const data = ctx.getImageData(0, 0, size.width, size.height).data; return { ...size, data }; }
  finally { canvas.width = canvas.height = 0; }
}
export interface WorkerResult { image: PixelImage; rectification?: number; result?: ExtractionResult & { timings: ExtractionResult['timings'] & { rectification: number; preview: number } } }
/** Each job owns one worker and a transferred copy. Termination cancels CPU work immediately. */
export function processImage(source: PixelImage, sourceSize: { width: number; height: number }, calibration: ImageCalibration, options: ExtractionOptions | undefined, signal: AbortSignal, stage: (value: string) => void = () => {}): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Отменено', 'AbortError')); return; }
    let worker: Worker; try { worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); } catch { reject(new Error('Локальная обработка требует Web Worker. Обновите браузер.')); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { finish(); reject(new DOMException('Отменено', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(new Error('Обработка заняла более 60 секунд. Уменьшите область или детализацию.')); }, 60000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => { finish(); reject(new Error('Рабочий процесс завершился с ошибкой. Попробуйте меньшую область.')); };
    worker.onmessageerror = () => { finish(); reject(new Error('Не удалось получить результат рабочего процесса.')); };
    worker.onmessage = ({ data }: MessageEvent<WorkerResult & { stage?: string; error?: string }>) => {
      if (data.stage) { stage(data.stage); return; } finish(); if (data.error) reject(new Error(data.error)); else resolve(data);
    };
    try { const image = { ...source, data: source.data.slice() }, quad = calibration.quad.map(p => ({ x: p.x * source.width / sourceSize.width, y: p.y * source.height / sourceSize.height })) as ImageQuad, size = analysisSize(calibration.rectifiedWidth, calibration.rectifiedHeight);
    worker.postMessage({ image, quad, ...size, logicalWidth: calibration.rectifiedWidth, logicalHeight: calibration.rectifiedHeight, ...(options ? { options } : {}) }, [image.data.buffer]); }
    catch { finish(); reject(new Error('Недостаточно памяти для локальной обработки.')); }
  });
}
