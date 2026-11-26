// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {Vec3} from './document.js';

/** True when the side quad a-b-c-d (a, b on one section, d, c above them) is not planar: its
 * two sections are turned against each other there, so the two diagonals give different solids. */
export function twistedLoftQuad(a:Vec3,b:Vec3,c:Vec3,d:Vec3):boolean{
 const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],w=[d[0]-a[0],d[1]-a[1],d[2]-a[2]];
 const det=u[0]*(v[1]*w[2]-v[2]*w[1])-u[1]*(v[0]*w[2]-v[2]*w[0])+u[2]*(v[0]*w[1]-v[1]*w[0]);
 return Math.abs(det)>1e-9*Math.hypot(...u)*Math.hypot(...v)*Math.hypot(...w);
}
/** Matching, simple XY rings, connected in authored vertex order. No resampling.
 *
 * `ruled` selects the side surface (CAD Script revision 2, see docs/CODE-MODE.md#matched-section-lofts).
 * Revision 1 (`ruled` false) splits every side quad into two triangles along the diagonal from
 * section vertex j to the next section's vertex j+1, as JSCAD's `extrudeFromSlices` does; that is
 * frozen, so saved revision-1 programs keep their geometry. Revision 2 means the ruled
 * (bilinear) surface through each quad: planar quads keep the same two triangles, a twisted quad
 * becomes four triangles fanned around the mean of its corners, which has exactly the ruled
 * surface's volume. Then `ruled` in the result holds the normalized sections, so a backend with
 * true ruled surfaces (the exact kernel) can build them instead of the facets. */
export function loftPolyhedron(input:readonly (readonly Vec3[])[],ruled=false):{points:Vec3[];faces:number[][];ruled?:Vec3[][]}{
 return loftMesh(checkLoftSections(input).sections,ruled);
}
/** Validate loft sections and normalize them to ascending Z and counter-clockwise winding (the
 * vertex correspondence is kept). `descending` and `clockwise` say what was reversed. */
function checkLoftSections(input:readonly (readonly Vec3[])[],pairBudget=131072):{sections:Vec3[][];descending:boolean;clockwise:boolean}{
 const invalid=()=>{throw new Error(t('Loft needs matching planar XY sections ordered along Z'));};
 const topology=()=>{throw new Error(t('Loft sections must be simple and have consistent winding'));};
 const count=input[0]?.length??0;
 if(input.length<2||count<3||input.some(r=>r.length!==count))invalid();
 const sections=input.map(r=>r.map(p=>[...p] as Vec3));let winding=0,pairs=0;
 for(const ring of sections){
  if(ring.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>100000)))invalid();
  const extent=Math.max(1,...ring.flatMap(p=>p.map((v,i)=>Math.abs(v-ring[0][i])))),eps=extent*extent*1e-12;
  if(ring.some(p=>Math.abs(p[2]-ring[0][2])>extent*1e-9))invalid();
  const origin=ring[0],area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%count];return sum+(p[0]-origin[0])*(q[1]-origin[1])-(q[0]-origin[0])*(p[1]-origin[1]);},0);
  if(Math.abs(area)<=eps||winding&&Math.sign(area)!==winding)topology();winding=Math.sign(area);
  const cross=(a:Vec3,b:Vec3,c:Vec3)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<count;i++){
   const a=ring[i],b=ring[(i+1)%count];if(Math.hypot(a[0]-b[0],a[1]-b[1])<extent*1e-10)topology();
   for(let j=i+2;j<count;j++){
    if(i===0&&j===count-1)continue;if(++pairs>pairBudget)throw new Error(t('Loft exceeds the section or vertex budget'));
    const c=ring[j],d=ring[(j+1)%count],overlap=[0,1].every(k=>Math.max(Math.min(a[k],b[k]),Math.min(c[k],d[k]))<=Math.min(Math.max(a[k],b[k]),Math.max(c[k],d[k]))+extent*1e-10);
    if(overlap&&cross(a,b,c)*cross(a,b,d)<=eps*eps&&cross(c,d,a)*cross(c,d,b)<=eps*eps)topology();
   }
  }
 }
 const direction=Math.sign(sections[1][0][2]-sections[0][0][2]);
 if(!direction||sections.some((r,i)=>i>0&&(r[0][2]-sections[i-1][0][2])*direction<=1e-9))invalid();
 if(direction<0)sections.reverse();if(winding<0)sections.forEach(r=>r.reverse());
 return {sections,descending:direction<0,clockwise:winding<0};
}
/** Side faces between consecutive normalized sections (ascending Z, counter-clockwise) and the caps. */
function loftMesh(sections:Vec3[][],ruled:boolean):{points:Vec3[];faces:number[][];ruled?:Vec3[][]}{
 const count=sections[0].length;
 const points=sections.flat(),faces:number[][]=[Array.from({length:count},(_,i)=>count-1-i)];
 for(let s=0;s<sections.length-1;s++)for(let j=0;j<count;j++){
  const a=s*count+j,b=s*count+(j+1)%count,c=b+count,d=a+count;
  if(ruled&&twistedLoftQuad(points[a],points[b],points[c],points[d])){
   const m=points.length;points.push([0,1,2].map(k=>(points[a][k]+points[b][k]+points[c][k]+points[d][k])/4) as Vec3);
   faces.push([a,b,m],[b,c,m],[c,d,m],[d,a,m]);
  }else faces.push([a,b,c],[a,c,d]);
 }
 const ringPoints=sections.length*count,twisted=points.length>ringPoints;
 faces.push(Array.from({length:count},(_,i)=>ringPoints-count+i));return twisted?{points,faces,ruled:sections}:{points,faces};
}

