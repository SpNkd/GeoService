import {spawnSync} from 'node:child_process';
import {mkdtemp,cp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function run(cmd,args,cwd=process.cwd(),capture=false){const r=spawnSync(cmd,args,{cwd,stdio:capture?'pipe':'inherit',encoding:'utf8'});if(r.status!==0)throw Error(`${cmd} failed (${r.status})`);return r.stdout?.trim();}
const remotes=process.argv.slice(2);if(!remotes.length)throw Error('Usage: npm run deploy:pages -- origin gitverse');
const urls=remotes.map(remote=>{const value=run('git',['remote','get-url',remote],undefined,true),url=new URL(value);const https=url.protocol==='https:'&&!url.username&&!url.password&&['github.com','gitverse.ru'].includes(url.hostname);const ssh=url.protocol==='ssh:'&&url.username==='git'&&!url.password&&url.hostname==='gitverse.ru';if(!https&&!ssh)throw Error('Use credential-free HTTPS or GitVerse SSH remote');return value;});
const source=run('git',['rev-parse','HEAD'],undefined,true);if(run('git',['status','--porcelain'],undefined,true))throw Error('Commit source changes before deployment');
run('npm',['run','build']);
await cp('LICENSE','dist/LICENSE');await cp('THIRD_PARTY_NOTICES.md','dist/THIRD_PARTY_NOTICES.md');await writeFile('dist/release.json',JSON.stringify({sourceCommit:source,builtAt:new Date().toISOString()})+'\n');
for(const url of urls){const directory=await mkdtemp(join(tmpdir(),'geoservice-pages-'));try{await cp('dist',directory,{recursive:true});run('git',['init','--initial-branch=gh-pages'],directory);run('git',['remote','add','publish',url],directory);
 const exists=run('git',['ls-remote','--heads','publish','refs/heads/gh-pages'],directory,true);if(exists){run('git',['fetch','--depth=1','publish','gh-pages'],directory);run('git',['reset','--mixed','FETCH_HEAD'],directory);}
 run('git',['add','--all'],directory);run('git',['commit','-m',`Deploy static GeoService ${source.slice(0,7)}`],directory);run('git',['push','publish','HEAD:gh-pages'],directory);
}finally{await rm(directory,{recursive:true,force:true});}}
