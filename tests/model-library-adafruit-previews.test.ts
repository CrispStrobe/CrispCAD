// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {adafruitArchive} from '../packages/editor/src/adafruit-archive-data.js';
import data from '../packages/editor/src/adafruit-preview-data.json' with {type:'json'};
it('ships a source-bound PNG for every Adafruit component, distinct from metadata files',()=>{
 const manifest=JSON.parse(readFileSync('library/adafruit-thumbnail-manifest.json','utf8'));
 expect(data.archiveCommit).toBe(adafruitArchive.commit);expect(data.upstreamCommit).toBe(adafruitArchive.upstreamCommit);expect(data.mediaCommit).toBe(manifest.mediaCommit);
 expect(manifest.entries).toHaveLength(482);expect(Object.keys(data.previews)).toHaveLength(482);expect(manifest.failures).toEqual([]);
 const previews=data.previews as Record<string,string>;
 for(const folder of adafruitArchive.folders){
  if(folder.name==='Adafruit archive files'){expect(previews[folder.name]).toBeUndefined();continue;}
  const entry=manifest.entries.find((e:any)=>e.folder===folder.name);expect(entry).toBeDefined();
  const original=folder.files.find(f=>f.path===entry.source.path);expect(original).toBeDefined();expect(entry.source.sha256).toBe(original!.sha256);expect(entry.source.bytes).toBe(original!.bytes);
  expect(previews[folder.name]).toMatch(/^data:image\/png;base64,/);const png=Buffer.from(previews[folder.name].split(',')[1],'base64');expect(png.length).toBe(entry.image.bytes);expect(createHash('sha256').update(png).digest('hex')).toBe(entry.image.sha256);expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(png.readUInt32BE(16)).toBe(256);expect(png.readUInt32BE(20)).toBe(192);
 }
 expect(manifest.entries.filter((e:any)=>e.source.format==='step')).toHaveLength(111);expect(manifest.entries.filter((e:any)=>e.source.format==='f3d')).toHaveLength(2);
});
