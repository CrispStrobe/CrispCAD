// SPDX-License-Identifier: BSD-3-Clause
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),source=process.argv.slice(2).find(a=>!a.startsWith('--'));
if(!source)throw new Error('Usage: node scripts/generate-simlab-linkage.mjs <dart_csp-worktree> [--check]');
const checkout=resolve(source),pin='46288eb23f04c2a2f2210088fe568285bea6114f';
assert.equal(execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),pin,'Review and pin a new solver revision explicitly');
assert.equal(execFileSync('git',['-C',checkout,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'','Build from committed solver sources');
assert.match(await readFile(join(checkout,'LICENSE'),'utf8'),/^MIT License/);
const scratch=await mkdtemp(join(tmpdir(),'brickwright-csp-example-'));
try{
 const config=join(scratch,'package_config.json');await writeFile(config,JSON.stringify({configVersion:2,packages:[{name:'dart_csp',rootUri:pathToFileURL(checkout+'/').href,packageUri:'lib/',languageVersion:'3.0'}]}));
 const generated=JSON.parse(execFileSync('dart',[`--packages=${config}`,join(root,'scripts/generate-simlab-linkage.dart')],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
 assert.equal(generated.revision,pin);assert.equal(generated.status,'residual-checked');assert.ok(generated.maxLengthErrorMm<1e-6);
 const p=generated.points,length=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));for(const [a,b,expected]of [['origin','crank',30],['crank','follower',60],['follower','ground',40],['origin','ground',60]])assert.ok(Math.abs(length(p[a],p[b])-expected)<1e-6);
 const output=join(root,'packages/editor/src/simulation-assets/four-bar.json');
 if(process.argv.includes('--check')){const retained=JSON.parse(await readFile(output,'utf8'));assert.equal(retained.revision,pin);for(const [key,point]of Object.entries(p))assert.ok(Math.hypot(...point.map((v,i)=>v-retained.points[key][i]))<1e-6);console.log('PASS pinned dart_csp four-bar geometry and independent length checks');}
 else{await writeFile(output,JSON.stringify(generated)+'\n');console.log('Generated residual-checked dart_csp four-bar geometry');}
}finally{await rm(scratch,{recursive:true,force:true});}
