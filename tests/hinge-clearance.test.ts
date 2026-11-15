// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {hingeMembersSeparated,hingeFrameSeparationMargin,hingeFrameDriftBound} from '../packages/physics/src/hinge-clearance.js';
const box=(id:string,min:number[],max:number[])=>({id,hulls:[{positions:new Float64Array([min[0],min[1],min[2],max[0],min[1],min[2],min[0],max[1],min[2],max[0],max[1],min[2],min[0],min[1],max[2],max[0],min[1],max[2],min[0],max[1],max[2],max[0],max[1],max[2]]),indices:new Uint32Array()}]});
it('proves axial and radial separation over a full revolution but refuses a currently clear future collision',()=>{
 const fixed=box('fixed',[10,-1,-1],[12,1,1]),axial=box('axial',[10,2,-1],[12,4,1]),radial=box('radial',[1,-1,-1],[2,1,1]),opposite=box('opposite',[-12,-1,-1],[-10,1,1]),close=box('close',[10,1.1,-1],[12,2,1]),none=()=>false;
 expect(hingeMembersSeparated([fixed],[axial],[0,0,0],[0,1,0],none)).toBe(true);expect(hingeMembersSeparated([fixed],[radial],[0,0,0],[0,1,0],none)).toBe(true);expect(hingeMembersSeparated([fixed],[opposite],[0,0,0],[0,1,0],none)).toBe(false);expect(hingeMembersSeparated([fixed],[box('quarter-turn',[-1,-1,10],[1,1,12])],[0,0,0],[0,1,0],none)).toBe(false);expect(hingeMembersSeparated([fixed],[close],[0,0,0],[0,1,0],none)).toBe(false);
 expect(hingeMembersSeparated([fixed,fixed],[axial],[0,0,0],[0,1,0],none,.25,1)).toBe(false);
 expect(hingeMembersSeparated([fixed],[opposite],[0,0,0],[0,1,0],()=>true)).toBe(true);expect(hingeMembersSeparated([fixed,box('other',[10,-1,-1],[12,1,1])],[opposite],[0,0,0],[0,1,0],id=>id==='fixed')).toBe(false);
});
it('handles offset axes and projected hulls crossing the axis conservatively',()=>{
 const surrounding=box('around',[-2,-1,-2],[2,1,2]),nearAxis=box('rotor',[-.5,-1,-.5],[.5,1,.5]);expect(hingeMembersSeparated([surrounding],[nearAxis],[0,0,0],[0,1,0],()=>false)).toBe(false);
 const translate=(m:ReturnType<typeof box>)=>({...m,hulls:m.hulls.map(h=>({...h,positions:h.positions.map((v,i)=>v+[100,-50,20][i%3])}))});expect(hingeMembersSeparated([translate(box('a',[10,-1,-1],[12,1,1]))],[translate(box('b',[1,-1,-1],[2,1,1]))],[100,-50,20],[0,1,0],()=>false)).toBe(true);
});
it('bounds near-coaxial frame uncertainty by the material lever arm',()=>{
 const hulls=box('part',[10,-1,-1],[12,1,1]).hulls;const exact=hingeFrameSeparationMargin(hulls,[0,0,0],[0,1,0],[0,0,0],[0,1,0]);expect(exact).toBeGreaterThanOrEqual(.25);expect(exact).toBeLessThan(.251);
 expect(hingeFrameSeparationMargin(hulls,[1e9,0,0],[0,1,0],[1e9,0,0],[0,1,8e-9])).toBeUndefined();expect(hingeFrameSeparationMargin(hulls,[0,0,0],[0,1,0],[.0001,0,0],[0,1,0])).toBeUndefined();
});
it('bounds instantaneous hinge drift by anchor translation and the complete rotor lever arm',()=>{
 expect(hingeFrameDriftBound([0,0,0],[0,2,0],[.1,0,0],[0,3,0],40)).toBeCloseTo(.1,12);
 expect(hingeFrameDriftBound([0,0,0],[0,1,0],[.1,0,0],[Math.sin(.01),Math.cos(.01),0],40)).toBeCloseTo(.1+80*Math.sin(.005),12);
 expect(hingeFrameDriftBound([0,0,0],[0,0,0],[0,0,0],[0,1,0],40)).toBe(Infinity);
});
