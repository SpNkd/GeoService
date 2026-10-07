import type { AiTaskIntent } from '../../ai/intent';
export const ORIGINAL_SPATIAL_REQUEST='нарисуй участок (20 на 30 метров), на нём на северо-западе дом\n(5 на 6 метров), на юго востоке - газовый кран, от него труба\nпо границе участка до дома. Все сооружения должны быть отдалены\nот границ участка на 3 метра. Проставь размеры на доме';
export const spatialConstraintsTask:AiTaskIntent={actions:[
  {type:'create_rectangle',name:'Участок',width:20,height:30,placement:{type:'local_origin'}},
  {type:'create_rectangle',name:'Дом',width:5,height:6,placement:{type:'inside_boundary',reference:{kind:'action',actionIndex:0,result:'boundary'},anchor:'north_west',inset:{north:3,south:3,east:3,west:3},minimumClearance:3,offsetAlongSide:null}},
  {type:'create_spatial_point',name:'Кран',placement:{type:'inside_boundary',reference:{kind:'action',actionIndex:0,result:'boundary'},anchor:'south_east',inset:{north:3,south:3,east:3,west:3},minimumClearance:3,offsetAlongSide:null}},
  {type:'create_route',name:'Труба',source:{kind:'action',actionIndex:2,result:'point'},target:{kind:'action',actionIndex:1,result:'object'},boundary:{kind:'action',actionIndex:0,result:'boundary'},mode:'FOLLOW_BOUNDARY',boundaryOffset:0},
  {type:'create_dimensions_for_boundary_edges',boundaryActionIndex:1},
]};
