import type {Plugin} from 'vite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
/** Pinned npm runtimes are served locally and emitted verbatim; never a browser CDN fallback. */
export function localOcrAssets():Plugin{
 const js=dirname(require.resolve('tesseract.js/package.json')),core=dirname(require.resolve('tesseract.js-core/package.json'));
 let base='/';
 const paths=new Map<string,string>([['worker.min.js',join(js,'dist/worker.min.js')],...['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js'].map(n=>[n,join(core,n)] as [string,string])]);
 return {name:'local-ocr-assets',configResolved(config){base=config.base;},configureServer(server){server.middlewares.use((req,res,next)=>{const name=req.url?.split('?')[0]?.replace(/^\/ocr\/runtime\//,'');const file=name&&paths.get(name);if(!file||!req.url?.startsWith('/ocr/runtime/'))return next();res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','public, max-age=0, must-revalidate');res.end(readFileSync(file));});},generateBundle(_,bundle){
  for(const[name,path]of paths)this.emitFile({type:'asset',fileName:`ocr/runtime/${name}`,source:readFileSync(path)});
  const urls=[...new Set([base,base+'index.html',...Object.keys(bundle).filter(n=>/\.(js|css)$/.test(n)).map(n=>base+n),...[...paths.keys()].map(n=>base+'ocr/runtime/'+n),...['eng','rus'].map(n=>base+'ocr/lang/'+n+'.traineddata.gz')])];
  const version=createHash('sha256').update(JSON.stringify(urls)).digest('hex').slice(0,16);
  // Registered lazily on first OCR only. GET allow-list excludes API, document/image bytes and user data.
  const serviceWorker=`const CACHE='geoservice-ocr-${version}',URLS=${JSON.stringify(urls)};self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS)).then(()=>self.skipWaiting())));self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('geoservice-ocr-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!URLS.includes(url.pathname))return;event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||fetch(event.request)));});`;
  this.emitFile({type:'asset',fileName:'ocr-offline.js',source:serviceWorker});
 }};
}