/** Chord sag of the smooth-loft mesh, as a fraction of the smallest section's XY diagonal. */
export const SMOOTH_LOFT_TOLERANCE=1e-4;
/** At most this many slices between two consecutive breakpoints (knots and section parameters). */
const SMOOTH_LOFT_MAX_SLICES=256;
/** One B-spline curve per section vertex through that vertex of every section (`smoothLoft`).
 * `control[i]` are the control points of vertex i's curve; all curves share degree, knots and the
 * section parameters `params`, and so the same Z at every parameter. */
export interface SmoothLoftCurves {degree:number;knots:number[];params:number[];control:Vec3[][]}
function findSpan(knots:readonly number[],degree:number,count:number,v:number):number{
 if(v>=knots[count])return count-1;
 let low=degree,high=count;
 while(high-low>1){const mid=(low+high)>>1;if(v<knots[mid])high=mid;else low=mid;}
 return low;
}
/** The degree+1 non-zero basis functions at v on `span` (Piegl & Tiller, A2.2). */
function basisFunctions(knots:readonly number[],degree:number,span:number,v:number):number[]{
 const N=[1],left=[0],right=[0];
 for(let j=1;j<=degree;j++){
  left[j]=v-knots[span+1-j];right[j]=knots[span+j]-v;let saved=0;
  for(let r=0;r<j;r++){const temp=N[r]/(right[r+1]+left[j-r]);N[r]=saved+right[r+1]*temp;saved=left[j-r]*temp;}
  N[j]=saved;
 }
 return N;
}
function evaluateCurve(control:readonly (readonly number[])[],knots:readonly number[],degree:number,v:number,span=findSpan(knots,degree,control.length,v)):number[]{
 const N=basisFunctions(knots,degree,span,v),out=control[0].map(()=>0);
 for(let r=0;r<=degree;r++)for(let k=0;k<out.length;k++)out[k]+=N[r]*control[span-degree+r][k];
 return out;
}
/** The derivative of a clamped B-spline: degree-1 with the inner knots. */
function derivativeCurve(control:readonly (readonly number[])[],knots:readonly number[],degree:number):{control:number[][];knots:number[];degree:number}{
 const out=control.slice(0,-1).map((p,i)=>{const d=knots[i+degree+1]-knots[i+1];return p.map((v,k)=>d>0?degree*(control[i+1][k]-v)/d:0);});
 return {control:out,knots:knots.slice(1,-1),degree:degree-1};
}
/** Solve A X = B (A square, B with several columns) by Gaussian elimination with partial pivoting. */
function solveLinear(A:number[][],B:number[][]):number[][]{
 const n=A.length,M=A.map((row,i)=>[...row,...B[i]]),width=M[0].length;
 for(let c=0;c<n;c++){
  let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
  [M[c],M[p]]=[M[p],M[c]];const pivot=M[c][c];
  for(let r=c+1;r<n;r++){const f=M[r][c]/pivot;if(f)for(let j=c;j<width;j++)M[r][j]-=f*M[c][j];}
 }
 const X=B.map(row=>row.map(()=>0));
 for(let r=n-1;r>=0;r--)for(let k=0;k<X[0].length;k++){let s=M[r][n+k];for(let j=r+1;j<n;j++)s-=M[r][j]*X[j][k];X[r][k]=s/M[r][r];}
 return X;
}
/** The curves of `smoothLoft` through sections in authored order (vertex i joined to vertex i),
 * as the exact kernel's (SMLib's) smooth loft builds them, so that both agree:
 *  - degree min(3, sections - 1): two sections give the ruled loft, three a quadratic;
 *  - section parameters by chord length: each vertex's cumulative 3D distance from section to
 *    section, normalized to 0..1, averaged over the vertices; the vertex before the last
 *    (authored index count - 2, where the kernel starts and closes the section curve) counts twice;
 *  - knots by averaging those parameters (Piegl & Tiller 9.8), clamped;
 *  - global interpolation: the curve passes through every section's vertex at its parameter. */
