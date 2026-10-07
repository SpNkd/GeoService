import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync} from 'node:fs';
import type {Plugin} from 'vite';
const require=createRequire(import.meta.url);
/** Ship complete notices alongside the bundled runtimes, without initial-page requests. */
export function thirdPartyNotices():Plugin{return {name:'third-party-notices',generateBundle(){
 for(const [pkg,name] of [['react','LICENSE'],['react-dom','LICENSE'],['dxf-parser','LICENSE'],['zod','LICENSE'],['tesseract.js','LICENSE.md'],['tesseract.js-core','LICENSE']] as const){
  this.emitFile({type:'asset',fileName:`licenses/${pkg}/LICENSE`,source:readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)),name))});
 }
}};}
