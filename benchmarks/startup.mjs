import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const urls=(process.env.STARTUP_URLS??'https://spnkd.github.io/GeoService/,https://spnkd.gitverse.site/geoservice/').split(',');
const browser=await chromium.launch({channel:'chrome'}),results=[];
try{for(const url of urls)for(let run=0;run<3;run++){
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[],missing=[];
 page.on('pageerror',()=>errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)missing.push(new URL(r.url()).pathname);});
 const start=performance.now();await page.goto(url);await page.getByTestId('drawing-canvas').waitFor();await page.getByTestId('persistence-status').filter({hasText:'Сохранено локально'}).waitFor();
 const editableMs=performance.now()-start,resources=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(n=>({domContentLoaded:n.domContentLoadedEventEnd,responseEnd:n.responseEnd,transferSize:n.transferSize,encodedBodySize:n.encodedBodySize})),resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,duration:r.duration,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize}))}));
 const eagerHeavy=resources.resources.filter(r=>/ocr\/|pdf\.worker|recognition\.worker|ImageVectorizationDialog|TopologyDialog|SemanticLearningDialog|SettingsCenter/.test(r.path));
 results.push({url,run,editableMs,...resources,eagerHeavy,errors,missing});await context.close();if(errors.length||missing.length||eagerHeavy.length)throw Error('Startup regression');
}await writeFile(process.env.STARTUP_REPORT??'docs/audit-results/release-startup.json',JSON.stringify({method:'Three isolated Chrome contexts per origin; network and OS caches may be warm. Usable editor includes successful IndexedDB hydration/initial save, not only DOMContentLoaded. Network variability is not CPU benchmarking.',results},null,2)+'\n');console.log(JSON.stringify(results.map(r=>({url:r.url,run:r.run,editableMs:r.editableMs,eagerHeavy:r.eagerHeavy.length,errors:r.errors.length}))));}finally{await browser.close();}
