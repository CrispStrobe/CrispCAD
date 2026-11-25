// SPDX-License-Identifier: BSD-3-Clause
// Lists every file of the installed @crispcad/exact-kernel release tarball with size, SHA-256
// and licence, and every source file bundled into it (dist/bundle-inputs.json).
// Run: node licence-audit.mjs [--files]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./node_modules/@crispcad/exact-kernel/', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const walk = dir => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
// From the package's NOTICE and dist/bundle-inputs.json.
const classify = path => {
  if (path === 'dist/smlibwasm.wasm') return ['Apache-2.0 + MIT', 'SMLib / USD BRep (NVIDIA, Apache-2.0) with AWV bindings (MIT), unmodified from @classcad/smlibwasm'];
  if (/^dist\/.*\.js$/.test(path)) return ['MIT', 'the package (CrispCAD contributors) and the prebundled smlibwasm JavaScript (AWV Informatik AG, Emscripten, Brotli dictionary)'];
  if (path === 'licenses/usd-brep-LICENSE') return ['Apache-2.0 (licence text)', 'USD BRep licence'];
  if (path.startsWith('licenses/') || path === 'LICENSE') return ['MIT (licence text)', 'package, smlibwasm, Emscripten'];
  if (path === 'NOTICE') return ['notice', 'attribution for the bundled code'];
  return ['MIT', 'the package (types, manifest, README, bundle inventory)'];
};
const rows = walk(root).map(p => relative(root, p)).sort().map(path => {
  const bytes = readFileSync(join(root, path));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16), licence: classify(path) };
});
const { smlibwasm, inputs } = JSON.parse(readFileSync(join(root, 'dist/bundle-inputs.json'), 'utf8'));
console.log(`${pkg.name}@${pkg.version} declares "${pkg.license}", ${Object.keys(pkg.dependencies ?? {}).length} runtime dependencies; ${rows.length} files, ${(rows.reduce((s, r) => s + r.bytes, 0) / 2 ** 20).toFixed(1)} MiB; bundles @classcad/smlibwasm ${smlibwasm} (${inputs.length} inputs, font module replaced by an empty one)\n`);
const groups = new Map();
for (const r of rows) { const key = r.licence.join(' | '); groups.set(key, [...(groups.get(key) ?? []), r]); }
console.log('| Licence | Files | Bytes | Notes |\n| --- | --- | --- | --- |');
for (const [key, list] of groups) { const [licence, note] = key.split(' | '); console.log(`| ${licence} | ${list.length > 4 ? `${list.length} files` : list.map(r => '`' + r.path + '`').join(', ')} | ${list.reduce((s, r) => s + r.bytes, 0)} | ${note} |`); }
const byLicence = inputs.reduce((m, i) => m.set(i.licence, (m.get(i.licence) ?? 0) + 1), new Map());
console.log(`\nBundle inputs by licence: ${[...byLicence].map(([l, n]) => `${l} ${n}`).join(', ')}`);
if (process.argv.includes('--files')) for (const r of rows) console.log(`${r.sha256}  ${String(r.bytes).padStart(8)}  ${r.licence[0].padEnd(26)} ${r.path}`);
