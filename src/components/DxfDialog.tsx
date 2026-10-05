import { useEffect, useRef, useState } from 'react';
import type { DxfOptions, DxfPlan, TypeReport } from '../dxf/types';
import type { DxfEncoding } from '../dxf/encoding';
function Breakdown({rows}:{rows:Record<string,TypeReport>}) {return <table><thead><tr><th>DXF</th><th>Всего</th><th>Converted</th><th>Simplified</th><th>Proxy</th><th>Unsupported</th></tr></thead><tbody>{Object.entries(rows).map(([type,r])=><tr key={type}><td>{type}</td><td>{r.total}</td><td>{r.converted}</td><td>{r.simplified}</td><td>{r.proxy}</td><td>{r.unsupported}</td></tr>)}</tbody></table>;}
export function DxfDialog({onClose,onApply}:{onClose:()=>void;onApply:(plan:DxfPlan)=>void}) {
  const [file,setFile]=useState<File|null>(null),[options,setOptions]=useState<DxfOptions>({frame:'projected',encoding:'auto'}),[plan,setPlan]=useState<DxfPlan|null>(null),[error,setError]=useState(''),[phase,setPhase]=useState(''),worker=useRef<Worker|null>(null),request=useRef(0),completedOptions=useRef<DxfOptions|null>(null);
  useEffect(()=>{
    const id=++request.current;if(!file)return;let active=true;setPlan(null);setError('');setPhase('Чтение файла');
    const w=new Worker(new URL('../dxf/worker.ts',import.meta.url),{type:'module'});worker.current=w;
    w.onmessage=(e:MessageEvent<{phase?:string;plan?:DxfPlan;error?:string}>)=>{if(!active||id!==request.current)return;if(e.data.phase)setPhase(e.data.phase);if(e.data.plan){completedOptions.current=options;setPlan(e.data.plan);setPhase('');}if(e.data.error){setError(e.data.error);setPhase('');}};
    w.onerror=()=>{if(active){setError('DXF Worker failed');setPhase('');}};
    void(async()=>{try{if(file.size>32*1024*1024)throw new Error('DXF превышает лимит 32 МБ');const buffer=await file.arrayBuffer();if(active)w.postMessage({buffer,filename:file.name,options},[buffer]);}catch(e){if(active){setError(e instanceof Error?e.message:'Ошибка чтения');setPhase('');}}})();
    return()=>{active=false;w.terminate();worker.current=null;};
  },[file,options]);
  const totals=Object.values(plan?.report.types??{}).reduce((a,r)=>({converted:a.converted+r.converted,simplified:a.simplified+r.simplified,proxy:a.proxy+r.proxy,unsupported:a.unsupported+r.unsupported}),{converted:0,simplified:0,proxy:0,unsupported:0});
  const report=plan?.report,canApply=!!plan&&completedOptions.current===options&&!phase&&!report?.requiresUnitsChoice&&!report?.requiresEncodingChoice;
  return <div className="modal-backdrop" role="presentation"><section className="dxf-dialog" role="dialog" aria-modal="true" aria-labelledby="dxf-title" data-shortcut-suppressed="true"><h2 id="dxf-title">Открыть DXF</h2><p>Файл обрабатывается в этом браузере и открывается как новый документ.</p>
    <label>Файл DXF<input type="file" accept=".dxf" aria-label="Файл DXF" onChange={e=>{setFile(e.target.files?.[0]??null);}} /></label>
    <div className="dxf-options"><label>Кодировка<select aria-label="Кодировка DXF" value={options.encoding} onChange={e=>setOptions({...options,encoding:e.target.value as DxfEncoding})}><option value="auto">Auto · header + UTF-8 validation</option><option value="utf-8">UTF-8</option><option value="windows-1251">Windows-1251</option></select></label>
    <label>Исходные единицы<select aria-label="Единицы DXF" value={options.units??''} onChange={e=>{const units=e.target.value as 'mm'|'cm'|'m'|'';const next={...options};if(units)next.units=units;else delete next.units;setOptions(next);}}><option value="">INSUNITS</option><option value="mm">Миллиметры</option><option value="cm">Сантиметры</option><option value="m">Метры</option></select></label>
    <label>Координаты<select aria-label="Система DXF" value={options.frame} onChange={e=>setOptions({...options,frame:e.target.value as 'local'|'projected'})}><option value="projected">Projected / Survey · direct E=X, N=Y</option><option value="local">Local · без привязки</option></select></label></div>
    {phase&&<p role="status">{phase}…</p>}{error&&<p role="alert">{error}</p>}
    {report&&<div data-testid="dxf-report"><dl className="dxf-summary"><dt>File</dt><dd>{report.filename}</dd><dt>Version</dt><dd>{report.version}</dd><dt>Encoding</dt><dd>{report.encoding} · declared {report.declaredCodepage||'unknown'}</dd><dt>Units / factor to metres</dt><dd>{report.originalUnits===6?'meters':`INSUNITS ${report.originalUnits}`} · ×{report.factor}</dd><dt>Layers</dt><dd>{report.layerCount}</dd><dt>Model Space</dt><dd>{report.modelSpaceCount}</dd><dt>Blocks / instances</dt><dd>{report.blockCount} / {report.blockInstances}</dd><dt>Converted / simplified / proxy / unsupported</dt><dd>{totals.converted} / {totals.simplified} / {totals.proxy} / {totals.unsupported}</dd><dt>Paper Space skipped</dt><dd>{report.paperSpaceCount}</dd></dl>
      {report.requiresUnitsChoice&&<p role="alert">Выберите исходные единицы; координаты не будут угадываться.</p>}{report.requiresEncodingChoice&&<p role="alert">Подтвердите кодировку перед открытием.</p>}
      <details open><summary>Отчёт по типам Model Space</summary><Breakdown rows={report.types}/></details><details><summary>Геометрия внутри definitions</summary><Breakdown rows={report.blockTypes}/></details><details><summary>Предупреждения ({report.warnings.length})</summary><ul>{report.warnings.map(w=><li key={w}>{w}</li>)}</ul></details><details><summary>Время обработки</summary><p>{Object.entries(report.timings).map(([phase,ms])=>`${phase}: ${ms.toFixed(1)} ms`).join(' · ')}</p><p>Normalized primitives: {report.normalizedPrimitives}</p></details>
    </div>}
    <div className="dialog-actions"><button onClick={onClose}>Отмена</button><button disabled={!canApply} onClick={()=>{if(plan)onApply(plan);}}>Открыть как новый документ</button></div>
  </section></div>;
}
