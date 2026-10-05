import type { GeoDocument } from '../domain/model';
import type { PrimitiveStyle } from '../vectors/types';

export interface Paint { stroke: string; lineWeight: number; dash: string | undefined }
export function createVectorStyleResolver(document: GeoDocument) {
  const layers = new Map(document.layers.map(l => [l.id, l]));
  const styles = new Map(document.styles.map(s => [s.id, s]));
  return (p: PrimitiveStyle, parent: Paint, inheritAll = false): Paint & { visible: boolean } => {
    const layer = layers.get(p.layerId), style = styles.get(layer?.styleId ?? '');
    const inherit = inheritAll || layer?.name === '0';
    return {
      visible: p.visible !== false && (inherit || layer?.visible === true),
      stroke: p.colorMode === 'explicit' ? p.stroke ?? parent.stroke : p.colorMode === 'byblock' || inherit ? parent.stroke : style?.stroke ?? parent.stroke,
      lineWeight: p.lineWeight ?? (inherit ? parent.lineWeight : style?.lineWeight ?? parent.lineWeight),
      dash: p.dash ?? (inherit ? parent.dash : style?.dash ?? parent.dash),
    };
  };
}