export function smoothLoftCurves(sections:readonly (readonly Vec3[])[]):SmoothLoftCurves{
 const n=sections.length,count=sections[0].length,degree=Math.min(3,n-1);
 const params=new Array<number>(n).fill(0);
 for(let i=0;i<count;i++){
  const weight=i===count-2?2:1,cumulative=[0];
  for(let k=1;k<n;k++){const a=sections[k-1][i],b=sections[k][i];cumulative.push(cumulative[k-1]+Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]));}
  const total=cumulative[n-1];for(let k=1;k<n;k++)params[k]+=weight*cumulative[k]/total;
 }
 for(let k=1;k<n;k++)params[k]/=count+1;params[n-1]=1;
 const knots=new Array<number>(degree+1).fill(0);
 for(let j=1;j<n-degree;j++){let s=0;for(let i=j;i<j+degree;i++)s+=params[i];knots.push(s/degree);}
 knots.push(...new Array<number>(degree+1).fill(1));
 const A=params.map(v=>{const row=new Array<number>(n).fill(0),span=findSpan(knots,degree,n,v);basisFunctions(knots,degree,span,v).forEach((b,r)=>row[span-degree+r]=b);return row;});
 const B=sections.map(ring=>ring.flatMap(p=>[p[0],p[1],p[2]]));
 const X=solveLinear(A,B);
 const control=Array.from({length:count},(_,i)=>X.map(row=>[row[3*i],row[3*i+1],row[3*i+2]] as Vec3));
 return {degree,knots,params,control};
}
/** The ring of the smooth loft at parameter v (authored vertex order). */
export function smoothLoftRing(curves:SmoothLoftCurves,v:number):Vec3[]{
 const span=findSpan(curves.knots,curves.degree,curves.control[0].length,v);
 return curves.control.map(c=>evaluateCurve(c,curves.knots,curves.degree,v,span) as Vec3);
}
/** Distinct knot values: the polynomial pieces of the curves are [b_i, b_i+1]. */
function breakpoints(curves:SmoothLoftCurves):number[]{return [...new Set(curves.knots)];}
const GAUSS5:[number,number][]=[[0,128/225],[-Math.sqrt(5-2*Math.sqrt(10/7))/3,(322+13*Math.sqrt(70))/900],[Math.sqrt(5-2*Math.sqrt(10/7))/3,(322+13*Math.sqrt(70))/900],[-Math.sqrt(5+2*Math.sqrt(10/7))/3,(322-13*Math.sqrt(70))/900],[Math.sqrt(5+2*Math.sqrt(10/7))/3,(322-13*Math.sqrt(70))/900]];
/** Exact volume of the smooth loft's solid: the integral of ring area times dz/dv, a polynomial of
 * degree at most 8 on each knot span, integrated by 5-point Gauss-Legendre (exact). */
