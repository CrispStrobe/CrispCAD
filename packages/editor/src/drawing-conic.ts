// SPDX-License-Identifier: BSD-3-Clause
// Ellipses on a drawing sheet. A circle seen at an angle, or a cylinder cut by an oblique plane,
// projects to P(θ) = C + A cos θ + B sin θ with conjugate semi-diameters A and B. A sheet stores
// the canonical form instead, the one DXF's ELLIPSE entity takes: the major semi-axis M, the
// ratio of minor to major, and a parameter t that runs counter-clockwise on paper with
// P(t) = C + M cos t + N sin t, N = ratio · (M turned by 90°). Every writer draws that form exactly
// (SVG elliptical arcs, DXF ELLIPSE) or as the affine image of a circle's Bézier arcs (PDF), whose
// error is the circle approximation's, at most 2.7e-4 of the major semi-axis.
import type {SketchPoint} from '@brickwright/cad-core';

/** An elliptical arc from `start` through `sweep` (radians, counter-clockwise, sweep > 0). */
export type DrawingEllipse={center:SketchPoint;major:SketchPoint;ratio:number;start:number;sweep:number;hidden?:true};

const dot=(a:SketchPoint,b:SketchPoint)=>a[0]*b[0]+a[1]*b[1];
const length=(a:SketchPoint)=>Math.hypot(a[0],a[1]);

/**
 * The canonical form of P(θ) = A cos θ + B sin θ (about the centre): the major semi-axis, the
 * ratio, and t(θ). `reversed` is true when t runs against θ, so an arc from θ0 to θ1 is the arc
 * from t(θ1) to t(θ0). Undefined for a degenerate (line) ellipse.
 */
export function canonicalEllipse(A:SketchPoint,B:SketchPoint){
 let shift=.5*Math.atan2(2*dot(A,B),dot(A,A)-dot(B,B));
 let M:SketchPoint=[A[0]*Math.cos(shift)+B[0]*Math.sin(shift),A[1]*Math.cos(shift)+B[1]*Math.sin(shift)];
 let N:SketchPoint=[-A[0]*Math.sin(shift)+B[0]*Math.cos(shift),-A[1]*Math.sin(shift)+B[1]*Math.cos(shift)];
 // P = M cos(θ − shift) + N sin(θ − shift); make M the longer one.
 if(length(N)>length(M)){[M,N]=[N,[-M[0],-M[1]]];shift+=Math.PI/2;}
 const major=length(M);
 if(!(major>1e-12))return undefined;
 const ratio=Math.min(1,length(N)/major);
 if(ratio<1e-9)return undefined;
 // Counter-clockwise: N on the left of M; otherwise t = −(θ − shift).
 const reversed=M[0]*N[1]-M[1]*N[0]<0;
 let offset=0;
 // One direction for M (x > 0, or y > 0 on the vertical), so equal ellipses have equal forms.
 if(M[0]<-1e-12||Math.abs(M[0])<=1e-12&&M[1]<0){M=[-M[0],-M[1]];offset=Math.PI;}
 const toT=(theta:number)=>(reversed?-(theta-shift):theta-shift)+offset;
 return {major:M,ratio,reversed,toT};
}

/** A point of a canonical ellipse at parameter t. */
export function ellipsePoint(e:Pick<DrawingEllipse,'center'|'major'|'ratio'>,t:number):SketchPoint{
 const [mx,my]=e.major,nx=-my*e.ratio,ny=mx*e.ratio;
 return [e.center[0]+mx*Math.cos(t)+nx*Math.sin(t),e.center[1]+my*Math.cos(t)+ny*Math.sin(t)];
}

/** Cubic Bézier segments (at most a quarter turn each) of a circular arc of the unit circle,
 * as [x1,y1,x2,y2,x3,y3] control points after the start point. */
export function unitArcBeziers(start:number,sweep:number){
 const count=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/2)-1e-9)),step=sweep/count,k=4/3*Math.tan(step/4);
 return Array.from({length:count},(_,i)=>{
  const a=start+i*step,b=a+step;
  return [Math.cos(a)-k*Math.sin(a),Math.sin(a)+k*Math.cos(a),Math.cos(b)+k*Math.sin(b),Math.sin(b)-k*Math.cos(b),Math.cos(b),Math.sin(b)];
 });
}

/** The Bézier approximation of an elliptical arc: its start point and cubic segments. */
export function ellipseBeziers(e:DrawingEllipse){
 const [mx,my]=e.major,nx=-my*e.ratio,ny=mx*e.ratio,[cx,cy]=e.center;
 const map=(x:number,y:number):SketchPoint=>[cx+mx*x+nx*y,cy+my*x+ny*y];
 const start=map(Math.cos(e.start),Math.sin(e.start));
 const curves=unitArcBeziers(e.start,e.sweep).map(c=>[...map(c[0],c[1]),...map(c[2],c[3]),...map(c[4],c[5])]);
 return {start,curves};
}

/** SVG arc parameters of an ellipse in a y-down SVG frame (paper y flipped at `height`). */
export function svgEllipseArc(e:DrawingEllipse,height:number){
 const rx=length(e.major),ry=rx*e.ratio,rotation=-Math.atan2(e.major[1],e.major[0])*180/Math.PI;
 const point=(t:number)=>{const [x,y]=ellipsePoint(e,t);return [x,height-y] as SketchPoint;};
 return {rx,ry,rotation,point};
}
