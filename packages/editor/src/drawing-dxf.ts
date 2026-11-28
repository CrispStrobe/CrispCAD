// SPDX-License-Identifier: BSD-3-Clause
// A drawing sheet as a DXF file, written here (no library): AutoCAD R12 (AC1009) or R2000
// (AC1015), the paper in millimetres at 1:1 ($INSUNITS 4 in R2000), so the views keep the sheet's
// scale and the 50 mm scale check measures 50 units. Lines become LINE or (LW)POLYLINE entities;
// circles and arcs from exact edges are CIRCLE and ARC; ellipses are ELLIPSE entities in R2000 and,
// since R12 has no ellipse, polylines within 0.01 mm of the true ellipse; text is TEXT. Each kind of
// line has its own layer (VISIBLE, HIDDEN, …) with the PDF's linetype and weight.
//
// R2000 files carry the structure the DXF reference asks for (handles, owners, subclass markers,
// the block records of model and paper space and the root dictionary); the application that reads
// the file creates layouts and other objects it needs.
//
// Dimensions (R2000): each dimension the sheet records (DrawingLayout.dimensions) is a DIMENSION
// entity (rotated: horizontal or vertical; aligned; diameter; radius) with its definition points on
// paper, its text as drawn, the model value as its measurement, and a DIMLFAC override (1 / sheet
// scale, XDATA "ACAD" DSTYLE), so an application that measures it again shows model millimetres.
// Its lines and text are the geometry of its own anonymous block (*D1, *D2, …), as AutoCAD stores
// them, and are not repeated in ENTITIES. Arc lengths, hole callouts, datums and tolerance frames
// stay lines and text. R12 files keep every dimension as lines and text, and a sheet without
// dimensions is written exactly as before. Text is code page 1252 (ANSI_1252), as both
// versions expect; characters outside it are written as \U+XXXX in R2000 and as ? in R12.
import {t} from '@brickwright/cad-core';
import {ellipsePoint} from './drawing-conic.js';
import type {DrawingLayout,DrawingPath,DrawingText} from './drawing-page.js';
import {helveticaWidth} from './drawing-symbols.js';
import {drawingFileName} from './drawing-svg.js';

export type DxfVersion='R12'|'R2000';
export const DXF_VERSIONS:readonly DxfVersion[]=['R2000','R12'];
/** How far a polyline standing in for an ellipse (R12) may be from it, in paper millimetres. */
export const DXF_ELLIPSE_TOLERANCE=.01;

type Layer={name:string;color:number;linetype:string;weight:number};
/** Layers only some sheets have (cosmetic threads, unresolved datum or tolerance references): in the layer table only when used. */
const extraLayers:Record<'thread'|'error',Layer>={
 thread:{name:'THREAD',color:4,linetype:'CONTINUOUS',weight:13},
 error:{name:'REFERENCE_ERRORS',color:1,linetype:'CONTINUOUS',weight:13},
};
const layers:Record<Exclude<DrawingPath['stroke'],'thread'|'error'>|'text',Layer>={
 visible:{name:'VISIBLE',color:7,linetype:'CONTINUOUS',weight:25},
 section:{name:'SECTION',color:7,linetype:'CONTINUOUS',weight:25},
 hidden:{name:'HIDDEN',color:8,linetype:'DASHED',weight:13},
 cut:{name:'CUTTING_PLANE',color:1,linetype:'DASHDOT',weight:13},
 hatch:{name:'HATCH',color:8,linetype:'CONTINUOUS',weight:9},
 center:{name:'CENTER',color:4,linetype:'DASHDOT',weight:13},
 dimension:{name:'DIMENSIONS',color:3,linetype:'CONTINUOUS',weight:13},
 annotation:{name:'DIMENSIONS',color:3,linetype:'CONTINUOUS',weight:13},
 border:{name:'BORDER',color:7,linetype:'CONTINUOUS',weight:13},
 text:{name:'TEXT',color:7,linetype:'CONTINUOUS',weight:13},
};
/** Linetypes in paper millimetres (dashes positive, gaps negative), as the PDF draws them. */
const linetypes:{name:string;description:string;pattern:number[]}[]=[
 {name:'DASHED',description:'Hidden __ __ __',pattern:[1.4,-.9]},
 {name:'DASHDOT',description:'Dash dot __ . __ .',pattern:[3.5,-1,.7,-1]},
];

const number=(value:number)=>{const v=Number(value.toFixed(6))+0;return Number.isInteger(v)?v.toFixed(1):String(v);};
const degrees=(radians:number)=>{const d=((radians*180/Math.PI)%360+360)%360;return number(Math.abs(d-360)<1e-9?0:d);};

