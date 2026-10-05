import type { SymbolLibrary } from './types';
import { symbolLibrarySchema } from './schema';
import { gasProcessDemo } from './gasProcessDemo';
const libraries=new Map<string,SymbolLibrary>();
function freeze<T>(value:T):T { if(value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
/** Strict, owned, immutable definitions. Registration is atomic; no renderer-specific library knowledge. */
export function registerSymbolLibrary(raw:SymbolLibrary):void {
  const parsed=symbolLibrarySchema.safeParse(raw);
  if(!parsed.success) throw new Error(`Неверная библиотека: ${parsed.error.issues[0]!.message}`);
  const library=parsed.data as SymbolLibrary;
  if(libraries.has(library.id)) throw new Error(`Библиотека ${library.id} уже зарегистрирована`);
  if(new Set(library.categories).size!==library.categories.length) throw new Error('Повторяющиеся категории');
  const ids=new Set<string>();
  for(const symbol of library.symbols) {
    if(ids.has(symbol.id)) throw new Error(`Повторяющийся символ ${symbol.id}`);
    ids.add(symbol.id);
    if(!library.categories.includes(symbol.category)) throw new Error('Категория символа отсутствует');
    if(new Set(symbol.ports.map(port=>port.id)).size!==symbol.ports.length) throw new Error('Повторяющиеся порты');
  }
  libraries.set(library.id,freeze(library));
}
export const getLibrary=(libraryId:string)=>libraries.get(libraryId);
export const getSymbol=(libraryId:string,symbolId:string)=>getLibrary(libraryId)?.symbols.find(symbol=>symbol.id===symbolId);
export const listLibraries=()=>[...libraries.values()];
export function requireSymbol(libraryId:string,symbolId:string) {
  const symbol=getSymbol(libraryId,symbolId);
  if(!symbol) throw new Error(`Неизвестное обозначение: библиотека «${libraryId}», символ «${symbolId}». Подключите соответствующую библиотеку.`);
  return symbol;
}
registerSymbolLibrary(gasProcessDemo);
