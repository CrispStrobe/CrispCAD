// SPDX-License-Identifier: BSD-3-Clause
// Read-only verification of the two directions of shared CAD/Brickwright code.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length!==3)throw Error('Usage: npm run verify:brickwright-sync -- <brickwright-lite-checkout>');
const host=resolve(process.argv[2]);
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const producer=readFileSync(resolve(host,'scripts/integrate.mjs'),'utf8');
const field=name=>{const hits=[...producer.matchAll(new RegExp(`const ${name} = '([^']+)'`,'g'))];assert.equal(hits.length,1,`one Brickwright ${name} pin`);return hits[0][1];};
const url=field('JOLT_PHYSICS_URL'),integrity=field('JOLT_PHYSICS_INTEGRITY');
const cad=read(resolve(root,'packages/physics/package.json')),cadLock=read(resolve(root,'package-lock.json'));
const hostLock=read(resolve(host,'packages/scratch-gui/package-lock.json'));
assert.equal(cad.dependencies['jolt-physics'],url,'CAD and Brickwright must pin the same Jolt release');
for(const [name,lock] of [['CAD',cadLock],['Brickwright',hostLock]]){
 const engine=lock.packages['node_modules/jolt-physics'];assert.equal(engine.resolved,url,`${name} lock release`);assert.equal(engine.integrity,integrity,`${name} lock integrity`);
}
execFileSync(process.execPath,[resolve(root,'scripts/sync-editor-interaction.mjs'),host,'--check'],{cwd:root,stdio:'inherit'});
execFileSync(process.execPath,[resolve(host,'scripts/sync-cad-sdk.mjs'),root,'--check'],{cwd:host,stdio:'inherit'});
console.log('PASS: common Jolt release/integrity, shared interaction sources and current CAD SDK are synchronized');
