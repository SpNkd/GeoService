type IconName = 'cursor' | 'hand' | 'fit' | 'grid' | 'eye' | 'eye-off' | 'lock' | 'unlock' | 'layers' | 'point' | 'polygon' | 'line' | 'text' | 'crosshair' | 'plus' | 'minus';
const paths: Record<IconName, string> = {
  cursor: 'M4 3l6 17 3-7 7-3L4 3z',
  hand: 'M8 12V6a2 2 0 014 0v5-7a2 2 0 014 0v7-5a2 2 0 014 0v8c0 5-3 8-7 8-3 0-5-2-7-5l-3-4a2 2 0 013-2l2 2',
  fit: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M8 8h8v8H8z',
  grid: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  'eye-off': 'M3 3l18 18M9 5c7-2 13 7 13 7s-2 4-5 5M6 6C3 8 2 12 2 12s4 7 10 7c1 0 3 0 4-1',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 018 0v4',
  unlock: 'M6 10h12v11H6zM8 10V6a4 4 0 018 0',
  layers: 'M12 3L2 8l10 5 10-5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5',
  point: 'M12 3v6m0 6v6M3 12h6m6 0h6M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  polygon: 'M5 5l14 2-3 13L3 16 5 5z',
  line: 'M4 18L20 6M2 16h4v4H2zM18 4h4v4h-4z',
  text: 'M4 5h16M12 5v15M8 20h8',
  crosshair: 'M12 2v4m0 12v4M2 12h4m12 0h4M18 12a6 6 0 11-12 0 6 6 0 0112 0z',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
