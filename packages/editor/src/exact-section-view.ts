// SPDX-License-Identifier: BSD-3-Clause
// A section view drawn from exact cut faces (the `section` exact request): per body and leg, the
// edges of the cut face as lines, circular arcs and elliptical arcs in the section's plane
// coordinates (the across axis and Z), clipped to the leg's span between its jogs. The outline is
// drawn from those curves exactly (circles as arcs, ellipses as ellipses); the hatching is cut
// against them sampled within 0.001 mm; where two legs meet at a jog, the jog line is drawn only
// where one leg has material and the other has none.
import type {ExactSectionData,SketchPoint,Vec3} from '@brickwright/cad-core';
import {assemblyCutJogs} from '@brickwright/cad-geometry';
import type {AssemblyCut} from '@brickwright/cad-geometry';
import {canonicalEllipse} from './drawing-conic.js';
import type {DrawingLayout} from './drawing-page.js';
import {exactEdgeConic} from './exact-drawing-projection.js';

/** A cut-face curve in plane coordinates (u: the across axis, v: Z), model millimetres. */
export type SectionCurve=
 |{kind:'line';a:SketchPoint;b:SketchPoint}
 |{kind:'conic';center:SketchPoint;A:SketchPoint;B:SketchPoint;radius?:number;from:number;to:number}
 |{kind:'polyline';points:SketchPoint[]};
export type ExactSectionLeg={lo:number;hi:number;curves:SectionCurve[]};
export type ExactSectionBodyCurves={id:string;legs:ExactSectionLeg[]};

const SAMPLE_TOLERANCE=1e-3;

/** The curves of each body's cut faces, leg by leg, with each leg's span along the across axis. */
export function exactSectionCurves(data:ExactSectionData,cut:AssemblyCut):ExactSectionBodyCurves[]{
 const across=cut.axis===0?1:0,jogs=assemblyCutJogs(cut);
 const plane=(p:readonly number[]):SketchPoint=>[p[across],p[2]];
 return data.bodies.map(body=>({id:body.id,legs:body.legs.map((edges,i)=>({
  lo:i?jogs[i-1].at:-Infinity,hi:i<jogs.length?jogs[i].at:Infinity,
  curves:edges.map((edge):SectionCurve=>{
   const count=edge.points.length/3,point=(k:number)=>plane(edge.points.slice(3*k,3*k+3));
   if(edge.curve==='line')return {kind:'line',a:point(0),b:point(count-1)};
   const conic=exactEdgeConic(edge,edge.surfaces);
   if(conic){
    const map=(v:Vec3):SketchPoint=>[v[across],v[2]];
    return {kind:'conic',center:map(conic.center),A:map(conic.U),B:map(conic.V),...(conic.radius!==undefined?{radius:conic.radius}:{}),from:0,to:conic.sweep};
   }
   return {kind:'polyline',points:Array.from({length:count},(_,k)=>point(k))};
  }),
 }))}));
}

const conicAt=(c:Extract<SectionCurve,{kind:'conic'}>,a:number):SketchPoint=>[c.center[0]+c.A[0]*Math.cos(a)+c.B[0]*Math.sin(a),c.center[1]+c.A[1]*Math.cos(a)+c.B[1]*Math.sin(a)];

