export type ShortcutGroup = 'Tools' | 'Navigation' | 'File' | 'Edit';
export interface ShortcutEntry { id: string; sequence: string[]; label: string; description: string; group: ShortcutGroup; modifier?: 'primary' }
export const shortcutRegistry: ShortcutEntry[] = [
  { id: 'select', sequence: ['V'], label: 'V', description: 'Select', group: 'Tools' },
  { id: 'line', sequence: ['L'], label: 'L', description: 'Line', group: 'Tools' },
  { id: 'point', sequence: ['P', 'O'], label: 'PO', description: 'Point', group: 'Tools' },
  { id: 'polyline', sequence: ['P', 'L'], label: 'PL', description: 'Polyline', group: 'Tools' },
  { id: 'polygon', sequence: ['P', 'O', 'L'], label: 'POL', description: 'Polygon', group: 'Tools' },
  { id: 'text', sequence: ['T'], label: 'T', description: 'Text', group: 'Tools' },
  { id: 'dimension', sequence: ['D', 'I', 'M'], label: 'DIM', description: 'Dimension', group: 'Tools' },
  { id: 'measure', sequence: ['D', 'I'], label: 'DI', description: 'Measure', group: 'Tools' },
  { id: 'fit', sequence: ['F'], label: 'F / ZE', description: 'Fit to content', group: 'Navigation' },
  { id: 'fit-extents', sequence: ['Z', 'E'], label: 'ZE', description: 'Zoom extents', group: 'Navigation' },
  { id: 'pan', sequence: ['SPACE+DRAG'], label: 'Space + drag', description: 'Pan (hold Space while dragging)', group: 'Navigation' },
  { id: 'save', sequence: ['S'], label: 'Ctrl/Cmd+S', description: 'Save JSON', group: 'File', modifier: 'primary' },
  { id: 'open', sequence: ['O'], label: 'Ctrl/Cmd+O', description: 'Open JSON', group: 'File', modifier: 'primary' },
  { id: 'new', sequence: ['N'], label: 'Ctrl/Cmd+N', description: 'New document', group: 'File', modifier: 'primary' },
  { id: 'undo', sequence: ['Z'], label: 'Ctrl/Cmd+Z', description: 'Undo', group: 'Edit', modifier: 'primary' },
  { id: 'redo', sequence: ['Z'], label: 'Ctrl/Cmd+Shift+Z', description: 'Redo', group: 'Edit', modifier: 'primary' },
  { id: 'redo-y', sequence: ['Y'], label: 'Ctrl/Cmd+Y', description: 'Redo', group: 'Edit', modifier: 'primary' },
  { id: 'delete', sequence: ['DELETE'], label: 'Delete / Backspace', description: 'Delete selection', group: 'Edit' },
  { id: 'cancel', sequence: ['ESC'], label: 'Esc', description: 'Cancel / Select', group: 'Tools' },
  { id: 'help', sequence: ['?'], label: '?', description: 'Keyboard shortcuts', group: 'Navigation' },
];

export function shortcutMatchesPrefix(buffer: readonly string[]): boolean {
  return shortcutRegistry.some(entry => entry.sequence.length >= buffer.length && buffer.every((key, index) => entry.sequence[index] === key));
}
export function resolveShortcut(buffer: readonly string[]): ShortcutEntry | null {
  return shortcutRegistry.find(entry => entry.sequence.length === buffer.length && entry.sequence.every((key, index) => buffer[index] === key)) ?? null;
}
export function shortcutNeedsWait(buffer: readonly string[]): boolean {
  return shortcutRegistry.some(entry => entry.sequence.length > buffer.length && buffer.every((key, index) => entry.sequence[index] === key));
}