export function smoothLoftVolume(curves:SmoothLoftCurves):number{
 const z=derivativeCurve(curves.control[0].map(p=>[p[2]]),curves.knots,curves.degree),b=breakpoints(curves);let volume=0;
 for(let s=0;s+1<b.length;s++){
  const a=b[s],h=b[s+1]-a;
  for(const [x,w] of GAUSS5){
   const v=a+h*(x+1)/2,ring=smoothLoftRing(curves,v),dz=evaluateCurve(z.control,z.knots,z.degree,v,findSpan(z.knots,z.degree,z.control.length,v))[0];
   let area=0;for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];area+=p[0]*q[1]-q[0]*p[1];}
   volume+=w*h/2*area/2*dz;
  }
 }
 return Math.abs(volume);
}
/** `smoothLoft([section0, section1, ...])`: the sections of `loft`, joined by the smooth surface
 * of {@link smoothLoftCurves} instead of ruled sides. Two sections give the ruled loft.
 *
 * Each side face of the surface is ruled across (straight between vertex i and i+1 at every
 * parameter) and curved along the loft, and every ring of constant parameter is a planar polygon
 * at one Z. The mesh slices the surface at the section parameters, at every knot, and between
 * them often enough that the chord sag along each vertex curve is at most
 * SMOOTH_LOFT_TOLERANCE times the smallest section's XY diagonal (h²/8 · max |C''| on each
 * polynomial piece, at most 256 slices per piece); consecutive slices are joined like ruled loft
 * sections (twisted quads fan around their centre). The result is closed and manifold. The
 * surface must rise along Z throughout and every slice must stay a simple polygon; otherwise the
 * loft is refused. `smooth` holds the sections as authored, for backends that build the surface. */