/** Code page 1252 text: Latin-1 as is, 1252's own characters in 0x80–0x9f, others escaped. */
const cp1252:Record<string,number>={'€':0x80,'‚':0x82,'ƒ':0x83,'„':0x84,'…':0x85,'†':0x86,'‡':0x87,'ˆ':0x88,'‰':0x89,'Š':0x8a,'‹':0x8b,'Œ':0x8c,'Ž':0x8e,
 '‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,'˜':0x98,'™':0x99,'š':0x9a,'›':0x9b,'œ':0x9c,'ž':0x9e,'Ÿ':0x9f};
function encode(text:string,version:DxfVersion){
 const bytes:number[]=[];
 for(const character of text){
  const code=character.codePointAt(0)!;
  if(code>=32&&code<127||code>=160&&code<=255)bytes.push(code);
  else if(cp1252[character])bytes.push(cp1252[character]);
  else if(code>=32&&version==='R2000')for(const c of '\\U+'+code.toString(16).toUpperCase().padStart(4,'0'))bytes.push(c.charCodeAt(0));
  else bytes.push(63);
 }
 return bytes;
}

/** The DXF text of one sheet (its first page: the views). */
export function drawingDxfBytes(layout:DrawingLayout,version:DxfVersion='R2000'):Uint8Array{
 const r2000=version==='R2000',out:number[]=[];
 const dimensions=r2000?layout.dimensions??[]:[];
 const inBlocks={paths:new Set(dimensions.flatMap(d=>d.paths)),texts:new Set(dimensions.flatMap(d=>d.texts))};
 const layerOf=(stroke:DrawingPath['stroke'])=>stroke==='thread'||stroke==='error'?extraLayers[stroke]:layers[stroke];
 const pair=(code:number,value:string|number)=>{
  for(const c of String(code).padStart(3,' '))out.push(c.charCodeAt(0));
  out.push(13,10);
  out.push(...(typeof value==='string'?encode(value,version):[...String(value)].map(c=>c.charCodeAt(0))),13,10);
 };
 let next=0x20,seedAt=-1;
 const handle=()=>(next++).toString(16).toUpperCase();
 const point=(x:number,y:number,code=10)=>{pair(code,number(x));pair(code+10,number(y));pair(code+20,'0.0');};
 // Handles of the owners entities and blocks refer to.
 const owners={model:'',paper:''};
 let owner='';
 const entity=(type:string,layer:Layer,subclass:string)=>{
  pair(0,type);
  if(r2000){pair(5,handle());pair(330,owner);pair(100,'AcDbEntity');}
  pair(8,layer.name);
  if(r2000)pair(100,subclass);
 };
 const polyline=(layer:Layer,points:readonly (readonly [number,number])[],closed:boolean)=>{
  if(points.length===2&&!closed){
   entity('LINE',layer,'AcDbLine');point(points[0][0],points[0][1]);point(points[1][0],points[1][1],11);
   return;
  }
  if(r2000){
   entity('LWPOLYLINE',layer,'AcDbPolyline');
   pair(90,points.length);pair(70,closed?1:0);pair(43,'0.0');
   for(const [x,y] of points){pair(10,number(x));pair(20,number(y));}
   return;
  }
  entity('POLYLINE',layer,'');pair(66,1);point(0,0);pair(70,closed?1:0);
  for(const [x,y] of points){entity('VERTEX',layer,'');point(x,y);}
  entity('SEQEND',layer,'');
 };
 const textEntity=({x,y,size,text,angle}:DrawingText)=>{
  entity('TEXT',layers.text,'AcDbText');
  point(x,y);pair(40,number(size));pair(1,text);
  if(angle)pair(50,number(angle));
  pair(7,r2000?'Standard':'STANDARD');
  if(r2000)pair(100,'AcDbText');
 };
 const table=(name:string,count:number,records:()=>void,extra?:()=>void)=>{
  pair(0,'TABLE');pair(2,name);
  let own='';
  if(r2000){own=handle();pair(5,own);pair(330,'0');pair(100,'AcDbSymbolTable');}
  pair(70,count);
  extra?.();
  tableHandle=own;records();
  pair(0,'ENDTAB');
 };
 let tableHandle='';
 const record=(type:string,subclass:string,handleCode=5)=>{
  pair(0,type);
  if(r2000){pair(handleCode,handle());pair(330,tableHandle);pair(100,'AcDbSymbolTableRecord');pair(100,subclass);}
 };

 // Extents of what is drawn (the frame spans the sheet).
 const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
 const grow=(x:number,y:number)=>{min[0]=Math.min(min[0],x);min[1]=Math.min(min[1],y);max[0]=Math.max(max[0],x);max[1]=Math.max(max[1],y);};
 for(const path of layout.paths)for(const [x,y] of path.points)grow(x,y);
 for(const {center:[x,y],radius} of layout.circles){grow(x-radius,y-radius);grow(x+radius,y+radius);}
 if(!Number.isFinite(min[0])){min[0]=min[1]=0;max[0]=layout.width;max[1]=layout.height;}

 // Header.
 pair(0,'SECTION');pair(2,'HEADER');
 pair(9,'$ACADVER');pair(1,r2000?'AC1015':'AC1009');
 pair(9,'$DWGCODEPAGE');pair(3,'ANSI_1252');
 pair(9,'$INSBASE');point(0,0);
 pair(9,'$EXTMIN');point(min[0],min[1]);
 pair(9,'$EXTMAX');point(max[0],max[1]);
 pair(9,'$LIMMIN');pair(10,'0.0');pair(20,'0.0');
 pair(9,'$LIMMAX');pair(10,number(layout.width));pair(20,number(layout.height));
 pair(9,'$LTSCALE');pair(40,'1.0');
 pair(9,'$LUNITS');pair(70,2);
 pair(9,'$LUPREC');pair(70,4);
 if(r2000){
  pair(9,'$INSUNITS');pair(70,4);
  pair(9,'$MEASUREMENT');pair(70,1);
  pair(9,'$HANDSEED');pair(5,'');seedAt=out.length-2;
 }
 pair(0,'ENDSEC');
 if(r2000){pair(0,'SECTION');pair(2,'CLASSES');pair(0,'ENDSEC');}

 // Tables.
 pair(0,'SECTION');pair(2,'TABLES');
 const blockRecords={model:'',paper:''},dimensionRecords:string[]=[];
 if(r2000){
  table('VPORT',1,()=>{
   record('VPORT','AcDbViewportTableRecord');
   pair(2,'*ACTIVE');pair(70,0);
   pair(10,'0.0');pair(20,'0.0');pair(11,'1.0');pair(21,'1.0');
   pair(12,number(layout.width/2));pair(22,number(layout.height/2));
   pair(13,'0.0');pair(23,'0.0');pair(14,'10.0');pair(24,'10.0');pair(15,'10.0');pair(25,'10.0');
   pair(16,'0.0');pair(26,'0.0');pair(36,'1.0');pair(17,'0.0');pair(27,'0.0');pair(37,'0.0');
   pair(40,number(layout.height));pair(41,number(layout.width/layout.height));pair(42,'50.0');pair(43,'0.0');pair(44,'0.0');pair(50,'0.0');pair(51,'0.0');
   pair(71,0);pair(72,100);pair(73,1);pair(74,3);pair(75,0);pair(76,0);pair(77,0);pair(78,0);
  });
 }
 const allLinetypes=[...(r2000?[{name:'ByBlock',description:'',pattern:[]},{name:'ByLayer',description:'',pattern:[]}]:[]),{name:'CONTINUOUS',description:'Solid line',pattern:[] as number[]},...linetypes];
 table('LTYPE',allLinetypes.length,()=>{
  for(const {name,description,pattern} of allLinetypes){
   record('LTYPE','AcDbLinetypeTableRecord');
   pair(2,name);pair(70,0);pair(3,description);pair(72,65);pair(73,pattern.length);
   pair(40,number(pattern.reduce((sum,length)=>sum+Math.abs(length),0)));
   for(const length of pattern){pair(49,number(length));if(r2000)pair(74,0);}
  }
 });
 const extra=(['thread','error'] as const).filter(stroke=>layout.paths.some(path=>path.stroke===stroke)||stroke==='thread'&&layout.circles.some(circle=>circle.thin&&!circle.hidden)).map(stroke=>extraLayers[stroke]);
 const used=[...new Map([{name:'0',color:7,linetype:'CONTINUOUS',weight:-3},...Object.values(layers),...extra].map(layer=>[layer.name,layer])).values()];
 table('LAYER',used.length,()=>{
  for(const layer of used){
   record('LAYER','AcDbLayerTableRecord');
   pair(2,layer.name);pair(70,0);pair(62,layer.color);pair(6,layer.linetype);
   if(r2000)pair(370,layer.weight);
  }
 });
 table('STYLE',1,()=>{
  record('STYLE','AcDbTextStyleTableRecord');
  pair(2,r2000?'Standard':'STANDARD');pair(70,0);pair(40,'0.0');pair(41,'1.0');pair(50,'0.0');pair(71,0);pair(42,'2.5');pair(3,'txt');pair(4,'');
 });
 if(r2000){
  table('VIEW',0,()=>{});
  table('UCS',0,()=>{});
  table('APPID',1,()=>{record('APPID','AcDbRegAppTableRecord');pair(2,'ACAD');pair(70,0);});
  table('DIMSTYLE',1,()=>{record('DIMSTYLE','AcDbDimStyleTableRecord',105);pair(2,'Standard');pair(70,0);},()=>pair(100,'AcDbDimStyleTable'));
  table('BLOCK_RECORD',2+dimensions.length,()=>{
   for(const key of ['model','paper'] as const){
    record('BLOCK_RECORD','AcDbBlockTableRecord');
    blockRecords[key]=(next-1).toString(16).toUpperCase();
    pair(2,key==='model'?'*Model_Space':'*Paper_Space');
   }
   // One anonymous block per dimension, holding its lines and text.
   for(const [i] of dimensions.entries()){
    record('BLOCK_RECORD','AcDbBlockTableRecord');
    dimensionRecords.push((next-1).toString(16).toUpperCase());
    pair(2,`*D${i+1}`);
   }
  });
 }
 pair(0,'ENDSEC');
 owners.model=blockRecords.model;owners.paper=blockRecords.paper;

 // Blocks: model and paper space (R2000); R12 needs none.
 pair(0,'SECTION');pair(2,'BLOCKS');
 if(r2000){
  for(const key of ['model','paper'] as const){
   const name=key==='model'?'*Model_Space':'*Paper_Space';
   pair(0,'BLOCK');pair(5,handle());pair(330,blockRecords[key]);pair(100,'AcDbEntity');
   if(key==='paper')pair(67,1);
   pair(8,'0');pair(100,'AcDbBlockBegin');pair(2,name);pair(70,0);point(0,0);pair(3,name);pair(1,'');
   pair(0,'ENDBLK');pair(5,handle());pair(330,blockRecords[key]);pair(100,'AcDbEntity');
   if(key==='paper')pair(67,1);
   pair(8,'0');pair(100,'AcDbBlockEnd');
  }
  for(const [i,dimension] of dimensions.entries()){
   const name=`*D${i+1}`,record=dimensionRecords[i];
   pair(0,'BLOCK');pair(5,handle());pair(330,record);pair(100,'AcDbEntity');
   pair(8,'0');pair(100,'AcDbBlockBegin');pair(2,name);pair(70,1);point(0,0);pair(3,name);pair(1,'');
   owner=record;
   for(const {points,stroke,closed} of dimension.paths)if(points.length>1)polyline(layerOf(stroke),points,!!closed);
   for(const text of dimension.texts)textEntity(text);
   pair(0,'ENDBLK');pair(5,handle());pair(330,record);pair(100,'AcDbEntity');
   pair(8,'0');pair(100,'AcDbBlockEnd');
  }
 }
 pair(0,'ENDSEC');

 // Entities.
 pair(0,'SECTION');pair(2,'ENTITIES');
 owner=owners.model;
 for(const path of layout.paths)if(path.points.length>1&&!inBlocks.paths.has(path))polyline(layerOf(path.stroke),path.points,!!path.closed);
 for(const {center:[x,y],radius,arc,hidden,thin} of layout.circles){
  const layer=hidden?layers.hidden:thin?extraLayers.thread:layers.visible;
  if(!arc||Math.abs(arc.sweep)>=2*Math.PI-1e-12){entity('CIRCLE',layer,'AcDbCircle');point(x,y);pair(40,number(radius));continue;}
  // ARC runs counter-clockwise from 50 to 51.
  const [from,to]=arc.sweep>=0?[arc.start,arc.start+arc.sweep]:[arc.start+arc.sweep,arc.start];
  entity('ARC',layer,'AcDbCircle');point(x,y);pair(40,number(radius));
  if(r2000)pair(100,'AcDbArc');
  pair(50,degrees(from));pair(51,degrees(to));
 }
 for(const ellipse of layout.ellipses??[]){
  const layer=layers[ellipse.hidden?'hidden':'visible'],full=ellipse.sweep>=2*Math.PI-1e-12;
  if(r2000){
   entity('ELLIPSE',layer,'AcDbEllipse');
   point(ellipse.center[0],ellipse.center[1]);
   pair(11,number(ellipse.major[0]));pair(21,number(ellipse.major[1]));pair(31,'0.0');
   pair(210,'0.0');pair(220,'0.0');pair(230,'1.0');
   pair(40,number(ellipse.ratio));
   const start=full?0:((ellipse.start%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
   pair(41,number(start));pair(42,number(full?2*Math.PI:start+ellipse.sweep));
   continue;
  }
  // R12: a polyline whose chords stay within the tolerance (sag ≤ a·step²/8 on the major axis).
  const a=Math.hypot(...ellipse.major),step=Math.min(Math.PI/32,Math.sqrt(8*DXF_ELLIPSE_TOLERANCE/Math.max(a,1e-9)));
  const count=Math.max(2,Math.ceil(ellipse.sweep/step));
  const points=Array.from({length:full?count:count+1},(_,i)=>ellipsePoint(ellipse,ellipse.start+ellipse.sweep*i/count));
  polyline(layer,points,full);
 }
 for(const text of layout.texts)if(!inBlocks.texts.has(text))textEntity(text);
 // DIMENSION entities, each naming its block.
 const lengthFactor=1/(layout.factor||1);
 for(const [i,dimension] of dimensions.entries()){
  entity('DIMENSION',layers.annotation,'AcDbDimension');
  pair(2,`*D${i+1}`);
  const [p0,p1,p2]=dimension.points;
  const definition=dimension.kind==='diameter'?p1:dimension.kind==='radius'?p0:p2;
  point(definition[0],definition[1]);
  const first=dimension.texts[0],size=first?.size??2.5,width=helveticaWidth(dimension.text,size);
  const middle=first?.angle===90?[dimension.textAt[0]-size/2,dimension.textAt[1]+width/2]:[dimension.textAt[0]+width/2,dimension.textAt[1]+size/2];
  point(middle[0],middle[1],11);
  // 32: the block belongs to this dimension only; 128: the text stays where the sheet put it.
  pair(70,{rotated:0,aligned:1,diameter:3,radius:4}[dimension.kind]|32|128);
  pair(71,5);pair(42,number(dimension.measurement));pair(1,dimension.text);
  if(first?.angle)pair(53,number(first.angle));
  pair(3,'Standard');
  if(dimension.kind==='rotated'||dimension.kind==='aligned'){
   pair(100,'AcDbAlignedDimension');point(p0[0],p0[1],13);point(p1[0],p1[1],14);
   if(dimension.kind==='rotated'){pair(50,number(dimension.angle??0));pair(100,'AcDbRotatedDimension');}
  }else{
   pair(100,dimension.kind==='diameter'?'AcDbDiametricDimension':'AcDbRadialDimension');
   const on=dimension.kind==='diameter'?p0:p1;
   point(on[0],on[1],15);pair(40,'0.0');
  }
  // DIMLFAC (144) of this dimension: paper millimetres times this are model millimetres.
  pair(1001,'ACAD');pair(1000,'DSTYLE');pair(1002,'{');pair(1070,144);pair(1040,number(lengthFactor));pair(1002,'}');
 }
 pair(0,'ENDSEC');

 // Objects (R2000): the root dictionary and its group dictionary.
 if(r2000){
  const root=handle(),groups=handle();
  pair(0,'SECTION');pair(2,'OBJECTS');
  pair(0,'DICTIONARY');pair(5,root);pair(330,'0');pair(100,'AcDbDictionary');pair(281,1);pair(3,'ACAD_GROUP');pair(350,groups);
  pair(0,'DICTIONARY');pair(5,groups);pair(330,root);pair(100,'AcDbDictionary');pair(281,1);
  pair(0,'ENDSEC');
 }
 pair(0,'EOF');
 // The handle seed, now that every handle is known: the next free one.
 if(seedAt>=0)out.splice(seedAt,0,...[...next.toString(16).toUpperCase()].map(c=>c.charCodeAt(0)));
 return Uint8Array.from(out);
}

/** The first page of a sheet (the views) as a DXF file in paper millimetres. Parts list pages stay in the PDF. */
export function exportDrawingDxf(layout:DrawingLayout,title:string,version:DxfVersion='R2000'){
 if(layout.annotationIssues.length)throw new Error(t('Repair or remove unavailable drawing dimensions before exporting.'));
 return {name:drawingFileName(title,'.dxf'),mime:'image/vnd.dxf',bytes:drawingDxfBytes(layout,version)};
}
