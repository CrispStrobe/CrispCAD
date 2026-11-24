// SPDX-License-Identifier: BSD-3-Clause
// Lists every file the installed @classcad/smlibwasm package ships, with size, SHA-256 and the
// licence its NOTICE assigns to it. Run: node licence-audit.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./node_modules/@classcad/smlibwasm/', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const walk = dir => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
// From the package NOTICE: the wrapper is MIT (AWV Informatik AG); the WASM holds SMLib/USD BRep
// (Apache-2.0, NVIDIA) plus AWV's MIT bindings; Lato is OFL-1.1; the Brotli dictionary is MIT.
const classify = path => {
  if (path.startsWith('wasm/')) return ['Apache-2.0 + MIT', 'SMLib / USD BRep (NVIDIA, Apache-2.0) compiled with AWV bindings (MIT); Emscripten runtime (MIT/UIUC)'];
  if (path === 'dist/_fonts.js' || path === 'dist/_fonts.d.ts') return ['OFL-1.1', 'Lato Regular 1.105 as base64 (the .d.ts repeats it as a literal type)'];
  if (path.startsWith('fonts/')) return ['OFL-1.1 (licence text)', 'Lato licence'];
  if (path.startsWith('dist/_brotli_dictionary')) return ['MIT', 'Brotli static dictionary (RFC 7932), Brotli authors'];
  if (path === 'LICENSE.usd-brep') return ['Apache-2.0 (licence text)', 'NVIDIA USD BRep licence'];
  if (path === 'NOTICE' || path === 'LICENSE') return ['MIT (notice)', 'AWV Informatik AG'];
  return ['MIT', 'AWV Informatik AG'];
};
const rows = walk(root).map(p => relative(root, p)).sort().map(path => {
  const bytes = readFileSync(join(root, path));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16), licence: classify(path) };
});
console.log(`${pkg.name}@${pkg.version} declares "${pkg.license}"; ${rows.length} files, ${(rows.reduce((s, r) => s + r.bytes, 0) / 2 ** 20).toFixed(1)} MiB\n`);
const groups = new Map();
for (const r of rows) { const key = r.licence.join(' | '); groups.set(key, [...(groups.get(key) ?? []), r]); }
console.log('| Licence | Files | Bytes | Notes |\n| --- | --- | --- | --- |');
for (const [key, list] of groups) { const [licence, note] = key.split(' | '); console.log(`| ${licence} | ${list.length > 4 ? `${list.length} files (dist/*.js, *.d.ts, ...)` : list.map(r => '`' + r.path + '`').join(', ')} | ${list.reduce((s, r) => s + r.bytes, 0)} | ${note} |`); }
if (process.argv.includes('--files')) for (const r of rows) console.log(`${r.sha256}  ${String(r.bytes).padStart(8)}  ${r.licence[0].padEnd(24)} ${r.path}`);