export function smoothLoftPolyhedron(input:readonly (readonly Vec3[])[]):{points:Vec3[];faces:number[][];ruled?:Vec3[][];smooth?:Vec3[][]}{
 const checked=checkLoftSections(input);
 if(input.length===2)return loftMesh(checked.sections,true);
 const authored=input.map(r=>r.map(p=>[...p] as Vec3)),curves=smoothLoftCurves(authored),count=authored[0].length;
 const folds=()=>{throw new Error(t('Smooth loft folds back along Z; space its sections further apart or reduce their offsets'));};
 // Z is the same curve for every vertex (all sections are planar): it must be monotonic.
 const zCurve=curves.control[0].map(p=>[p[2]]),direction=Math.sign(authored[1][0][2]-authored[0][0][2]),dz=derivativeCurve(zCurve,curves.knots,curves.degree);
 const pieces=breakpoints(curves),scale=Math.abs(authored.at(-1)![0][2]-authored[0][0][2]);
 for(let s=0;s+1<pieces.length;s++){
  const a=pieces[s],b=pieces[s+1],span=findSpan(dz.knots,dz.degree,dz.control.length,(a+b)/2),at=(v:number)=>direction*evaluateCurve(dz.control,dz.knots,dz.degree,v,span)[0];
  // dz/dv is at most quadratic on the piece: check both ends and an interior extremum.
  const f0=at(a),fm=at((a+b)/2),f1=at(b),c2=2*(f0-2*fm+f1),c1=fm*4-3*f0-f1,candidates=[f0,f1];
  if(c2>0){const x=-c1/(2*c2);if(x>0&&x<1)candidates.push(at(a+(b-a)*x));}
  if(Math.min(...candidates)<=1e-9*scale)folds();
 }
 const smallest=Math.min(...authored.map(r=>Math.hypot(Math.max(...r.map(p=>p[0]))-Math.min(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))-Math.min(...r.map(p=>p[1]))))),tolerance=SMOOTH_LOFT_TOLERANCE*smallest;
 const vertexSecond=curves.control.map(c=>{const d1=derivativeCurve(c,curves.knots,curves.degree);return d1.degree>=1?derivativeCurve(d1.control,d1.knots,d1.degree):undefined;});
 // Slice parameters: every piece boundary and section parameter, then subdivided.
 const stops=[...new Set([...pieces,...curves.params])].sort((x,y)=>x-y),sectionAt=new Map(curves.params.map((v,k)=>[v,k]));
 const slices:number[]=[];
 for(let s=0;s+1<stops.length;s++){
  const a=stops[s],b=stops[s+1];let curvature=0;
  for(const d2 of vertexSecond){if(!d2)continue;const span=findSpan(d2.knots,d2.degree,d2.control.length,(a+b)/2);for(const v of [a,b])curvature=Math.max(curvature,Math.hypot(...evaluateCurve(d2.control,d2.knots,d2.degree,v,span)));}
  const n=Math.min(SMOOTH_LOFT_MAX_SLICES,Math.max(1,Math.ceil((b-a)*Math.sqrt(curvature/(8*tolerance)))));
  for(let q=0;q<n;q++)slices.push(a+(b-a)*q/n);
 }
 slices.push(1);
 if(4*count*(slices.length-1)+2>200000)throw new Error(t('Estimated mesh budget exceeds 200000 faces'));
 const rings=slices.map(v=>sectionAt.has(v)?authored[sectionAt.get(v)!]:smoothLoftRing(curves,v));
 // Every slice must be a simple polygon wound like the sections (the sections already are).
 let normalized:Vec3[][];
 try{normalized=checkLoftSections(rings,Number.POSITIVE_INFINITY).sections;}catch{throw new Error(t('Smooth loft surface crosses itself between its sections'));}
 const {points,faces}=loftMesh(normalized,true);
 return {points,faces,smooth:authored};
}
/** The largest d · p over the smooth surface (its support in direction d): each side is straight
 * between two vertex curves at every parameter, so it is the largest d · C_i(v), found on each
 * polynomial piece at its ends and where the derivative (at most quadratic) vanishes. */
export function smoothLoftSupport(curves:SmoothLoftCurves,d:readonly [number,number,number]):number{
 const pieces=breakpoints(curves);let best=-Infinity;
 for(const control of curves.control){
  const f=control.map(p=>[p[0]*d[0]+p[1]*d[1]+p[2]*d[2]]),df=derivativeCurve(f,curves.knots,curves.degree);
  for(let s=0;s+1<pieces.length;s++){
   const a=pieces[s],b=pieces[s+1],span=findSpan(curves.knots,curves.degree,f.length,(a+b)/2),dspan=findSpan(df.knots,df.degree,df.control.length,(a+b)/2);
   const value=(v:number)=>evaluateCurve(f,curves.knots,curves.degree,v,span)[0],slope=(x:number)=>evaluateCurve(df.control,df.knots,df.degree,a+(b-a)*x,dspan)[0];
   best=Math.max(best,value(a),value(b));
   // slope(x) = c0 + c1 x + c2 x² on x in [0, 1]
   const s0=slope(0),sm=slope(.5),s1=slope(1),c2=2*(s0-2*sm+s1),c1=4*sm-3*s0-s1,c0=s0;
   const roots=Math.abs(c2)>1e-15*(Math.abs(c1)+Math.abs(c0)+1e-300)?(()=>{const disc=c1*c1-4*c2*c0;if(disc<0)return [];const r=Math.sqrt(disc);return [(-c1-r)/(2*c2),(-c1+r)/(2*c2)];})():Math.abs(c1)>0?[-c0/c1]:[];
   for(const x of roots)if(x>0&&x<1)best=Math.max(best,value(a+(b-a)*x));
  }
 }
 return best;
}
