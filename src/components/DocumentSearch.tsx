import { useEffect, useMemo, useState, type Dispatch } from 'react';
import type { GeoDocument } from '../domain/model';
import type { ApplicationAction } from '../ai/workflow';
import type { ViewSize } from '../geometry';
import { documentQueryIndex, searchDocument } from '../documentOperations/query';
export function DocumentSearch({document,dispatch,size,transactionActive}:{document:GeoDocument;dispatch:Dispatch<ApplicationAction>;size:ViewSize;transactionActive:boolean}) {
  const [text,setText]=useState(''),[debounced,setDebounced]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>setDebounced(text),180);return ()=>clearTimeout(timer);},[text]);
  // Build once per immutable revision, not by traversing nested blocks at each keystroke.
  useMemo(()=>documentQueryIndex(document),[document]);
  const results=useMemo(()=>searchDocument(document,debounced),[document,debounced]);
  return <details className="document-search" open><summary>Поиск в документе</summary>
    <label>Локальный поиск<input aria-label="Поиск в документе" value={text} maxLength={128} onChange={e=>setText(e.target.value)} placeholder="Слой, блок, текст, ATTRIB…"/></label><small>Локально, без LLM · {results.total} объектов</small>
    <div className="search-results">{results.rows.map(row=><div className="query-result" key={row.entityId}>
      <button type="button" disabled={transactionActive} onClick={()=>dispatch({type:'select-entities',entityIds:[row.entityId]})}>{row.matches[0]?.text??row.name}</button><small>{row.entityType} · {row.layer} · DXF: {row.sourceLayer||'—'}</small>
      {row.matches.map((m,i)=><small key={i}>{m.tag??''} {m.path.join(' → ')}</small>)}
      <button type="button" disabled={transactionActive} onClick={()=>dispatch({type:'fit-entities',entityIds:[row.entityId],size})}>Fit</button>
    </div>)}</div>{results.total>results.rows.length&&<small>Показаны первые {results.rows.length}. Уточните поиск.</small>}
  </details>;
}
