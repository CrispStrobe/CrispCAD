// SPDX-License-Identifier: BSD-3-Clause
// Exact axis-aligned bounds of a compiled CAD Script shape, from support functions.
// Used by the `.kcad.ts` importer to evaluate `shape.boundingBox({ exact: true })` at
// conversion time. Circles, cylinders, cones, spheres and full revolutions are taken as
// the true curved solids (the segment count is a faceting hint, as in the exact lowering),
// so the bounds are those of the modelled solid, not of a particular tessellation.
//
// A support value h(d) = max over the solid of d·x is always an upper bound; it is marked
// exact only when the construction guarantees equality. Unions and hulls are exact; a cut
// is exact only where no cutter reaches the base's extreme plane; intersections, partial
// revolutions, twisted or tapered extrusions and resizes are not.
import type {CodeShape} from './code.js';
import type {CodeProfile} from './code-profiles.js';

type V3=[number,number,number];type V2=[number,number];
interface Support {value:number;exact:boolean}
const EMPTY:Support={value:-Infinity,exact:true};
const UNKNOWN:Support={value:Infinity,exact:false};
const dot3=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const tol=(v:number)=>1e-9*(1+Math.abs(v));

/** Support of a union (or hull): the maximum; exact when a maximising operand is exact. */
function maxOf(items:Support[]):Support{
 if(!items.length)return EMPTY;
 const value=Math.max(...items.map(s=>s.value));
 return {value,exact:value===-Infinity||items.some(s=>s.exact&&s.value>=value-tol(value))};
}
/** Support of `base - cutters`: exact when every cutter stays strictly inside the base's extreme plane. */
function cut(items:Support[]):Support{
 const [base,...cutters]=items;
 if(!base||base.value===-Infinity)return EMPTY;
 return {value:base.value,exact:base.exact&&cutters.every(c=>c.value<base.value-tol(base.value))};
}
const sum=(items:Support[]):Support=>({value:items.reduce((a,s)=>a+s.value,0),exact:items.every(s=>s.exact)});
const meet=(items:Support[]):Support=>items.length===1?items[0]:{value:Math.min(...items.map(s=>s.value)),exact:false};

function rotation2(angle:number):number[]{const a=angle*Math.PI/180;return [Math.cos(a),-Math.sin(a),Math.sin(a),Math.cos(a)];}
/** Row-major 3×3 rotation about a unit axis (right-handed), as the Manifold evaluator builds it. */
function axisMatrix(axis:readonly number[],angle:number):number[]{
 const l=Math.hypot(...axis),[x,y,z]=axis.map(v=>v/l),a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),t=1-c;
 return [t*x*x+c,t*x*y-s*z,t*x*z+s*y, t*x*y+s*z,t*y*y+c,t*y*z-s*x, t*x*z-s*y,t*y*z+s*x,t*z*z+c];
}
/** Mᵀd for a row-major 3×3 M. */
const transposed=(m:number[],d:readonly number[]):V3=>[m[0]*d[0]+m[3]*d[1]+m[6]*d[2],m[1]*d[0]+m[4]*d[1]+m[7]*d[2],m[2]*d[0]+m[5]*d[1]+m[8]*d[2]];

function profileSupport(p:CodeProfile,d:V2):Support{
 const [dx,dy]=d;
 switch(p.kind){
  case 'empty':return EMPTY;
  case 'polygon':{let value=-Infinity;for(const c of p.contours)for(const q of c)value=Math.max(value,q[0]*dx+q[1]*dy);return {value,exact:true};}
  case 'circle':return {value:p.radius*Math.hypot(dx,dy),exact:true};
  case 'rectangle':return p.center?{value:Math.abs(dx)*p.size[0]/2+Math.abs(dy)*p.size[1]/2,exact:true}:{value:Math.max(0,dx*p.size[0])+Math.max(0,dy*p.size[1]),exact:true};
  case 'move':{const s=profileSupport(p.profile,d);return {value:s.value+dx*p.vector[0]+dy*p.vector[1],exact:s.exact};}
  case 'scale':return profileSupport(p.profile,[dx*p.vector[0],dy*p.vector[1]]);
  case 'rotate':{const [a,b,c,e]=rotation2(p.angle);return profileSupport(p.profile,[a*dx+c*dy,b*dx+e*dy]);}
  case 'affine':{const m=p.matrix,s=profileSupport(p.profile,[m[0]*dx+m[3]*dy,m[1]*dx+m[4]*dy]);return {value:s.value+dx*m[2]+dy*m[5],exact:s.exact};}
  case 'offset':{const s=profileSupport(p.profile,d);if(p.distance>=0&&p.round)return {value:s.value+p.distance*Math.hypot(dx,dy),exact:s.exact};if(p.distance<=0)return {value:s.value,exact:p.distance===0&&s.exact};return UNKNOWN;}
  case 'union':case 'hull':return maxOf(p.profiles.map(c=>profileSupport(c,d)));
  case 'subtract':return cut(p.profiles.map(c=>profileSupport(c,d)));
  case 'intersect':return meet(p.profiles.map(c=>profileSupport(c,d)));
  case 'minkowski':return sum(p.profiles.map(c=>profileSupport(c,d)));
  default:return UNKNOWN;
 }
}

