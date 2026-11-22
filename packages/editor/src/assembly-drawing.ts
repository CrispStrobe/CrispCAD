// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {DrawingInputs,SketchPoint,Vec3} from '@brickwright/cad-core';
import type {BodyMesh,GeometryResult} from '@brickwright/cad-geometry';
import {addDrawingFrame,drawingViews} from './drawing-page.js';
import type {DrawingLayout} from './drawing-page.js';

type View=(typeof drawingViews)[number];
type Triangle={a:Vec3; b:Vec3; c:Vec3; det:number; box:Box; nearest:number};
type Edge={a:number; b:number; normals:Vec3[]};
type Box={left:number; bottom:number; right:number; top:number};
const bins=48;
const maxTriangles=100000;
const maxBucketVisits=16000000;
const maxCoverageChecks=2500000;
const cosineCrease=Math.cos(Math.PI/6);
const projectionError=()=>new Error(t('This assembly exceeds the drawing detail limit. Use a simpler representation.'));

const boxOf=(a:Vec3,b:Vec3,c:Vec3=b):Box=>({
 left:Math.min(a[0],b[0],c[0]),bottom:Math.min(a[1],b[1],c[1]),
 right:Math.max(a[0],b[0],c[0]),top:Math.max(a[1],b[1],c[1])
});
const overlap=(a:Box,b:Box)=>a.left<=b.right&&a.right>=b.left&&a.bottom<=b.top&&a.top>=b.bottom;
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

function topology(mesh:BodyMesh){
 const unique=new Map<string,number>(),vertices:Vec3[]=[],indices:number[]=[];
 for(let i=0;i<mesh.positions.length;i+=3){
  const point:Vec3=[mesh.positions[i],mesh.positions[i+1],mesh.positions[i+2]];
  const key=point.join(',');
  let index=unique.get(key);
  if(index===undefined){index=vertices.length;unique.set(key,index);vertices.push(point);}
  indices.push(index);
 }
 const faces:{a:number;b:number;c:number}[]=[],edges=new Map<number,Edge>();
 for(let i=0;i<mesh.indices.length;i+=3){
  const a=indices[mesh.indices[i]],b=indices[mesh.indices[i+1]],c=indices[mesh.indices[i+2]];
  const p=vertices[a],q=vertices[b],r=vertices[c];
  const [ux,uy,uz]=q.map((v,i)=>v-p[i]),[vx,vy,vz]=r.map((v,i)=>v-p[i]);
  const n:Vec3=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],length=Math.hypot(...n);
  if(length<=1e-12)continue;
  const normal:Vec3=[n[0]/length,n[1]/length,n[2]/length];
  faces.push({a,b,c});
  for(const [u,v] of [[a,b],[b,c],[c,a]]){
   const lo=Math.min(u,v),hi=Math.max(u,v),key=lo*vertices.length+hi;
   const existing=edges.get(key);
   if(existing)existing.normals.push(normal);
   else edges.set(key,{a:lo,b:hi,normals:[normal]});
  }
 }
 return {vertices,faces,edges:[...edges.values()]};
}

function coveringInterval(triangle:Triangle,a:Vec3,b:Vec3,tolerance:number):[number,number]|undefined{
 const {a:p,b:q,c:r,det}=triangle;
 const coordinates=(point:Vec3)=>{
  const x=point[0]-p[0],y=point[1]-p[1];
  const u=(x*(r[1]-p[1])-y*(r[0]-p[0]))/det;
  const v=((q[0]-p[0])*y-(q[1]-p[1])*x)/det;
  return [u,v,1-u-v,p[2]+u*(q[2]-p[2])+v*(r[2]-p[2])-point[2]-tolerance];
 };
 const start=coordinates(a),end=coordinates(b);
 let lo=0,hi=1;
 for(let k=0;k<start.length;k++){
  if(start[k]<=0&&end[k]<=0){
   // A projected triangle boundary can still obscure an edge farther behind it.
   if(k===3||start[k]<-1e-10||end[k]<-1e-10)return undefined;
   continue;
  }
  if(start[k]<0)lo=Math.max(lo,start[k]/(start[k]-end[k]));
  else if(end[k]<0)hi=Math.min(hi,start[k]/(start[k]-end[k]));
 }
 return hi-lo>1e-8?[lo,hi]:undefined;
}

