// SPDX-License-Identifier: BSD-3-Clause
import type {Vec3} from '@brickwright/cad-core';
import type {ConvexPiece} from './collision.js';
type Member={id:string;hulls:readonly ConvexPiece[]};
type RadialRange={min:number;max:number};
type Sweep={hull:ConvexPiece;min:number;end:number;radial?:RadialRange};
const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
/** Maximum movement needed to return B to an ideal hinge pose at this instant:
 * translate its anchor, then apply the shortest rotation aligning both axes.
 * The full-turn proof already permits the remaining twist around that axis. */
export function hingeFrameDriftBound(anchorA:Vec3,axisA:Vec3,anchorB:Vec3,axisB:Vec3,radiusB:number):number{
 const a=Math.hypot(...axisA),b=Math.hypot(...axisB),shift=Math.hypot(...anchorA.map((v,i)=>v-anchorB[i]));if(![a,b,shift,radiusB].every(Number.isFinite)||a<1e-9||b<1e-9||radiusB<0)return Infinity;
 return shift+radiusB*Math.hypot(...axisA.map((v,i)=>v/a-axisB[i]/b));
}
/** Reserve clearance for the permitted frame mismatch and floating-point
 * arithmetic. An angular tolerance alone is unsafe for distant material. */
export function hingeFrameSeparationMargin(hulls:Iterable<ConvexPiece>,anchorA:Vec3,axisA:Vec3,anchorB:Vec3,axisB:Vec3):number|undefined{
 const shift=Math.hypot(...anchorA.map((v,i)=>v-anchorB[i])),rawSkew=Math.hypot(...axisA.map((v,i)=>v-axisB[i])),a=Math.hypot(...axisA),b=Math.hypot(...axisB);
 if(![shift,rawSkew,a,b].every(Number.isFinite)||shift>1e-6||rawSkew>1e-8||a<1e-9||b<1e-9)return;
 const skew=Math.hypot(...axisA.map((v,i)=>v/a-axisB[i]/b));let radius=0,scale=Math.max(1,...anchorA.map(Math.abs),...anchorB.map(Math.abs));
 for(const hull of hulls)for(let i=0;i<hull.positions.length;i+=3){radius=Math.max(radius,Math.hypot(hull.positions[i]-anchorA[0],hull.positions[i+1]-anchorA[1],hull.positions[i+2]-anchorA[2]));for(let j=0;j<3;j++)scale=Math.max(scale,Math.abs(hull.positions[i+j]));}
 const uncertainty=2*radius*skew+2*shift+256*Number.EPSILON*Math.max(scale,radius);if(!Number.isFinite(uncertainty)||uncertainty>.025)return;return .25+uncertainty;
}
/** Conservative full-turn bound around an ideal hinge. Convex projected hulls
 * give the minimum distance from its axis; maximum radius is at a vertex.
 * Disjoint axial/radial intervals prove separation at every hinge angle.
 * This only optimizes collision filtering; it never substitutes geometry. */
export function hingeMembersSeparated(left:readonly Member[],right:readonly Member[],anchor:Vec3,axis:Vec3,excluded:(a:string,b:string)=>boolean,marginMm=.25,maxPairChecks=2_000_000):boolean{
 const length=Math.hypot(...axis);if(!Number.isFinite(length)||length<1e-9||!Number.isFinite(marginMm)||marginMm<=0||!Number.isInteger(maxPairChecks)||maxPairChecks<=0)return false;
 let checks=0;for(const a of left)for(const b of right)if(!excluded(a.id,b.id)){checks+=a.hulls.length*b.hulls.length;if(checks>maxPairChecks)return false;}
 const z=axis.map(v=>v/length),seed=Math.abs(z[0])<.9?[1,0,0]:[0,1,0],dot=z.reduce((s,v,i)=>s+v*seed[i],0),u=seed.map((v,i)=>v-dot*z[i]),ul=Math.hypot(...u);for(let i=0;i<3;i++)u[i]/=ul;const v=[z[1]*u[2]-z[2]*u[1],z[2]*u[0]-z[0]*u[2],z[0]*u[1]-z[1]*u[0]],cache=new Map<ConvexPiece,Sweep>();
 const component=(positions:Float64Array,i:number,basis:number[])=>
  ((0+(positions[i]-anchor[0])*basis[0])+(positions[i+1]-anchor[1])*basis[1])+(positions[i+2]-anchor[2])*basis[2];
 const axial=(hull:ConvexPiece):Sweep=>{
  const prior=cache.get(hull);
  if(prior)return prior;
  let min=Infinity,max=-Infinity;
  for(let i=0;i<hull.positions.length;i+=3){
   const along=component(hull.positions,i,z);
   min=Math.min(min,along);max=Math.max(max,along);
  }
  const sweep={hull,min,end:max+marginMm};
  cache.set(hull,sweep);
  return sweep;
 };
 const radial=(sweep:Sweep):RadialRange=>{
  if(sweep.radial)return sweep.radial;
  let radialMax=0;
  const positions=sweep.hull.positions,points:number[][]=[];
  for(let i=0;i<positions.length;i+=3){
   const point=[component(positions,i,u),component(positions,i,v)];
   radialMax=Math.max(radialMax,Math.hypot(...point));
   points.push(point);
  }
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const unique=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]),lower:number[][]=[],upper:number[][]=[];
  for(const p of unique){while(lower.length>=2&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}for(const p of [...unique].reverse()){while(upper.length>=2&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}const polygon=unique.length===1?unique:[...lower.slice(0,-1),...upper.slice(0,-1)];
  let radialMin=Infinity;if(polygon.length>=3&&polygon.every((p,i)=>cross(p,polygon[(i+1)%polygon.length],[0,0])>=-1e-10))radialMin=0;else for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/den)):0;radialMin=Math.min(radialMin,Math.hypot(a[0]+t*dx,a[1]+t*dy));}
  return sweep.radial={min:radialMin,max:radialMax};
 };
 const indexed=new Map<Member,{sweeps:Sweep[];prefixEnd:number[]}>();
 for(const a of left)for(const b of right){
  if(excluded(a.id,b.id)||!a.hulls.length||!b.hulls.length)continue;
  let index=indexed.get(b);
  if(!index){
   const sweeps=b.hulls.map(axial);
   if(sweeps.some(sweep=>!Number.isFinite(sweep.min)||!Number.isFinite(sweep.end)))return false;
   sweeps.sort((x,y)=>x.min-y.min);
   let end=-Infinity;
   const prefixEnd=sweeps.map(sweep=>end=Math.max(end,sweep.end));
   index={sweeps,prefixEnd};
   indexed.set(b,index);
  }
  const {sweeps,prefixEnd}=index;
  for(const hull of a.hulls){
   const x=axial(hull);
   if(!Number.isFinite(x.min)||!Number.isFinite(x.end))return false;
   // Skip the prefix that ends before x, then stop when starts reach x's end.
   let low=0,high=sweeps.length;
   while(low<high){
    const mid=(low+high)>>>1;
    if(prefixEnd[mid]<=x.min)low=mid+1;else high=mid;
   }
   for(let i=low;i<sweeps.length&&sweeps[i].min<x.end;i++){
    const y=sweeps[i];
    if(y.end<=x.min)continue;
    const xr=radial(x),yr=radial(y);
    if(xr.max+marginMm<=yr.min||yr.max+marginMm<=xr.min)continue;
    return false;
   }
  }
 }
 return true;
}