export function shapeSupport(shape:CodeShape,d:V3):Support{
 const [dx,dy,dz]=d,radial=Math.hypot(dx,dy);
 switch(shape.kind){
  case 'empty':return EMPTY;
  case 'box':return {value:Math.abs(dx)*shape.size[0]/2+Math.abs(dy)*shape.size[1]/2+Math.abs(dz)*shape.size[2]/2,exact:true};
  case 'cylinder':return {value:shape.radius*radial+Math.abs(dz)*shape.height/2,exact:true};
  case 'frustum':return {value:Math.max(shape.bottom*radial-dz*shape.height/2,shape.top*radial+dz*shape.height/2),exact:true};
  case 'sphere':return {value:shape.radius*Math.hypot(dx,dy,dz),exact:true};
  case 'polyhedron':{let value=-Infinity;for(const p of shape.points)value=Math.max(value,dot3(p,d));return {value,exact:true};}
  case 'extrude':{let value=-Infinity;for(const p of shape.points)value=Math.max(value,p[0]*dx+p[1]*dy);return {value:value+Math.max(0,dz*shape.height),exact:true};}
  case 'profile-extrude':{if(shape.twist!==0||shape.scaleTop[0]!==1||shape.scaleTop[1]!==1)return UNKNOWN;const s=profileSupport(shape.profile,[dx,dy]);return {value:s.value+Math.max(0,dz*shape.height),exact:s.exact};}
  case 'revolve':{
   // Manifold revolves the profile's x ≥ 0 half about its y axis, which becomes Z, from +X
   // counter-clockwise through the sweep (clockwise for a negative sweep). Along the sweep the
   // profile's x axis points at (cos θ, sin θ), so h(d) = max over θ of h_P(dx cos θ + dy sin θ, dz);
   // h_P is convex, so the maximum is at the extremes of that radial component over the sweep.
   if(shape.angle===0)return EMPTY;
   const a=Math.min(Math.abs(shape.angle),360)*Math.PI/180,[lo,hi]=shape.angle>0?[0,a]:[-a,0];
   const at=(t:number)=>dx*Math.cos(t)+dy*Math.sin(t),phi=Math.atan2(dy,dx),within=(t:number)=>a>=2*Math.PI-1e-12||[t-2*Math.PI,t,t+2*Math.PI].some(u=>u>=lo&&u<=hi);
   const cmax=within(phi)?radial:Math.max(at(lo),at(hi)),cmin=within(phi+Math.PI)?-radial:Math.min(at(lo),at(hi));
   const s=maxOf([profileSupport(shape.profile,[cmax,dz]),profileSupport(shape.profile,[cmin,dz])]),inside=profileSupport(shape.profile,[-1,0]);
   return {value:s.value,exact:s.exact&&inside.exact&&inside.value<=tol(0)};
  }
  case 'move':{const s=shapeSupport(shape.shape,d);return {value:s.value+dot3(d,shape.vector),exact:s.exact};}
  case 'scale':return shapeSupport(shape.shape,[dx*shape.vector[0],dy*shape.vector[1],dz*shape.vector[2]]);
  case 'rotate':{
   // Fixed-axis X, then Y, then Z: R = Rz·Ry·Rx, so Rᵀd = Rxᵀ(Ryᵀ(Rzᵀd)).
   let v:V3=d;for(const [axis,angle] of [[[0,0,1],shape.vector[2]],[[0,1,0],shape.vector[1]],[[1,0,0],shape.vector[0]]] as [V3,number][])if(angle)v=transposed(axisMatrix(axis,angle),v);
   return shapeSupport(shape.shape,v);
  }
  case 'axisRotate':return shapeSupport(shape.shape,transposed(axisMatrix(shape.vector,shape.angle),d));
  case 'mirror':{const l=Math.hypot(...shape.vector);if(l<1e-12)return shapeSupport(shape.shape,d);const n=shape.vector.map(v=>v/l),k=2*dot3(n,d);return shapeSupport(shape.shape,[dx-k*n[0],dy-k*n[1],dz-k*n[2]]);}
  case 'affine':{const m=shape.matrix,s=shapeSupport(shape.shape,transposed([m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]],d));return {value:s.value+dx*m[3]+dy*m[7]+dz*m[11],exact:s.exact};}
  case 'repeat':{if(shape.count<1)return EMPTY;const s=shapeSupport(shape.shape,d);return {value:s.value+Math.max(0,(shape.count-1)*dot3(d,shape.step)),exact:s.exact};}
  case 'union':case 'hull':return maxOf(shape.shapes.map(c=>shapeSupport(c,d)));
  case 'subtract':return cut(shape.shapes.map(c=>shapeSupport(c,d)));
  case 'intersect':return meet(shape.shapes.map(c=>shapeSupport(c,d)));
  case 'minkowski':return sum(shape.shapes.map(c=>shapeSupport(c,d)));
  default:return UNKNOWN;
 }
}

/** Bounds of the modelled solid per side: a number where it is guaranteed exact, undefined where
 * it is not (or the shape is empty). `limit` always holds the guaranteed one-sided bound: the true
 * minimum is at least `limit.min[i]`, the true maximum at most `limit.max[i]`. */
export function shapeBoundsBySide(shape:CodeShape):{min:(number|undefined)[];max:(number|undefined)[];limit:{min:number[];max:number[]}}{
 const min:(number|undefined)[]=[],max:(number|undefined)[]=[],limit={min:[] as number[],max:[] as number[]};
 for(let i=0;i<3;i++){
  const e:V3=[0,0,0];e[i]=1;const hi=shapeSupport(shape,e);e[i]=-1;const lo=shapeSupport(shape,e);
  max.push(hi.exact&&Number.isFinite(hi.value)?hi.value:undefined);min.push(lo.exact&&Number.isFinite(lo.value)?-lo.value:undefined);
  limit.max.push(hi.value);limit.min.push(-lo.value);
 }
 return {min,max,limit};
}
/** Exact bounds of the modelled solid, or undefined when some side cannot be guaranteed. */
export function exactShapeBounds(shape:CodeShape):{min:V3;max:V3}|undefined{
 const {min,max}=shapeBoundsBySide(shape);
 return [...min,...max].every(v=>v!==undefined)?{min:min as V3,max:max as V3}:undefined;
}