function viewLines(models:ReturnType<typeof topology>[],view:View,min:Vec3,max:Vec3){
 const {horizontal,vertical,depth,near}=view;
 const width=max[horizontal]-min[horizontal],height=max[vertical]-min[vertical];
 const tolerance=Math.max(1e-6,Math.min(.002,(max[depth]-min[depth])*1e-6));
 const projection=models.map(model=>model.vertices.map((p):Vec3=>[p[horizontal]-min[horizontal],p[vertical]-min[vertical],p[depth]*near]));
 const cells:Triangle[][]=Array.from({length:bins*bins},()=>[]);
 const bin=(v:number,extent:number)=>Math.min(bins-1,Math.max(0,Math.floor(v/extent*bins)));
 const grid=(box:Box,visit:(index:number)=>void)=>{
  const x0=bin(box.left,width),x1=bin(box.right,width),y0=bin(box.bottom,height),y1=bin(box.top,height);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)visit(y*bins+x);
 };
 // Walk the edge through column spans so a diagonal does not visit its entire bounding box.
 const edgeCells=(a:Vec3,b:Vec3,visit:(index:number)=>void)=>{
  const [left,right]=a[0]<=b[0]?[a,b]:[b,a],dx=right[0]-left[0];
  if(dx<1e-10){grid(boxOf(a,b),visit);return;}
  const dy=right[1]-left[1],stride=width/bins;
  for(let x=bin(left[0],width);x<=bin(right[0],width);x++){
   const start=left[1]+dy*Math.max(0,(x*stride-left[0])/dx);
   const end=left[1]+dy*Math.min(1,((x+1)*stride-left[0])/dx);
   for(let y=bin(Math.min(start,end),height);y<=bin(Math.max(start,end),height);y++)visit(y*bins+x);
  }
 };
 let bucketVisits=0,coverageChecks=0;
 const spend=()=>{if(++bucketVisits>maxBucketVisits)throw projectionError();};
 for(const [i,model] of models.entries()){
  for(const face of model.faces){
   const [a,b,c]=[projection[i][face.a],projection[i][face.b],projection[i][face.c]];
   const det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
   if(Math.abs(det)<1e-10)continue;
   const triangle={a,b,c,det,box:boxOf(a,b,c),nearest:Math.max(a[2],b[2],c[2])};
   grid(triangle.box,index=>{spend();cells[index].push(triangle);});
  }
 }
 const segments:number[]=[];
 for(const [i,model] of models.entries()){
  for(const edge of model.edges){
   const [n,...neighbors]=edge.normals;
   if(neighbors.length&&!neighbors.some(m=>dot(n,m)<cosineCrease||
     (n[depth]*near>1e-8)!==(m[depth]*near>1e-8)))continue;
   const a=projection[i][edge.a],b=projection[i][edge.b],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
   if(length<1e-5)continue;
   const bounds=boxOf(a,b),threshold=Math.min(a[2],b[2])+tolerance,seen=new Set<Triangle>();
   const covered:[number,number][]=[];
   let completelyHidden=false;
   edgeCells(a,b,index=>{
    if(completelyHidden)return;
    for(const triangle of cells[index]){
     spend();
     if(triangle.nearest<=threshold||!overlap(bounds,triangle.box)||seen.has(triangle))continue;
     seen.add(triangle);
     if(++coverageChecks>maxCoverageChecks)throw projectionError();
     const interval=coveringInterval(triangle,a,b,tolerance);
     if(!interval)continue;
     if(interval[0]<=1e-8&&interval[1]>=1-1e-8){
      covered.splice(0,covered.length,[0,1]);
      completelyHidden=true;
      break;
     }
     covered.push(interval);
    }
   });
   covered.sort((a,b)=>a[0]-b[0]);
   const at=(t:number):SketchPoint=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
   const segment=(start:number,end:number,hidden:boolean)=>{
    if((end-start)*length>1e-5)segments.push(...at(start),...at(end),hidden?1:0);
   };
   let cursor=0;
   for(let k=0;k<covered.length;k++){
    const [start,initialEnd]=covered[k];
    let end=initialEnd;
    while(k+1<covered.length&&covered[k+1][0]<=end+1e-8)end=Math.max(end,covered[++k][1]);
    segment(cursor,start,false);
    segment(start,end,true);
    cursor=end;
   }
   segment(cursor,1,false);
  }
 }
 return {view:view.view,width,height,segments:Float64Array.from(segments)};
}

