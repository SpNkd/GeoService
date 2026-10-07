import { extractGeometry, scaleCandidates } from './extract';
import { rectifyImage } from './transform';
import type { ExtractionOptions, ImageQuad, PixelImage } from './types';
interface Request { image: PixelImage; quad: ImageQuad; width: number; height: number; logicalWidth: number; logicalHeight: number; options?: ExtractionOptions }
const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
scope.onmessage = ({ data: request }) => {
  try {
    scope.postMessage({ stage: 'Коррекция перспективы' }); const start = performance.now();
    const image = rectifyImage(request.image, request.quad, request.width, request.height), rectification = performance.now() - start;
    if (!request.options) { scope.postMessage({ image, rectification }, [image.data.buffer]); return; }
    const result = extractGeometry(image, request.options, stage => scope.postMessage({ stage }));
    scope.postMessage({ stage: 'Подготовка предпросмотра' });
    const previewStart = performance.now(), candidates = scaleCandidates(result.candidates, request.logicalWidth / image.width, request.logicalHeight / image.height);
    scope.postMessage({ result: { ...result, candidates, timings: { ...result.timings, rectification, preview: performance.now() - previewStart } }, image }, [image.data.buffer]);
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : 'Не удалось обработать изображение.' }); }
};
