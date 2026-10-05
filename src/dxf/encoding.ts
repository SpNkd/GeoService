export type DxfEncoding = 'auto' | 'utf-8' | 'windows-1251';
export function decodeDxf(buffer:ArrayBuffer,choice:DxfEncoding='auto') {
  if(buffer.byteLength>32*1024*1024)throw new Error('DXF превышает лимит 32 МБ');
  const bytes=new Uint8Array(buffer);const ascii=new TextDecoder('latin1').decode(bytes.subarray(0,65536));
  if(ascii.startsWith('AutoCAD Binary DXF'))throw new Error('Binary DXF не поддерживается; сохраните ASCII DXF');
  const codepage=ascii.match(/\$DWGCODEPAGE\s+\d+\s+([^\r\n]+)/)?.[1]?.trim()??'',warnings:string[]=[];
  let encoding:Exclude<DxfEncoding,'auto'>,requiresEncodingChoice=false;
  let utf:string|undefined;try{utf=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{ /* legacy codepage */ }
  if(choice!=='auto')encoding=choice;
  else if(utf!==undefined){encoding='utf-8';if(/1251/i.test(codepage)&&bytes.some(b=>b>=128))warnings.push('Заголовок ANSI_1251, но байты — корректный UTF-8; используется UTF-8.');}
  else if(/^(?:ansi_|windows-)?1251$/i.test(codepage))encoding='windows-1251';
  else {encoding='windows-1251';requiresEncodingChoice=true;warnings.push(`Неизвестная кодировка «${codepage||'не указана'}»: подтвердите UTF-8 или Windows-1251.`);}
  const text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
  return {text,encoding,codepage,warnings,requiresEncodingChoice};
}
