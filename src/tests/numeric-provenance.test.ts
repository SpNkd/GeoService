import { expect,it } from 'vitest';
import { explicitNumericLiterals } from '../ai/numericLiterals';
import { validateParserResult } from '../ai/intent';
import { spatialConstraintsTask } from './fixtures/spatialConstraints';
it.each(['в трёх метрах от границы','не ближе трех метров от края','отступ три метра','на расстоянии тремя метрами'])('accepts explicit cardinal clearance: %s', phrase=>{
  expect(explicitNumericLiterals(phrase).has(3)).toBe(true);
  expect(()=>validateParserResult(spatialConstraintsTask,`Участок 20 на 30 м, Дом 5 на 6 м и Кран. Труба по границе, ${phrase}, размеры Дома.`)).not.toThrow();
});
it('compound numbers do not authorize their components; unknown and fractional words are not guessed',()=>{
 expect([...explicitNumericLiterals('тридцать три метра')]).toEqual([33]);
 expect(explicitNumericLiterals('тридцать три метра').has(3)).toBe(false);
 expect(explicitNumericLiterals('размер не указан').size).toBe(0);
 expect(explicitNumericLiterals('3,5 м и 5.25 м')).toEqual(new Set([3.5,5.25]));
});
it('cardinal distances never authorize LLM-invented XY',()=>{
 expect(()=>validateParserResult({actions:[{type:'create_points',points:[{name:'Кран',x:17,y:3}]}]},'Поставь Кран в трех метрах от границы')).toThrow();
 expect(()=>validateParserResult(spatialConstraintsTask,'Участок 20 на 30 м, Дом 5 на 6 м и Кран. Труба по границе. Отступ не указан.')).toThrow();
});
