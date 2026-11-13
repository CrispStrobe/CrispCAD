// SPDX-License-Identifier: BSD-3-Clause
// Explicit one-file offline curation; no downloads or project/history IO.
import {constants} from 'node:fs';
import {open, link, unlink, lstat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {parseModelLibraryCatalogue, validateModelLibraryCatalogue} from '../packages/core/dist/index.js';

const MAX_CATALOGUE_BYTES = 4 * 1024 * 1024;
const MAX_STL_BYTES = 16 * 1024 * 1024;
export const usage = 'node scripts/qualify-library-stl.mjs --catalogue INPUT.json --stl CACHED.stl --asset ID --file original|derivative:N --checked-on YYYY-MM-DD --output NEW.json [--timeout-ms 30000]';

export function parseArguments(args) {
  const values = {};
  const keys = ['catalogue', 'stl', 'asset', 'file', 'checked-on', 'output', 'timeout-ms'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2), value = args[i + 1];
    if (!args[i].startsWith('--') || !keys.includes(key) || Object.hasOwn(values, key) || !value || value.startsWith('--')) throw new Error(usage);
    values[key] = value;
  }
  if (keys.slice(0, 6).some(key => !values[key])) throw new Error(usage);
  const choice = values.file;
  if (choice !== 'original' && !/^derivative:(0|[1-9][0-9]*)$/.test(choice)) throw new Error('Select original or derivative:N.');
  const derivative = Number(choice.split(':')[1]);
  if (choice !== 'original' && !Number.isSafeInteger(derivative)) throw new Error('Invalid derivative index.');
  const checkedOn = values['checked-on'];
  const date = new Date(checkedOn);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== checkedOn) throw new Error('Supply a valid explicit checked-on date.');
  const timeoutMs = Number(values['timeout-ms'] ?? 30000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('timeout-ms must be an integer from 1 to 120000.');
  return {cataloguePath: resolve(values.catalogue), stlPath: resolve(values.stl), outputPath: resolve(values.output),
    selection: {assetId: values.asset, file: choice === 'original' ? choice : {derivative}}, checkedOn, timeoutMs};
}

async function readBounded(path, maxBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Expected a regular local file of at most ${maxBytes} bytes: ${path}`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error(`Local file exceeds ${maxBytes} bytes.`);
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** Termination interrupts synchronous native work by discarding the whole worker. */
export async function runBoundedWorker(url, data, {timeoutMs, signal}) {
  signal?.throwIfAborted();
  const worker = new Worker(url, {workerData: data, resourceLimits: {maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64, stackSizeMb: 4}});
  let timer, onAbort;
  try {
    return await new Promise((resolveResult, reject) => {
      onAbort = () => reject(new Error('Qualification cancelled.'));
      signal?.addEventListener('abort', onAbort, {once: true});
      if (signal?.aborted) return onAbort();
      timer = setTimeout(() => reject(new Error('Qualification timed out; worker discarded.')), timeoutMs);
      worker.once('message', message => message.error ? reject(new Error(message.error)) : resolveResult(message.catalogue));
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`Qualification worker exited without a result (${code}).`)));
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    await worker.terminate();
  }
}

async function requireUnused(path) {
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Output already exists; choose a new path: ${path}`);
}

/** Publish a complete sibling temporary file atomically with no replace semantics. */
export async function writeNewCatalogue(path, bytes, signal) {
  const temporary = resolve(dirname(path), `.library-qualification-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    signal?.throwIfAborted();
    await link(temporary, path); // Atomic and fails even if another process created path.
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function qualifyLocalSTL(options, {signal} = {}) {
  signal?.throwIfAborted();
  const {cataloguePath, stlPath, outputPath, selection, checkedOn, timeoutMs} = options;
  if (outputPath === cataloguePath || outputPath === stlPath) throw new Error('Output must be a new, separate catalogue path.');
  await requireUnused(outputPath);
  const parsed = parseModelLibraryCatalogue((await readBounded(cataloguePath, MAX_CATALOGUE_BYTES)).toString('utf8'));
  if (!parsed.valid) throw new Error(`Invalid catalogue: ${parsed.errors.join(' ')}`);
  const asset = parsed.catalogue.assets.find(asset => asset.id === selection.assetId);
  const file = selection.file === 'original' ? asset?.original : asset?.derivatives[selection.file.derivative];
  if (!file || file.format !== 'stl') throw new Error('Select one original or derivative STL.');
  if (!asset.quality?.screeningPolicy || asset.quality.fileSha256 !== file.sha256) throw new Error('Selected STL requires its retained screening policy and quality hash.');
  if (file.bytes > MAX_STL_BYTES) throw new Error('Selected STL exceeds the 16 MiB analysis budget.');
  const bytes = await readBounded(stlPath, file.bytes);
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Selected local STL byte size or SHA-256 mismatch.');
  const catalogue = await runBoundedWorker(new URL('./qualify-library-stl-worker.mjs', import.meta.url), {catalogue: parsed.catalogue, selection, bytes, checkedOn}, {timeoutMs, signal});
  const result = validateModelLibraryCatalogue(catalogue);
  if (!result.valid) throw new Error(`Invalid worker catalogue: ${result.errors.join(' ')}`);
  const serialized = Buffer.from(`${JSON.stringify(result.catalogue, null, 2)}\n`);
  if (serialized.length > MAX_CATALOGUE_BYTES) throw new Error('Qualified catalogue exceeds the 4 MiB output budget.');
  await writeNewCatalogue(outputPath, serialized, signal);
  return result.catalogue;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const options = parseArguments(process.argv.slice(2));
    await qualifyLocalSTL(options, {signal: controller.signal});
    console.log(`Saved ${options.outputPath}. Scope: one debug Jolt rigid collision preview step; curation evidence only, not fit, contacts, printability or mechanical certification.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
