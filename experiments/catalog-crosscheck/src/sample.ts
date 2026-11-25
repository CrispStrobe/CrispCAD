// SPDX-License-Identifier: BSD-3-Clause
// Catalog listing and a deterministic sample stratified by kit (catalog category).
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface CatalogEntry { id: string; kit: string; file: string }

/** Every `.kcad.ts` under `root`, sorted. The kit is the directory directly above the file
 * (kernelCAD's `catalog/kits/<kit>/<model>.kcad.ts`). */
export function listCatalog(root: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.kcad.ts')) {
        const id = relative(root, full).split(sep).join('/');
        const parts = id.split('/');
        out.push({ id, kit: parts.length > 1 ? parts[parts.length - 2] : '', file: full });
      }
    }
  };
  if (statSync(root).isFile()) return [{ id: root.split(sep).pop()!, kit: '', file: root }];
  walk(root);
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const rank = (seed: string, id: string) => createHash('sha256').update(`${seed}\0${id}`).digest('hex');

/** `size` models, each kit getting its proportional share (largest remainder, at least one
 * per kit when size ≥ number of kits); within a kit the models with the smallest
 * sha256(seed, id) are taken. Same seed and catalog → same sample. */
export function stratifiedSample(entries: CatalogEntry[], size: number, seed: string): CatalogEntry[] {
  if (size >= entries.length) return entries;
  const kits = new Map<string, CatalogEntry[]>();
  for (const e of entries) kits.set(e.kit, [...(kits.get(e.kit) ?? []), e]);
  const names = [...kits.keys()].sort();
  const exact = names.map(k => (kits.get(k)!.length * size) / entries.length);
  const quota = exact.map(q => Math.floor(q));
  if (size >= names.length) quota.forEach((q, i) => { if (q === 0) quota[i] = 1; });
  let left = size - quota.reduce((s, q) => s + q, 0);
  const order = names.map((_, i) => i).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || (names[a] < names[b] ? -1 : 1));
  for (const i of order) { if (left <= 0) break; if (quota[i] < kits.get(names[i])!.length) { quota[i]++; left--; } }
  for (let i = names.length - 1; left < 0 && i >= 0; i--) { const take = Math.min(quota[i] - 1, -left); quota[i] -= take; left += take; }
  return names.flatMap((k, i) => [...kits.get(k)!].sort((a, b) => (rank(seed, a.id) < rank(seed, b.id) ? -1 : 1)).slice(0, quota[i]))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
