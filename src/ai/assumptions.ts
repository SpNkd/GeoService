import type { LayoutAnchor } from '../geometry/autoPlacement';
export type LayoutAssumption =
  | { type: 'local_origin'; objectName: string }
  | { type: 'relative_placement'; objectName: string; parentName: string; anchor: LayoutAnchor }
  | { type: 'auto_layout_inset'; objectName: string; anchor: Exclude<LayoutAnchor, 'center'>; nominal: number; x: number; y: number }
  | { type: 'sketch_layout' }
  | { type: 'spatial'; message: string };
export const anchorLabels: Record<LayoutAnchor, string> = { center: 'центральной', north: 'северной', south: 'южной', east: 'восточной', west: 'западной',
  north_east: 'северо-восточной', north_west: 'северо-западной', south_east: 'юго-восточной', south_west: 'юго-западной' };
const metres = (value: number) => Number.isInteger(value * 10) ? value.toFixed(1) : String(value);
export function formatAssumption(value: LayoutAssumption): string {
  if (value.type === 'spatial') return value.message;
  if (value.type === 'local_origin') return `${value.objectName} создан в локальных координатах от (0,0). Это не геодезическая привязка.`;
  if (value.type === 'sketch_layout') return 'Автоотступ является эскизным и не является нормативным расстоянием. Направления заданы в локальных осях MODEL: север +Y, восток +X.';
  if (value.type === 'relative_placement') return `${value.objectName} размещён в ${anchorLabels[value.anchor]} части «${value.parentName}».${['north', 'south'].includes(value.anchor) ? ' По горизонтали объект центрирован.' : ['east', 'west'].includes(value.anchor) ? ' По вертикали объект центрирован.' : ''}`;
  const sides: string[] = [];
  if (value.anchor.includes('north') || value.anchor.includes('south')) sides.push(`от ${value.anchor.includes('north') ? 'северной' : 'южной'} границы: ${metres(value.y)} м`);
  if (value.anchor.includes('east') || value.anchor.includes('west')) sides.push(`от ${value.anchor.includes('east') ? 'восточной' : 'западной'} границы: ${metres(value.x)} м`);
  const reduced = (value.anchor.includes('east') || value.anchor.includes('west')) && value.x < value.nominal || (value.anchor.includes('north') || value.anchor.includes('south')) && value.y < value.nominal;
  return `${value.objectName}: автоматический эскизный отступ ${sides.join('; ')}.${reduced ? ` Уменьшен с ${metres(value.nominal)} м, чтобы сохранить размеры объекта внутри участка.` : ''}`;
}
