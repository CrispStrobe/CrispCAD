// SPDX-License-Identifier: BSD-3-Clause
// Automatic dimensions on an assembly sheet drawn from exact edges: the overall size, hole positions
// (baseline dimensions from the left and bottom edges of the view that sees the hole end-on), hole
// callouts, and diameters and radii of the remaining circles and arcs. Values come from the exact
// B-rep (centres, radii, the exact bounding box), never from a mesh.
//
// Placement: each dimension is tried on the sides of its view in a preferred order, in tiers 8 mm
// from the view and 7 mm apart, and the first place where its line and text touch nothing already
// on the sheet (views, the isometric view, the section, texts, other dimensions, the frame) is
// taken. Leaders for callouts, diameters and radii try several directions and lengths the same
// way. What finds no room is left off and counted in a note, never drawn over something else.
//
// Hole callouts follow ISO 129-1 practice in words (Helvetica has no counterbore symbol): the
// count, the thread and kind, the bore and its depth or "thru", and the seat on a second line. A
// tapped hole is called out by its thread designation (ISO 965-1: M4×0.7 - 6H) and thread depth
// with the depth symbol, drawn as lines (drawing-symbols.ts), and its tap drill on the second line.
// Units are the sheet's millimetres (the frame says so), so values carry no unit.
import {THREADS,nodeWorldFrame,seatDepth,t} from '@brickwright/cad-core';
import type {CadDocument,HoleFeature,SketchPoint,Vec3} from '@brickwright/cad-core';
import {dimensionText} from './drawing-annotation.js';
import {drawingViews,recordDimension} from './drawing-page.js';
import type {DrawingDimension,DrawingLayout,DrawingPath,DrawingText} from './drawing-page.js';
import {DEPTH_SYMBOL,addSymbolText} from './drawing-symbols.js';
import type {ExactAssemblyProjection} from './exact-drawing-projection.js';

/** A paper rectangle; `text` marks one that lines must not cross. */
export type Box={l:number;b:number;r:number;t:number;text?:boolean};
/** What one automatic dimension pass placed, and what found no room. */
export type AutoDimensionReport={placed:number;omitted:number;callouts:number};

const TEXT=2.5,TIER=7,FIRST=8,GAP=1,OVERSHOOT=1.5,TIERS=4;
/** Helvetica's digits are 0.556 em wide; letters vary. A conservative width. */
export const textWidth=(text:string,size:number)=>[...text].length*size*.6;
const overlaps=(a:Box,b:Box)=>a.l<b.r&&a.r>b.l&&a.b<b.t&&a.t>b.b;
const grow=(a:Box,by:number):Box=>({l:a.l-by,b:a.b-by,r:a.r+by,t:a.t+by});
/** Where automatic dimensions may go: inside the frame, above the title block. */
const sheet:Box={l:10,b:28,r:287,t:200};
const inside=(a:Box)=>a.l>=sheet.l&&a.r<=sheet.r&&a.b>=sheet.b&&a.t<=sheet.t;
function segmentHits(a:SketchPoint,b:SketchPoint,box:Box){
 // Liang–Barsky: does the segment enter the box?
 let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1];
 for(const [p,q] of [[-dx,a[0]-box.l],[dx,box.r-a[0]],[-dy,a[1]-box.b],[dy,box.t-a[1]]] as const){
  if(Math.abs(p)<1e-12){if(q<0)return false;continue;}
  const r=q/p;
  if(p<0){if(r>hi)return false;if(r>lo)lo=r;}else{if(r<lo)return false;if(r<hi)hi=r;}
 }
 return hi-lo>1e-9;
}
export function textBox(text:{x:number;y:number;size:number;text:string;angle?:number}):Box{
 const w=textWidth(text.text,text.size);
 return text.angle===90?{l:text.x-text.size,b:text.y,r:text.x+.3,t:text.y+w}:{l:text.x,b:text.y-.3*text.size,r:text.x+w,t:text.y+text.size};
}

