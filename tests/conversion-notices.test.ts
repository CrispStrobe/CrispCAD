// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {importOpenSCAD,importJSCAD,getCodeImportNotices,conversionGapIds,setLocale} from '@brickwright/cad-core';
it('tracks every stable notice identifier and its acceptance work',()=>{
 const register=JSON.parse(readFileSync('docs/evidence/converter-gaps.json','utf8'));const ids=register.gaps.map((gap:any)=>gap.id);expect(new Set(ids).size).toBe(ids.length);for(const id of conversionGapIds){const gap=register.gaps.find((gap:any)=>gap.id===id);expect(gap,id).toBeTruthy();expect(gap.tests.length).toBeGreaterThan(0);expect(gap.nextOrEvidence.length).toBeGreaterThan(20);}
});
it('retains IDs independently of translated warning prose and shares metadata with JSCAD',()=>{
 const source='caption="A";echo("test");#color("red")linear_extrude(2)text(caption,size=3);';let ids:string[]=[];try{setLocale('en');const en=getCodeImportNotices(importOpenSCAD(source));ids=en.map(n=>n.id);expect(ids).toContain('scad.text.font');expect(ids).toContain('scad.appearance.colours');setLocale('de');const de=getCodeImportNotices(importOpenSCAD(source));expect(de.map(n=>n.id)).toEqual(ids);expect(de.map(n=>n.message)).not.toEqual(en.map(n=>n.message));}finally{setLocale('en');}
 const result=importJSCAD("const {cube}=require('@jscad/modeling').primitives;module.exports.main=()=>cube();");expect(result.notices[0].id).toBe('jscad.parameters.snapshot');expect(getCodeImportNotices(result.program)).toEqual(result.notices);
});