/** The parts of a curve with lo ≤ u ≤ hi. */
export function clipSectionCurve(curve:SectionCurve,lo:number,hi:number):SectionCurve[]{
 const within=(u:number)=>u>=lo-1e-9&&u<=hi+1e-9;
 if(curve.kind==='line'){
  const {a,b}=curve,du=b[0]-a[0];
  let s=0,e=1;
  if(Math.abs(du)<1e-15){if(!within(a[0]))return [];}
  else{
   const t0=(lo-a[0])/du,t1=(hi-a[0])/du;
   s=Math.max(0,Math.min(t0,t1));e=Math.min(1,Math.max(t0,t1));
  }
  if(e-s<=1e-12)return [];
  const at=(t:number):SketchPoint=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  return [{kind:'line',a:at(s),b:at(e)}];
 }
 if(curve.kind==='polyline'){
  const out:SectionCurve[]=[];
  for(let i=0;i+1<curve.points.length;i++)out.push(...clipSectionCurve({kind:'line',a:curve.points[i],b:curve.points[i+1]},lo,hi));
  return out;
 }
 // u(a) = cu + Au cos a + Bu sin a crosses a bound where R cos(a − φ) = bound − cu.
 const {center,A,B,from,to}=curve,R=Math.hypot(A[0],B[0]),phi=Math.atan2(B[0],A[0]);
 const [start,end]=from<=to?[from,to]:[to,from],cuts=[start,end];
 for(const bound of [lo,hi])if(Number.isFinite(bound)&&R>1e-15){
  const c=(bound-center[0])/R;
  if(Math.abs(c)>1)continue;
  for(const base of [phi+Math.acos(c),phi-Math.acos(c)])for(let k=-2;k<=2;k++){
   const a=base+2*Math.PI*k;
   if(a>start+1e-12&&a<end-1e-12)cuts.push(a);
  }
 }
 cuts.sort((x,y)=>x-y);
 const out:SectionCurve[]=[];
 for(let i=0;i+1<cuts.length;i++){
  if(cuts[i+1]-cuts[i]<=1e-12||!within(conicAt(curve,(cuts[i]+cuts[i+1])/2)[0]))continue;
  const last=out.at(-1);
  if(last?.kind==='conic'&&Math.abs(last.to-cuts[i])<1e-12)last.to=cuts[i+1];
  else out.push({...curve,from:cuts[i],to:cuts[i+1]});
 }
 return out;
}

/** Straight pieces of a curve, close enough to it for hatching. */
function sample(curve:SectionCurve):[SketchPoint,SketchPoint][]{
 if(curve.kind==='line')return [[curve.a,curve.b]];
 if(curve.kind==='polyline')return curve.points.slice(1).map((p,i)=>[curve.points[i],p]);
 const r=Math.max(Math.hypot(...curve.A),Math.hypot(...curve.B)),sweep=Math.abs(curve.to-curve.from);
 const step=2*Math.acos(Math.max(-1,1-SAMPLE_TOLERANCE/Math.max(r,1e-9)));
 const count=Math.min(4096,Math.max(2,Math.ceil(sweep/Math.max(step,1e-6))));
 const points=Array.from({length:count+1},(_,i)=>conicAt(curve,curve.from+(curve.to-curve.from)*i/count));
 return points.slice(1).map((p,i)=>[points[i],p]);
}

/** Intervals of v where the vertical line u = x lies inside the region bounded by `segments`. */
function insideAlong(segments:[SketchPoint,SketchPoint][],x:number):[number,number][]{
 const hits:number[]=[];
 for(const [a,b] of segments){
  if((a[0]>x)===(b[0]>x))continue;
  hits.push(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));
 }
 hits.sort((p,q)=>p-q);
 const out:[number,number][]=[];
 for(let i=1;i<hits.length;i+=2)if(hits[i]-hits[i-1]>1e-9)out.push([hits[i-1],hits[i]]);
 return out;
}
const minus=(a:[number,number][],b:[number,number][])=>a.flatMap(([s,e])=>{
 let parts:[number,number][]=[[s,e]];
 for(const [x,y] of b)parts=parts.flatMap(([p,q])=>y<=p||x>=q?[[p,q] as [number,number]]:[...(x>p?[[p,x] as [number,number]]:[]),...(y<q?[[y,q] as [number,number]]:[])]);
 return parts;
});

/**
 * Draw one body's exact section: outline curves clipped to each leg, jog lines where material
 * starts or ends at a jog, and hatching (slope ±45° by body, 3 mm apart on paper).
 * `paper` maps plane coordinates to the sheet.
 */
