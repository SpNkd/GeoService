import type { Plugin } from 'vite';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const require=createRequire(import.meta.url);
/** PDF.js optional fonts/CMaps/WASM are pinned same-origin assets, never external URLs. */
export function localPdfAssets():Plugin {
 const root=dirname(require.resolve('pdfjs-dist/package.json')),files=new Map<string,string>();
 files.set('licenses/pdfjs-LICENSE',join(root,'LICENSE'));
 for(const directory of ['cmaps','standard_fonts','wasm'])for(const name of readdirSync(join(root,directory)))if(name.startsWith('LICENSE'))files.set(`licenses/${directory}-${name}`,join(root,directory,name));
 for(const directory of ['cmaps','standard_fonts','wasm'])for(const name of readdirSync(join(root,directory)))if(/\.(bcmap|pfb|ttf|otf|wasm)$/.test(name))files.set(`${directory}/${name}`,join(root,directory,name));
 return {name:'local-pdf-assets',configureServer(server){server.middlewares.use((req,res,next)=>{const path=req.url?.split('?')[0]?.replace(/^\/pdf\//,''),file=path&&files.get(path);if(!file||!req.url?.startsWith('/pdf/'))return next();res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(readFileSync(file));});},generateBundle(){for(const [name,file]of files)this.emitFile({type:'asset',fileName:`pdf/${name}`,source:readFileSync(file)});}};
}
