// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';import {simplifyRadialProfile} from '../packages/physics/src/radial-profile.js';
it('keeps endpoints and sharp shoulders while bounding the distance of every sampled point',()=>{
 const p=Array.from({length:97},(_,i)=>[20*(1-i/96)**3,38*i/96]),selected=simplifyRadialProfile(p,.05);expect(selected[0]).toBe(0);expect(selected.at(-1)).toBe(96);expect(selected.length).toBeLessThan(48);
 for(let k=0;k<selected.length-1;k++){const a=p[selected[k]],b=p[selected[k+1]],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);for(let i=selected[k];i<=selected[k+1];i++){const q=p[i],projection=((q[0]-a[0])*dx+(q[1]-a[1])*dy)/length;const distance=projection<0?Math.hypot(q[0]-a[0],q[1]-a[1]):projection>length?Math.hypot(q[0]-b[0],q[1]-b[1]):Math.abs(dx*(q[1]-a[1])-dy*(q[0]-a[0]))/length;expect(distance).toBeLessThanOrEqual(.050000001);}}
 expect(simplifyRadialProfile([[0,0],[5,0],[5,10],[10,10],[10,20],[0,20]],.05)).toEqual([0,1,2,3,4,5]);
});
it('retains the floor and opening corners of a thin hollow profile',()=>{
 const profile=[[0,0],[12,0],[12,15],[11,15],[11,4],[0,4]];expect(simplifyRadialProfile(profile,.05)).toEqual([0,1,2,3,4,5]);expect(simplifyRadialProfile([[0,0]],.05)).toEqual([0]);
});