export function projectAssembly(geometry:GeometryResult){
 const bodies=geometry.bodies.filter(body=>!body.reference&&!body.hole&&body.indices.length>0);
 if(!bodies.length)throw new Error(t('Add a solid body to draw the assembly.'));
 if(bodies.reduce((sum,body)=>sum+body.indices.length/3,0)>maxTriangles)throw projectionError();
 const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
 for(const body of bodies)for(const axis of [0,1,2]){
  min[axis]=Math.min(min[axis],body.bounds.min[axis]);
  max[axis]=Math.max(max[axis],body.bounds.max[axis]);
 }
 const models=bodies.map(topology);
 const views=drawingViews.map(view=>viewLines(models,view,min,max));
 return {views,bodyIds:bodies.map(body=>body.id),sourceKey:geometry.sourceKey};
}

export type AssemblyProjection=ReturnType<typeof projectAssembly>;

const cache=new WeakMap<GeometryResult,AssemblyProjection>();

export function assemblyProjection(input:GeometryResult|AssemblyProjection):AssemblyProjection{
 if('views' in input)return input;
 let projection=cache.get(input);
 if(!projection){projection=projectAssembly(input);cache.set(input,projection);}
 return projection;
}

export function layoutAssemblyDrawing(sheet:DrawingInputs,projection:AssemblyProjection):DrawingLayout{
 const [top,front,right]=projection.views;
 const [num,denom]=sheet.scale.split(':').map(Number),factor=num/denom;
 const x=24,baseline=47,gap=20;
 const rightX=x+front.width*factor+gap,topY=baseline+front.height*factor+gap;
 if(rightX+right.width*factor>274||topY+top.height*factor>169){
  throw new Error(t('This drawing does not fit on A4 at this scale. Choose a smaller scale.'));
 }
 const page:DrawingLayout={width:297,height:210,paths:[],texts:[],circles:[],anchors:[],annotationIssues:[],factor};
 for(const [view,left,bottom] of [[top,x,topY],[front,x,baseline],[right,rightX,baseline]] as const){
  const point=(u:number,v:number):SketchPoint=>[left+u*factor,bottom+v*factor];
  const {segments}=view;
  for(const hidden of sheet.hiddenLines?[1,0]:[0]){
   for(let i=0;i<segments.length;i+=5){
    if(segments[i+4]===hidden)page.paths.push({stroke:hidden?'hidden':'visible',
     points:[point(segments[i],segments[i+1]),point(segments[i+2],segments[i+3])]});
   }
  }
  page.texts.push({x:left,y:bottom+view.height*factor+4,text:t(view.view),size:3.5});
 }
 const count=projection.bodyIds.length;
 const subtitle=count===1?t('Assembly · 1 body'):t`Assembly · ${count} bodies`;
 addDrawingFrame(page,sheet.title,subtitle,sheet.scale);
 return page;
}
