/** Formatting is a view operation. Never write these strings back into the document. */
export function formatCoordinate(value: number): string { return value.toFixed(3); }
export function formatMeasure(value: number, decimals = 2): string {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}