/** The callout of a standard hole: one or two lines, the count first (ISO 129-1 order). */
export function holeCallout(hole:HoleFeature,count:number):string[]{
 const n=count>1?t`${count}× `:'',d=dimensionText(hole.diameter),depth=dimensionText(hole.depth),thread=hole.standard.thread;
 const bore=hole.through?t`Ø${d} thru`:t`Ø${d} × ${depth} deep`;
 const fit=hole.standard.fit&&hole.standard.fit!=='normal'?' '+(hole.standard.fit==='close'?t('(close fit)'):t('(loose fit)')):'';
 switch(hole.standard.type){
  case 'clearance':return [n+t`${thread} clearance${fit} ${bore}`];
  case 'tapped':{
   // The thread runs the full depth of the hole (the hole node stores no separate thread length).
   const designation=`${thread}×${dimensionText(THREADS[thread].pitch)} - 6H`;
   return hole.through?[n+t`${designation} thru`,t`tap drill Ø${d} thru`]:[n+`${designation} ${DEPTH_SYMBOL} ${depth}`,t`tap drill Ø${d} ${DEPTH_SYMBOL} ${depth}`];
  }
  case 'counterbore':return [n+t`${thread} counterbore ${bore}`,t`c'bore Ø${dimensionText(hole.counterbore!.diameter)} × ${dimensionText(seatDepth(hole))} deep`];
  case 'countersink':return [n+t`${thread} countersink ${bore}`,t`c'sink Ø${dimensionText(hole.countersink!.diameter)} × ${dimensionText(hole.countersink!.angle)}°`];
  case 'heat-set':return [n+t`${thread} heat-set insert pocket ${bore}`];
 }
}

type Placement=readonly (readonly [unknown,number,number])[];
type Frame={left:number;bottom:number;width:number;height:number};

/**
 * Add automatic dimensions to an exact assembly sheet. `blocked` are areas already taken that the
 * page's texts do not describe (the isometric and section views, the cutting line, saved
 * dimensions); the three views are known from `placements`.
 */
