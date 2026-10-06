/** Internal demo concepts, never a claim of engineering/standards compliance. */
export const PROCESS_CONCEPTS = {
  input:{definition:'equipment-block',label:'Вход',prefix:'ВХ',aliases:['вход','input']},
  output:{definition:'equipment-block',label:'Выход',prefix:'ВЫХ',aliases:['выход','output']},
  shutoff_valve:{definition:'shutoff-valve',label:'Запорный кран',prefix:'К',aliases:['кран','запорный кран','клапан запорный','запорный клапан']},
  valve:{definition:null,label:'Клапан (уточните тип)',prefix:'К',aliases:['клапан']},
  filter:{definition:'filter',label:'Фильтр',prefix:'Ф',aliases:['фильтр']},
  pressure_regulator:{definition:'pressure-regulator',label:'Регулятор давления',prefix:'РД',aliases:['регулятор','регулятор давления','РД']},
  gas_meter:{definition:'gas-meter',label:'Счётчик газа',prefix:'СГ',aliases:['счётчик','счетчик','счётчик газа','счетчик газа']},
  safety_valve:{definition:'safety-valve',label:'Предохранительный клапан',prefix:'ПК',aliases:['предохранительный клапан','ПСК']},
  instrument:{definition:'instrument-point',label:'Точка КИП',prefix:'КИП',aliases:['прибор','КИП']},
  generic_equipment:{definition:'equipment-block',label:'Блок оборудования',prefix:'ОБ',aliases:['оборудование','блок оборудования']},
} as const;
export type ProcessKind=keyof typeof PROCESS_CONCEPTS;
export const PROCESS_KINDS=Object.keys(PROCESS_CONCEPTS) as [ProcessKind,...ProcessKind[]];
export const PROCESS_LIBRARY='gas-process-demo';
export const VALVE_CHOICES=['shutoff-valve','valve','check-valve','safety-valve'] as const;
export const normalizeProcessName=(s:string)=>s.trim().toLocaleLowerCase().replaceAll('ё','е');
export function processKindForAlias(alias:string):ProcessKind|undefined {return PROCESS_KINDS.find(k=>PROCESS_CONCEPTS[k].aliases.some(a=>normalizeProcessName(a)===normalizeProcessName(alias)));}
/** Semantic vocabulary only: no library/definition/port IDs or document catalog. */
export const PROCESS_VOCABULARY=PROCESS_KINDS.map(k=>`${k}: ${PROCESS_CONCEPTS[k].aliases.join(', ')}`).join('; ');
