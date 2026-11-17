// SPDX-License-Identifier: BSD-3-Clause
import type {CadDocument,ModelLibraryAsset} from '@brickwright/cad-core';
import source from './electronics-assets/sources.json' with {type:'json'};
/** Preserve source attribution in saved projects without shipping the raw STEP in each SB3. */
export function addComponentAppearance(doc:CadDocument,id:string,preset:'visual-feather-rp2040'|'visual-aa-holder-830'|'visual-drv8833'|'visual-dual-hbridge'|'visual-metro-mini'|'visual-buck-5v'){
 const node=doc.nodes[id];node.physics={...node.physics!,sourcePreset:preset};
 if(preset==='visual-drv8833'||preset==='visual-dual-hbridge'){node.name=preset==='visual-drv8833'?'DRV8833 breakout · illustrative layout':'Dual H-bridge · functional module';return;}
 const extra=preset==='visual-metro-mini'?{file:'2590 Metro Mini Rev B.step',id:'adafruit-metro-mini-2590-appearance',title:'METRO Mini · ATmega328P / 16 MHz',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,-21.59,-8.89,-3,1]}:preset==='visual-buck-5v'?{file:'4739 MPM3610 5V Buck.step',id:'adafruit-buck-4739-appearance',title:'MPM3610 · regulated 5 V rail',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,-5.08,-8.5725,-2,1]}:undefined;
 const file=source.files.find(f=>f.local===(extra?.file??(preset==='visual-feather-rp2040'?'4884 Feather RP2040.step':'830 Battery Holder 4xAA.step')))!;
 const record=extra?.id??(preset==='visual-feather-rp2040'?'adafruit-feather-4884-appearance':'adafruit-holder-830-appearance');
 const title=extra?.title??(preset==='visual-feather-rp2040'?'Feather RP2040':'4×AA battery holder');
 const notes='Display-only tessellated STEP surfaces. Simplified clearance collider and mass retained. Purchased part is excluded from the PLA print layout. Display mesh is not a watertight manufacturing export.';
 const asset:ModelLibraryAsset={id:record,version:'1',title,author:'Adafruit Industries',sourceUrl:file.url,sourceRevision:{repositoryUrl:source.repository,commit:source.commit},licence:{spdx:'MIT',scope:'asset',attribution:'Copyright (c) 2016 Adafruit Industries',evidenceUrl:'https://github.com/adafruit/Adafruit_CAD_Parts/blob/'+source.commit+'/LICENSE',capturedOn:'2026-11-17',review:'accepted',reviewer:'Brickwright contributors'},original:{url:file.url,sha256:file.sha256,bytes:file.bytes,format:'step'},derivatives:[],conversion:{sourceUnits:'mm',unitAssumption:'STEP explicitly declares millimetres. Rigid placement only; no scaling.',sourceUpAxis:'Z',toMillimetresZUp:extra?.matrix??(preset==='visual-feather-rp2040'?[0,1,0,0,-1,0,0,0,0,0,1,0,11.43,-25.4,-4,1]:[1,0,0,0,0,1,0,0,0,0,1,0,-32.3,-35,-10.6,1])},modificationNotes:notes};
 doc.provenance??={version:1,records:[]};
 if(!doc.provenance.records.some(r=>r.id===record))doc.provenance.records.push({id:record,asset,selectedFile:asset.original,modificationNotes:notes});
 node.provenance=[...new Set([...(node.provenance??[]),record])];node.name=title+' · simplified collider';
}
