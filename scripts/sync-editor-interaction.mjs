// SPDX-License-Identifier: BSD-3-Clause
// Pin shared, model-independent interaction arithmetic from a Lite checkout.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), sourceRoot = args.find(a => !a.startsWith('--'));
if (!sourceRoot || args.some(a => a.startsWith('--') && a !== '--check')) throw new Error('Usage: node scripts/sync-editor-interaction.mjs <brickwright-lite-checkout> [--check]');
const source = 'overlay/scratch-gui/src/lib/editor-interaction/box-selection.js';
const file = 'packages/editor/src/vendor/box-selection.js';
const checkout = resolve(sourceRoot);
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], {encoding:'utf8'}).trim();
if (git('status','--porcelain','--',source)) throw new Error('Commit the shared source before pinning it');
const bytes = await readFile(resolve(checkout,source));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifestPath = resolve(root,'docs/brickwright-provenance.json');
const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
if (args.includes('--check')) {
    const entry = manifest.files.find(entry => entry.file === file);
    if (!entry || entry.source !== source || entry.sha256 !== sha256 || !bytes.equals(await readFile(resolve(root,file)))) throw new Error('Shared selection source, vendor or provenance differs; run sync-editor-interaction without --check');
    const pinned = execFileSync('git',['-C',checkout,'show',`${entry.commit ?? manifest.commit}:${source}`]);
    if (!bytes.equals(pinned)) throw new Error('The recorded commit does not contain the vendored bytes');
    console.log('PASS: shared selection source, vendor, hash and pinned source revision agree');
} else {
    const entry = {file, source, commit:git('rev-parse','HEAD'), sha256};
    manifest.files = [...manifest.files.filter(entry => entry.file !== file), entry];
    await writeFile(resolve(root,file),bytes);
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    console.log(`Pinned ${file} from ${entry.commit}`);
}
