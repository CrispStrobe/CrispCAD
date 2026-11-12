import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(); const scratch = await mkdtemp(join(tmpdir(), 'brickwright-cad-pack-')); const artifacts = join(scratch, 'tarballs'); await mkdir(artifacts);
function run(args, cwd = root) { const r = spawnSync('npm', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr + r.stdout); return r.stdout; }
const packed = JSON.parse(run(['pack', '--workspaces', '--json', '--pack-destination', artifacts]));
await writeFile(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run(['install', '--ignore-scripts', '--offline', ...packed.map(p => join(artifacts, p.filename))], scratch);
const script = `import {createCadSession} from '@brickwright/cad-core';import {createGeometryKernel} from '@brickwright/cad-geometry';import {mountCadEditor} from '@brickwright/cad-editor';import {attachCadProject} from '@brickwright/cad-brickwright';import {readFileSync} from 'node:fs';
const s=createCadSession();s.add({kind:'box',size:[10,20,30]});const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});if(Math.abs(kernel.evaluate(s.state.document).volume-6000)>1e-6)throw Error('bad geometry');if(typeof mountCadEditor!=='function'||typeof attachCadProject!=='function')throw Error('missing API');console.log('PASS: all four packed packages install offline in an independent host and evaluate a real solid');`;
await writeFile(join(scratch, 'verify.mjs'), script);
const result = spawnSync(process.execPath, ['verify.mjs'], { cwd: scratch, encoding: 'utf8' }); if (result.status) throw new Error(result.stderr + result.stdout); process.stdout.write(result.stdout);
await mkdir('dist/packages', { recursive: true });
const { copyFile } = await import('node:fs/promises'); for (const p of packed) await copyFile(join(artifacts, p.filename), resolve('dist/packages', p.filename));
