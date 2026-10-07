import { ORIGINAL_SPATIAL_REQUEST } from './spatialConstraints';
/** Public, synthetic regression requests. Expected values describe local geometry, not provider JSON. */
export const spatialParaphrases = [
  { id: 'golden', kind: 'golden', text: ORIGINAL_SPATIAL_REQUEST },
  ...[
    ['на северо-западе', 'на юго-востоке', 'отступ 3 метра', 'по границе'],
    ['в северо-западной части', 'в юго-восточной части', 'в трёх метрах от границы', 'вдоль границы'],
    ['в левом верхнем углу', 'справа снизу', 'не ближе трёх метров от края', 'по периметру'],
    ['сверху слева', 'в правом нижнем углу', 'оставь 3 м до границы', 'проведи вдоль края участка'],
  ].map(([nw,se,clearance,route], i) => ({ id: `corners-${i+1}`, kind: 'golden', text: `Нарисуй Участок 20 на 30 метров. Дом 5 на 6 метров ${nw} участка; Кран ${se} участка. Для Дома и Крана ${clearance}. Трубу от Крана до Дома ${route} участка. Проставь размеры всех сторон Дома.` })),
  ...['по центру','в центре участка','ровно посередине'].map((phrase,i) => ({id:`center-${i+1}`,kind:'center',text:`Создай Участок 20 на 30 метров и Дом 5 на 6 метров ${phrase}.`})),
  ...['на 5 м восточнее дома','на пять метров правее дома'].map((phrase,i) => ({id:`relative-${i+1}`,kind:'relative',text:`Создай Участок 20 на 30 метров, Дом 5 на 6 метров в центре участка и Кран ${phrase}.`})),
] as const;