export function drawExactSectionBody(page:DrawingLayout,body:ExactSectionBodyCurves,index:number,paper:(p:SketchPoint)=>SketchPoint,factor:number){
 const slope=index%2?-1:1;
 for(const leg of body.legs){
  for(const curve of leg.curves)for(const piece of clipSectionCurve(curve,leg.lo,leg.hi)){
   if(piece.kind==='line'){page.paths.push({stroke:'section',points:[paper(piece.a),paper(piece.b)]});continue;}
   if(piece.kind==='polyline'){page.paths.push({stroke:'section',points:piece.points.map(paper)});continue;}
   const center=paper(piece.center),A:SketchPoint=[piece.A[0]*factor,piece.A[1]*factor],B:SketchPoint=[piece.B[0]*factor,piece.B[1]*factor];
   const full=Math.abs(piece.to-piece.from)>=2*Math.PI-1e-9;
   if(piece.radius!==undefined){
    // A circle: angles on paper from its points (u and v map to x and y without a turn).
    const handed=Math.sign(A[0]*B[1]-A[1]*B[0])||1,base=Math.atan2(A[1],A[0]);
    const s=base+handed*piece.from,e=base+handed*piece.to;
    page.circles.push({center,radius:piece.radius*factor,...(full?{}:{arc:{start:Math.min(s,e),sweep:Math.abs(e-s)}})});
    continue;
   }
   const form=canonicalEllipse(A,B);
   if(!form){const pieces=sample(piece);page.paths.push({stroke:'section',points:[pieces[0][0],...pieces.map(([,b])=>b)].map(paper)});continue;}
   const s=form.toT(piece.from),e=form.toT(piece.to);
   (page.ellipses??=[]).push({center,major:form.major,ratio:form.ratio,start:Math.min(s,e),sweep:full?2*Math.PI:Math.abs(e-s)});
  }
 }
 // Jog lines: at each jog, where exactly one of the two legs has material.
 const legSegments=body.legs.map(leg=>leg.curves.flatMap(sample));
 for(let i=0;i+1<body.legs.length;i++){
  const x=body.legs[i].hi,before=insideAlong(legSegments[i],x-1e-7),after=insideAlong(legSegments[i+1],x+1e-7);
  for(const [s,e] of [...minus(before,after),...minus(after,before)])if(e-s>1e-6)page.paths.push({stroke:'section',points:[paper([x,s]),paper([x,e])]});
 }
 // Hatching: lines x − slope·y = c on paper, cut by each leg's region and clipped to its span.
 const across=(p:SketchPoint)=>p[0]-slope*p[1];
 for(const [i,leg] of body.legs.entries()){
  const segments=legSegments[i].map(([a,b]):[SketchPoint,SketchPoint]=>[paper(a),paper(b)]);
  if(!segments.length)continue;
  const left=Number.isFinite(leg.lo)?paper([leg.lo,0])[0]:-Infinity,right=Number.isFinite(leg.hi)?paper([leg.hi,0])[0]:Infinity;
  let min=Infinity,max=-Infinity;
  for(const [a,b] of segments)for(const p of [a,b]){const c=across(p);min=Math.min(min,c);max=Math.max(max,c);}
  for(let intercept=Math.ceil(min/3)*3;intercept<max;intercept+=3){
   const xs:number[]=[];
   for(const [a,b] of segments){
    const ca=across(a),cb=across(b);
    if((ca>intercept)===(cb>intercept))continue;
    xs.push(a[0]+(b[0]-a[0])*(intercept-ca)/(cb-ca));
   }
   xs.sort((p,q)=>p-q);
   for(let k=1;k<xs.length;k+=2){
    const l=Math.max(xs[k-1],left),r=Math.min(xs[k],right);
    if(r-l>1e-6)page.paths.push({stroke:'hatch',points:[[l,slope*(l-intercept)],[r,slope*(r-intercept)]]});
   }
  }
 }
}
