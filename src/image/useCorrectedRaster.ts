import { useEffect, useState } from 'react';
import type { ImageCalibration } from './types';
import { prepareImage, processImage } from './client';
/** Derived bounded bitmap only. Original AssetRegistry ownership remains with useRasterAsset. */
export function useCorrectedRaster(bitmap: ImageBitmap | null, calibration: ImageCalibration | undefined) {
  const [value, setValue] = useState<{ source: ImageBitmap; calibration: ImageCalibration; bitmap: ImageBitmap; closed: boolean } | null>(null);
  useEffect(() => {
    if (!bitmap || !calibration) return;
    const controller = new AbortController(); let derived: ImageBitmap | null = null, owned: typeof value = null;
    void Promise.resolve().then(() => processImage(prepareImage(bitmap), bitmap, calibration, undefined, controller.signal)).then(async result => {
      derived = await createImageBitmap(new ImageData(new Uint8ClampedArray(result.image.data), result.image.width, result.image.height));
      if (controller.signal.aborted) { derived.close(); derived = null; return; }
      owned = { source: bitmap, calibration, bitmap: derived, closed: false };
      setValue(owned);
    }).catch(() => { /* A safe placeholder is preferable to displaying an uncorrected/misaligned source. */ });
    return () => { controller.abort(); if (owned) owned.closed = true; derived?.close(); };
  }, [bitmap, calibration]);
  return calibration ? value?.source === bitmap && value.calibration === calibration && !value.closed ? value.bitmap : null : bitmap;
}
