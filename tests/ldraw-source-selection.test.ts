// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {reviewLDrawAuthoredRoot} from '../scripts/lib/ldraw-source-selection.mjs';
const base={rootPath:'parts/new.dat',meshSha256:'mesh',knownMeshByRoot:{'parts/old.dat':'mesh'}};
it('refuses explicit Part Alias even when the title marker follows tilde',()=>{
 expect(reviewLDrawAuthoredRoot({...base,source:'0 ~=Magnet\n0 !LDRAW_ORG Part Alias UPDATE 2025-06'}).eligible).toBe(false);
 expect(reviewLDrawAuthoredRoot({...base,source:'0 ~=Magnet\n0 !LDRAW_ORG Part UPDATE 2025-06'}).eligible).toBe(false);
});
it('refuses an exact identity-only reference with already available matching geometry',()=>{
 expect(reviewLDrawAuthoredRoot({...base,source:'0 Button\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 old.dat'})).toMatchObject({eligible:false,target:'parts/old.dat'});
});
it('retains a transformed reference and an independently authored scene despite a shared mesh',()=>{
 expect(reviewLDrawAuthoredRoot({...base,source:'0 Offset\n1 16 1 0 0 1 0 0 0 1 0 0 0 1 old.dat'}).eligible).toBe(true);
 expect(reviewLDrawAuthoredRoot({...base,source:'0 Authored scene\n3 16 0 0 0 1 0 0 0 1 0'}).eligible).toBe(true);
});
it('does not guess identity or supersession without a matching known derivative',()=>{
 expect(reviewLDrawAuthoredRoot({...base,knownMeshByRoot:{},source:'0 Button\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 old.dat'}).eligible).toBe(true);
 expect(reviewLDrawAuthoredRoot({...base,source:'0 Shape\n0 !HISTORY Obsoleted. Use different instead'}).eligible).toBe(true);
});
it('refuses an explicitly superseded identical source, with or without dat suffix',()=>{
 for(const reference of ['old','old.dat'])expect(reviewLDrawAuthoredRoot({...base,source:'0 Shape\n0 !HISTORY Obsoleted. Use '+reference+' instead'})).toMatchObject({eligible:false,target:'parts/old.dat'});
});
