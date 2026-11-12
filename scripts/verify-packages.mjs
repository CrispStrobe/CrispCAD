import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(); const scratch = await mkdtemp(join(tmpdir(), 'brickwright-cad-pack-')); const artifacts = join(scratch, 'tarballs'); await mkdir(artifacts);
function run(args, cwd = root) { const r = spawnSync('npm', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr + r.stdout); return r.stdout; }
const packed = JSON.parse(run(['pack', '--workspaces', '--json', '--pack-destination', artifacts]));
// GitHub release URLs do not provide an offline-cacheable manifest. Supply the
// exact installed release as a local tarball in this offline verification host.
const runtime=JSON.parse(run(['pack','./node_modules/jolt-physics','--json','--pack-destination',artifacts]))[0];
await writeFile(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module',dependencies:{'jolt-physics':`file:${join(artifacts,runtime.filename)}`},overrides:{'jolt-physics':'$jolt-physics'} }));
run(['install', '--ignore-scripts', '--offline', ...packed.map(p => join(artifacts, p.filename))], scratch);
const script = `import {createCadSession} from '@brickwright/cad-core';import {createGeometryKernel} from '@brickwright/cad-geometry';import {mountCadEditor} from '@brickwright/cad-editor';import {attachCadProject} from '@brickwright/cad-brickwright';import {openHistoryStore} from '@brickwright/cad-history';import {solidMassProperties,prepareDocumentCollisions,createPhysicsWorld} from '@brickwright/cad-physics';import {readFileSync} from 'node:fs';
const s=createCadSession();s.add({kind:'box',size:[10,20,30]});const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});if(Math.abs(kernel.evaluate(s.state.document).volume-6000)>1e-6)throw Error('bad geometry');const geometry=kernel.evaluate(s.state.document);if(Math.abs(solidMassProperties(geometry.bodies[0],1050).massKg-.0063)>1e-9)throw Error('bad SI mass');const prepared=await prepareDocumentCollisions(s.state.document,geometry,kernel);const world=await createPhysicsWorld(s.state.document,geometry,prepared,{ground:false});world.step(.1);if(world.pose(s.state.document.roots[0]).positionMm[2]>=0)throw Error('missing gravity');world.dispose();if(typeof openHistoryStore!=='function'||typeof mountCadEditor!=='function'||typeof attachCadProject!=='function')throw Error('missing API');console.log('PASS: all six SDK packages install offline with the pinned local Jolt runtime; geometry and real SI physics pass');`;
await writeFile(join(scratch, 'verify.mjs'), script);
const result = spawnSync(process.execPath, ['verify.mjs'], { cwd: scratch, encoding: 'utf8' }); if (result.status) throw new Error(result.stderr + result.stdout); process.stdout.write(result.stdout);
await mkdir('dist/packages', { recursive: true });
const { copyFile } = await import('node:fs/promises'); for (const p of [...packed,runtime]) await copyFile(join(artifacts, p.filename), resolve('dist/packages', p.filename));