export function addAutoDimensions(page:DrawingLayout,doc:CadDocument,projection:ExactAssemblyProjection,placements:Placement,factor:number,blocked:Box[],
 deferred:{labels:DrawingText[];notes:DrawingText[]}={labels:[],notes:[]}):AutoDimensionReport{
 const taken:Box[]=[...blocked.map(box=>grow(box,.8)),...page.texts.map(text=>({...grow(textBox(text),.6),text:true}))];
 // Lines drawn here that later texts must not cover (extension lines and leaders).
 const strokes:[SketchPoint,SketchPoint][]=[];
 const frames:Frame[]=placements.map(([,left,bottom],i)=>({left,bottom,width:projection.views[i].width*factor,height:projection.views[i].height*factor}));
 const viewBoxes=frames.map(f=>({l:f.left,b:f.bottom,r:f.left+f.width,t:f.bottom+f.height}));
 const report:AutoDimensionReport={placed:0,omitted:0,callouts:0};
 // The views themselves: nothing goes on them, except a callout on its own view when nothing else fits.
 const views=viewBoxes.map(box=>grow(box,.8));
 const free=(boxes:Box[],lines:[SketchPoint,SketchPoint][],texts:Box[],allow=-1)=>
  boxes.every(box=>inside(box)&&!taken.some(other=>overlaps(box,other))&&!views.some((view,i)=>i!==allow&&overlaps(box,view)))&&
  texts.every(box=>!strokes.some(([a,b])=>segmentHits(a,b,box)))&&
  lines.every(([a,b])=>!taken.some(box=>box.text&&segmentHits(a,b,box)));
 const occupy=(boxes:Box[],lines:[SketchPoint,SketchPoint][],texts:Box[])=>{
  taken.push(...boxes.filter(box=>!texts.includes(box)),...texts.map(box=>Object.assign(grow(box,.4),{text:true})));
  strokes.push(...lines);
 };
 // Every path drawn is also collected, so a dimension knows the lines it is drawn with.
 let drawn:DrawingPath[]=[];
 const path=(points:SketchPoint[])=>{const item={stroke:'annotation' as const,points};page.paths.push(item);drawn.push(item);};
 const tick=([x,y]:SketchPoint)=>path([[x-.9,y-.9],[x+.9,y+.9]]);

 type Side='below'|'above'|'left'|'right';
 /**
  * A linear dimension between paper points p and q of view `view`, measured along x (horizontal)
  * or y, with its value. Tries the sides in order, tier by tier.
  */
 type Try=[view:number,p:SketchPoint,q:SketchPoint,sides:Side[]];
 const linear=(horizontal:boolean,value:number,tries:Try[]):number=>{
  const label=dimensionText(value),w=textWidth(label,TEXT);
  for(const [index,[view,p,q,sides]] of tries.entries())for(const side of sides){
   const box=viewBoxes[view];
   if(horizontal!==(side==='below'||side==='above'))continue;
   for(let tier=0;tier<TIERS;tier++){
    const out=side==='below'||side==='left'?-1:1;
    const level=side==='below'?box.b-FIRST-TIER*tier:side==='above'?box.t+FIRST+TIER*tier:side==='left'?box.l-FIRST-TIER*tier:box.r+FIRST+TIER*tier;
    const along=(point:SketchPoint)=>horizontal?point[0]:point[1],a=Math.min(along(p),along(q)),b=Math.max(along(p),along(q));
    const fits=b-a>=w+2;
    const extension=(point:SketchPoint):[SketchPoint,SketchPoint]=>horizontal
     ?[[point[0],point[1]+out*GAP],[point[0],level+out*OVERSHOOT]]
     :[[point[0]+out*GAP,point[1]],[level+out*OVERSHOOT,point[1]]];
    const extensions=[extension(p),extension(q)];
    const line:Box=horizontal?{l:a-1,b:level-1,r:b+1,t:level+1}:{l:level-1,b:a-1,r:level+1,t:b+1};
    let text:{x:number;y:number;angle?:number};
    if(horizontal)text=fits?{x:(a+b)/2-w/2,y:level+.8}:{x:b+1.5,y:level+.8};
    else text=fits?{x:level-.8,y:(a+b)/2-w/2,angle:90}:{x:level-.8,y:b+1.5,angle:90};
    const label_={...text,size:TEXT,text:label};
    const tb=textBox(label_);
    const boxes=[line,tb];
    if(!free(boxes,extensions,[tb]))continue;
    occupy(boxes,extensions,[tb]);
    drawn=[];
    for(const [s,e] of extensions)path([s,e]);
    const ends:[SketchPoint,SketchPoint]=horizontal?[[a,level],[b,level]]:[[level,a],[level,b]];
    path(fits?ends:horizontal?[[a,level],[b+1.5+w,level]]:[[level,a],[level,b+1.5+w]]);
    tick(ends[0]);tick(ends[1]);
    page.texts.push(label_);
    recordDimension(page,{kind:'rotated',angle:horizontal?0:90,points:[p,q,ends[1]],measurement:value,text:label,textAt:[label_.x,label_.y],paths:drawn,texts:[label_]});
    report.placed++;
    return index;
   }
  }
  report.omitted++;
  return -1;
 };

 /** A leader from `anchor` (on a curve, pointing away along `direction`) to the text lines. */
 type Measure=Pick<DrawingDimension,'kind'|'points'|'measurement'>;
 /** `measure`: a diameter or radius the leader dimensions (recorded for DXF DIMENSION entities). */
 const leader=(view:number,anchor:SketchPoint,direction:SketchPoint,lines:string[],count=true,measure?:Measure)=>{
  const angles=[0,-Math.PI/6,Math.PI/6,-Math.PI/3,Math.PI/3,Math.PI/2,-Math.PI/2,Math.PI*2/3,-Math.PI*2/3,Math.PI];
  const base=Math.atan2(direction[1],direction[0]);
  for(const allowOwn of [false,true])for(const length of [6,11,17,24,32])for(const turn of angles){
   const a=base+turn,elbow:SketchPoint=[anchor[0]+length*Math.cos(a),anchor[1]+length*Math.sin(a)];
   const right=Math.cos(a)>=0,shoulder:SketchPoint=[elbow[0]+(right?3:-3),elbow[1]];
   const widths=lines.map(line=>textWidth(line,TEXT)),w=Math.max(...widths);
   const x=right?shoulder[0]+.8:shoulder[0]-.8-w;
   const texts=lines.map((text,i)=>({x:right?x:shoulder[0]-.8-widths[i],y:elbow[1]-TEXT*.4-i*TEXT*1.45,size:TEXT,text}));
   const block:Box={l:x,b:elbow[1]-TEXT*.4-(lines.length-1)*TEXT*1.45-.3*TEXT,r:x+w,t:elbow[1]-TEXT*.4+TEXT};
   const segments:[SketchPoint,SketchPoint][]=[[anchor,elbow],[elbow,shoulder]];
   if(!free([block],segments,[block],allowOwn?view:-1))continue;
   // On its own view, a callout sits wholly inside it, not across its outline.
   const own=viewBoxes[view];
   if(allowOwn&&overlaps(block,own)&&!(block.l>=own.l+.5&&block.r<=own.r-.5&&block.b>=own.b+.5&&block.t<=own.t-.5))continue;
   // The leader must not cross another view.
   if(viewBoxes.some((box,i)=>i!==view&&segments.some(([s,e])=>segmentHits(s,e,box))))continue;
   occupy([block],segments,[block]);
   drawn=[];
   path([anchor,elbow,shoulder]);
   // An arrowhead at the curve, pointing at it.
   const back=Math.atan2(anchor[1]-elbow[1],anchor[0]-elbow[0]);
   const head:DrawingPath={stroke:'annotation',closed:true,points:[anchor,[anchor[0]-2.2*Math.cos(back-.3),anchor[1]-2.2*Math.sin(back-.3)],[anchor[0]-2.2*Math.cos(back+.3),anchor[1]-2.2*Math.sin(back+.3)]]};
   page.paths.push(head);drawn.push(head);
   const placedTexts:DrawingText[]=[];
   for(const text of texts){const added=addSymbolText(page,text);placedTexts.push(...added.texts);drawn.push(...added.paths);}
   if(measure)recordDimension(page,{...measure,text:lines.join(' '),textAt:[texts[0].x,texts[0].y],paths:drawn,texts:placedTexts});
   if(count)report.placed++;
   return true;
  }
  report.omitted++;
  return false;
 };

 const {origin}=projection,size=projection.exact.size;
 const paper=(view:number,u:number,v:number):SketchPoint=>[frames[view].left+u*factor,frames[view].bottom+v*factor];

 // Standard holes by world mouth and axis, for callouts.
 const standards:{feature:HoleFeature;mouth:Vec3;axis:Vec3}[]=[];
 for(const node of Object.values(doc.nodes)){
  if(node.kind!=='hole')continue;
  try{
   const frame=nodeWorldFrame(doc,node.id),m=frame.rotation;
   standards.push({feature:node as unknown as HoleFeature,mouth:frame.origin,axis:[-m[2],-m[5],-m[8]]});
  }catch{/* inside a pattern or mirror: called out by its diameter */}
 }

 // Per view: holes, centre marks, positions, callouts.
 const calloutsQueue:{view:number;anchor:SketchPoint;direction:SketchPoint;lines:string[]}[]=[];
 for(const [view,holes] of projection.holes.entries()){
  if(!holes.length)continue;
  const {horizontal,vertical,depth}=drawingViews[view];
  const box=viewBoxes[view];
  // Coaxial holes (a counterbore and its bore) share one centre.
  const centres:{center:SketchPoint;radii:number[];visible:boolean}[]=[];
  for(const hole of holes){
   const same=centres.find(c=>Math.hypot(c.center[0]-hole.center[0],c.center[1]-hole.center[1])<1e-6);
   if(same){same.radii.push(hole.radius);same.visible||=hole.visible;}else centres.push({center:hole.center,radii:[hole.radius],visible:hole.visible});
  }
  for(const c of centres){
   c.radii.sort((a,b)=>a-b);
   const [x,y]=paper(view,...c.center),r=c.radii.at(-1)!*factor+2;
   page.paths.push({stroke:'center',points:[[x-r,y],[x+r,y]]},{stroke:'center',points:[[x,y-r],[x,y+r]]});
  }
  // Positions from the view's left and bottom edges (the assembly's bounding box), shortest first.
  const xs=[...new Set(centres.map(c=>Number(c.center[0].toFixed(6))))].filter(x=>x>1e-6&&x<projection.views[view].width-1e-6).sort((a,b)=>a-b);
  const ys=[...new Set(centres.map(c=>Number(c.center[1].toFixed(6))))].filter(y=>y>1e-6&&y<projection.views[view].height-1e-6).sort((a,b)=>a-b);
  // Extension lines start at the view's outline; the holes' centre lines run out to it.
  const centreLine=(from:SketchPoint,to:SketchPoint)=>page.paths.push({stroke:'center',points:[from,to]});
  if(xs.length<=8)for(const u of xs){
   const holeAt=centres.filter(c=>Math.abs(c.center[0]-u)<1e-6).sort((a,b)=>b.center[1]-a.center[1]);
   const top=holeAt[0],bottomHole=holeAt.at(-1)!,[x]=paper(view,u,0);
   // The side nearer the holes first, so their centre lines stay short.
   const upper=top.center[1]>=projection.views[view].height/2;
   const tries:Try[]=[[view,[box.l,box.t],[x,box.t],['above']],[view,[box.l,box.b],[x,box.b],['below']]];
   const placed=linear(true,u,upper?tries:[tries[1],tries[0]]);
   if(placed===(upper?0:1))centreLine(paper(view,u,top.center[1]+top.radii.at(-1)!+2/factor),[x,box.t]);
   else if(placed>=0)centreLine(paper(view,u,bottomHole.center[1]-bottomHole.radii.at(-1)!-2/factor),[x,box.b]);
  }else report.omitted+=xs.length;
  if(ys.length<=8)for(const v of ys){
   const holeAt=centres.filter(c=>Math.abs(c.center[1]-v)<1e-6).sort((a,b)=>a.center[0]-b.center[0]);
   const leftHole=holeAt[0],rightHole=holeAt.at(-1)!,[,y]=paper(view,0,v);
   const righter=rightHole.center[0]>=projection.views[view].width/2;
   const tries:Try[]=[[view,[box.r,box.b],[box.r,y],['right']],[view,[box.l,box.b],[box.l,y],['left']]];
   const placed=linear(false,v,righter?tries:[tries[1],tries[0]]);
   if(placed===(righter?0:1))centreLine(paper(view,rightHole.center[0]+rightHole.radii.at(-1)!+2/factor,v),[box.r,y]);
   else if(placed>=0)centreLine(paper(view,leftHole.center[0]-leftHole.radii.at(-1)!-2/factor,v),[box.l,y]);
  }else report.omitted+=ys.length;
  // Callouts: standard holes by their node, other holes by diameter; equal callouts are counted.
  const groups=new Map<string,{lines:(count:number)=>string[];members:typeof centres}>();
  for(const c of centres){
   const world=(u:number,v:number)=>{const p:Vec3=[0,0,0];p[horizontal]=origin[horizontal]+u;p[vertical]=origin[vertical]+v;return p;};
   const at=world(...c.center);
   const standard=standards.find(s=>Math.abs(Math.abs(s.axis[depth])-1)<1e-9&&Math.abs(s.mouth[horizontal]-at[horizontal])<1e-6&&Math.abs(s.mouth[vertical]-at[vertical])<1e-6&&
    c.radii.some(r=>Math.abs(2*r-s.feature.diameter)<1e-6));
   const key=standard?'std:'+JSON.stringify([standard.feature.standard,standard.feature.diameter,standard.feature.depth,standard.feature.through,standard.feature.counterbore,standard.feature.countersink])
    :'d:'+c.radii.map(r=>dimensionText(2*r)).join('/');
   const group=groups.get(key);
   if(group){group.members.push(c);continue;}
   groups.set(key,{members:[c],lines:standard?count=>holeCallout(standard.feature,count)
    :count=>[(count>1?t`${count}× `:'')+c.radii.map(r=>'Ø'+dimensionText(2*r)).join(' / ')]});
  }
  for(const {members,lines} of groups.values()){
   // Lead from the hole farthest up and right, away from the view's centre.
   const target=[...members].sort((a,b)=>b.center[0]+b.center[1]-a.center[0]-a.center[1])[0];
   const center=paper(view,...target.center),r=target.radii.at(-1)!*factor;
   const mid:SketchPoint=[(box.l+box.r)/2,(box.b+box.t)/2];
   let dx=center[0]-mid[0]||1,dy=center[1]-mid[1]||1;const l=Math.hypot(dx,dy);dx/=l;dy/=l;
   // 45° towards the outside (ISO leaders are not horizontal or vertical).
   const dir:SketchPoint=[Math.sign(dx)*Math.SQRT1_2,Math.sign(dy)*Math.SQRT1_2];
   calloutsQueue.push({view,anchor:[center[0]+r*dir[0],center[1]+r*dir[1]],direction:dir,lines:lines(members.length)});
  }
 }

 // Overall size: X under the front view, Z beside the right view, Y under the right view.
 const corner=(view:number,u:number,v:number)=>paper(view,u,v);
 const [w0,h0]=[projection.views[1].width,projection.views[1].height];
 linear(true,size[0],[[1,corner(1,0,0),corner(1,w0,0),['below','above']]]);
 const [w2,h2]=[projection.views[2].width,projection.views[2].height];
 linear(false,size[2],[[2,corner(2,w2,0),corner(2,w2,h2),['right']],[1,corner(1,0,0),corner(1,0,h0),['left']]]);
 // Y: under the right view, or beside the top view (a vertical dimension there).
 const [w3,h3]=[projection.views[0].width,projection.views[0].height];
 if(linear(true,size[1],[[2,corner(2,0,0),corner(2,w2,0),['below','above']]])<0){report.omitted--;linear(false,size[1],[[0,corner(0,w3,0),corner(0,w3,h3),['right','left']]]);}

 for(const item of calloutsQueue)if(leader(item.view,item.anchor,item.direction,item.lines))report.callouts++;

 // Diameters of full circles that are not holes (bosses, cylinders end-on) and radii of arcs.
 for(const [view,lines] of projection.lines.entries()){
  const holes=projection.holes[view];
  const isHole=(c:SketchPoint,r:number)=>holes.some(h=>Math.hypot(h.center[0]-c[0],h.center[1]-c[1])<1e-6&&Math.abs(h.radius-r)<1e-7*Math.max(1,r));
  const circles=new Map<string,{center:SketchPoint;radius:number;count:number}>(),arcs=new Map<string,{center:SketchPoint;radius:number;mid:number;count:number}>();
  for(const arc of lines.arcs){
   if(arc.hidden||isHole(arc.center,arc.radius))continue;
   const key=dimensionText(arc.radius);
   if(arc.sweep>=2*Math.PI-1e-6){const c=circles.get(key);if(c)c.count++;else circles.set(key,{center:arc.center,radius:arc.radius,count:1});continue;}
   const a=arcs.get(key),mid=arc.start+arc.sweep/2;
   if(a)a.count++;else arcs.set(key,{center:arc.center,radius:arc.radius,mid,count:1});
  }
  for(const c of circles.values()){
   const center=paper(view,...c.center),r=c.radius*factor,on:SketchPoint=[center[0]+r*Math.SQRT1_2,center[1]+r*Math.SQRT1_2];
   leader(view,on,[Math.SQRT1_2,Math.SQRT1_2],[(c.count>1?t`${c.count}× `:'')+'Ø'+dimensionText(2*c.radius)],true,
    {kind:'diameter',points:[on,[2*center[0]-on[0],2*center[1]-on[1]]],measurement:2*c.radius});
  }
  for(const a of arcs.values()){
   const center=paper(view,...a.center),r=a.radius*factor,dir:SketchPoint=[Math.cos(a.mid),Math.sin(a.mid)],on:SketchPoint=[center[0]+r*dir[0],center[1]+r*dir[1]];
   leader(view,on,dir,[(a.count>1?t`${a.count}× `:'')+'R'+dimensionText(a.radius)],true,{kind:'radius',points:[center,on],measurement:a.radius});
  }
 }
 // View labels: above the view and its dimensions, else below it; then the notes as one block.
 const placeText=(text:DrawingText,spots:SketchPoint[],allow=-1)=>{
  for(const [x,y] of spots){
   const box=textBox({...text,x,y});
   if(!free([box],[],[box],allow))continue;
   occupy([box],[],[box]);
   page.texts.push({...text,x,y});
   return true;
  }
  page.texts.push(text);
  return false;
 };
 for(const [view,label] of deferred.labels.entries()){
  const box=viewBoxes[view],w=textWidth(label.text,label.size);
  const spots:SketchPoint[]=[];
  for(let k=0;k<12;k++)spots.push([box.l,box.t+4+3.5*k],[box.r-w,box.t+4+3.5*k]);
  for(let k=0;k<4;k++)spots.push([box.l,box.b-4-label.size-3.5*k]);
  placeText(label,spots);
 }
 const notes=[...deferred.notes.map(note=>note.text),...(report.omitted?[t`Automatic dimensions: ${report.omitted} left off for lack of room`]:[])];
 if(notes.length){
  const size=deferred.notes[0]?.size??2.5,w=Math.max(...notes.map(text=>textWidth(text,size))),h=(notes.length-1)*3.4;
  const spots:SketchPoint[]=[[14,36],[14,29.2+h],[sheet.r-2-w,196],[14,178],[sheet.r-2-w,36]];
  const fits=([x,y]:SketchPoint)=>{
   const block:Box={l:x,b:y-h-.3*size,r:x+w,t:y+size};
   return free([block],[],[block]);
  };
  const [x,y]=spots.find(fits)??spots[0];
  notes.forEach((text,i)=>page.texts.push({x,y:y-i*3.4,size,text}));
  const block:Box={l:x,b:y-h-.3*size,r:x+w,t:y+size,text:true};
  taken.push(block);
 }
 return report;
}
