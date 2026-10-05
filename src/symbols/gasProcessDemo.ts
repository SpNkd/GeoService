import type { SymbolLibrary, SymbolPrimitive, SymbolPort } from './types';
const p=(x:number,y:number)=>({x,y});
const line=(x:number,y:number,X:number,Y:number):SymbolPrimitive=>({type:'line',start:p(x,y),end:p(X,Y)});
const polygon=(points:number[][]):SymbolPrimitive=>({type:'polygon',points:points.map(([x,y])=>p(x!,y!))});
const circle=(x=0,y=0,r=.35):SymbolPrimitive=>({type:'circle',center:p(x,y),radius:r});
const rect=(x=-.35,y=-.3,width=.7,height=.6):SymbolPrimitive=>({type:'rect',position:p(x,y),width,height});
const ports:SymbolPort[]=[{id:'in',kind:'process',position:p(-.5,0),directionDeg:180},{id:'out',kind:'process',position:p(.5,0),directionDeg:0}];
const valve=[polygon([[-.5,-.25],[-.5,.25],[.5,-.25],[.5,.25]])];
const equipment=[line(-.5,0,-.35,0),rect(),line(.35,0,.5,0)];
const categories=['Арматура','Оборудование','КИП','Трубопровод / вспомогательные'];
const seeds: [string,string,number,SymbolPrimitive[],string[]][]=[
    ['shutoff-valve','Запорный кран',0,valve,['кран','запорная арматура']],
    ['valve','Клапан',0,[...valve,line(0,0,0,.45),line(-.2,.45,.2,.45)],['вентиль']],
    ['pressure-regulator','Регулятор давления',0,[...valve,circle(0,.45,.16),line(0,0,0,.29)],['РД','редуктор давления']],
    ['check-valve','Обратный клапан',0,[polygon([[-.5,-.25],[-.5,.25],[.35,0]]),line(.35,-.3,.35,.3)],['обратный']],
    ['safety-valve','Предохранительный клапан',0,[...valve,line(0,0,0,.4),line(-.15,.25,.15,.35),line(.15,.35,-.15,.45)],['ПСК','сбросной']],
    ['filter','Фильтр',1,[...equipment,line(-.3,-.25,.3,.25),line(-.3,0,0,.25),line(0,-.25,.3,0)],['Ф','очистка']],
    ['gas-meter','Счётчик газа',1,[...equipment,circle(0,0,.2),line(0,0,.12,.12)],['счетчик','расходомер']],
    ['equipment-block','Блок оборудования',1,equipment,['оборудование','блок']],
    ['cabinet','Шкаф',1,[rect(-.4,-.5,.8,1),line(0,-.5,0,.5),line(.1,-.05,.1,.05)],['ШРП','ГРПШ']],
    ['heat-exchanger','Подогреватель газа',1,[...equipment,{type:'polyline',points:[p(-.25,0),p(-.1,.2),p(.1,-.2),p(.25,0)]}],['теплообменник']],
    ['pressure-gauge','Манометр',2,[circle(),line(0,0,.2,.2),line(0,-.5,0,-.35)],['давление','PI']],
    ['instrument-point','Точка КИП',2,[circle(0,0,.25),line(-.25,0,.25,0)],['прибор','КИП']],
    ['temperature-gauge','Термометр',2,[circle(),line(0,-.2,0,.2),circle(0,-.2,.05)],['температура','TI']],
    ['vent','Свеча / vent',3,[line(0,-.5,0,.4),line(-.2,.4,.2,.4),line(-.2,.4,-.1,.5),line(.2,.4,.1,.5)],['свеча','продувка']],
    ['flow-direction','Направление потока',3,[line(-.5,0,.5,0),line(.5,0,.2,.2),line(.5,0,.2,-.2)],['стрелка','flow']],
    ['cap','Заглушка',3,[line(-.5,0,0,0),line(0,-.3,0,.3)],['глухой конец']],
    ['reducer','Переход',3,[polygon([[-.5,-.3],[-.5,.3],[.5,.15],[.5,-.15]])],['редукция','reducer']],
    ['tee','Тройник',3,[line(-.5,0,.5,0),line(0,0,0,.5)],['ответвление','tee']],
];
export const gasProcessDemo:SymbolLibrary={id:'gas-process-demo',name:'Газоснабжение / технологическая схема',version:'1.0.0',
  description:'Demo / базовая библиотека газовой технологической схемы. Нормативное соответствие ГОСТ/СПДС не подтверждено.',categories,
  symbols:seeds.map(([id,name,category,geometry,aliases])=>({id,name,category:categories[category]!,geometry,aliases,defaultSize:2,
    ports: ['pressure-gauge','instrument-point','temperature-gauge'].includes(id) ? [{id:'sense',kind:'instrument',position:p(0,-.5),directionDeg:270}] : id==='tee' ? [...ports,{id:'branch',kind:'process',position:p(0,.5),directionDeg:90}] : id==='vent' ? [{id:'in',kind:'process',position:p(0,-.5),directionDeg:270}] : id==='cap' ? [ports[0]!] : ports,
  })),
};
