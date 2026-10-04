/** Formatting is a view operation. Never write these strings back into the document. */
export const DISPLAY_PRECISION = { distance: 3, height: 3, azimuth: 3 };
export function formatDistance(value: number): string { return `${formatMeasure(value, DISPLAY_PRECISION.distance)} м`; }
export function formatAzimuth(value: number | null): string { return value === null ? '—' : `${formatMeasure(value, DISPLAY_PRECISION.azimuth)}°`; }
export function formatHeight(value: number): string { return value.toFixed(DISPLAY_PRECISION.height); }
export function formatCoordinate(value: number): string { return value.toFixed(3); }
export function formatMeasure(value: number, decimals = 2): string {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}
