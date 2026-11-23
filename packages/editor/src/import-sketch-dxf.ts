// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketchRegion, isDxfSegmentWidth, isSketchDxfLayer, isSketchPoint, maxSketchRegionLoops, maxSketchOutlinePoints, sketchOutline, sketchPath, t} from '@brickwright/cad-core';
import type {DxfSegmentWidth, SketchLoop, SketchPoint, SketchProfile, Vec3} from '@brickwright/cad-core';
import {dxfRecords,readDxfLayerStyles} from './dxf-layer-tables.js';
import type {DxfGroup as Group} from './dxf-layer-tables.js';
import {dxfEntityFields,dxfPaperSpaceOwners,isDxfPaperSpace} from './dxf-model-space.js';
import {dxfObjectPlane,dxfSketchPlane} from './dxf-sketch-plane.js';
import {joinDxfEdges} from './sketch-dxf-chains.js';
import type {DxfEdge} from './sketch-dxf-chains.js';

import {maxSketchExchangeBytes} from './sketch-exchange-limits.js';
type DxfLoop = Omit<Extract<SketchLoop,{kind:'outline'}>,'id'> |
  (Omit<Extract<SketchLoop,{kind:'circle'}>,'id'|'center'> & {center:SketchPoint});
type DxfPath=Extract<SketchProfile,{kind:'path'}>;
export type DxfSketchImport<P>={profile:P;unfolded:boolean};
const mmPerUnit: Record<number, number> = {1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000};

type DxfEntity={kind:string;fields:Group[];layer:string};

export function readSketchDxf(source:string,assumeMm=false):SketchProfile{
 return prepareSketchDxf(source).outline(assumeMm).profile;
}

export function readSketchPathDxf(source:string,assumeMm=false):DxfPath{
 return prepareSketchDxf(source).path(assumeMm).profile;
}

const invalid=()=>new Error(t('This file is not a supported text DXF drawing.'));
const number=(value:string|undefined)=>{
 if(!value||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))throw invalid();
 const result=Number(value);
 if(!Number.isFinite(result))throw invalid();
 return result;
};

/** Catalog model-space layers before validating the geometry in the selected layers. */
export function prepareSketchDxf(source:string){
  if (source.length > maxSketchExchangeBytes || source.includes('\0')) throw invalid();
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length % 2 !== 0) throw invalid();
  const groups: Group[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = lines[i].trim();
    if (!/^\d{1,4}$/.test(code)) throw invalid();
    if (Number(code) !== 999) groups.push({code: Number(code), value: lines[i + 1].trim()});
  }
  const sections = new Map<string, Group[]>();
  for (let i = 0; i < groups.length;) {
    const group = groups[i++];
    if (group.code === 0 && group.value === 'EOF' && i === groups.length) break;
    const section = groups[i++];
    if (group.code !== 0 || group.value !== 'SECTION' || section?.code !== 2 || sections.has(section.value)) throw invalid();
    const start = i;
    while (i < groups.length && (groups[i].code !== 0 || groups[i].value !== 'ENDSEC')) i++;
    if (i === groups.length) throw invalid();
    sections.set(section.value, groups.slice(start, i++));
  }
  if (groups.at(-1)?.code !== 0 || groups.at(-1)?.value !== 'EOF') throw invalid();

  const header = sections.get('HEADER') ?? [];
  const unitsIndex = header.findIndex(group => group.code === 9 && group.value === '$INSUNITS');
  if (unitsIndex !== -1 && header[unitsIndex + 1]?.code !== 70) throw invalid();
  const units = unitsIndex === -1 ? 0 : number(header[unitsIndex + 1].value);
  const tables=sections.get('TABLES')??[],paperOwners=dxfPaperSpaceOwners(tables);
  const entityGroups=sections.get('ENTITIES')??[];
  if(entityGroups.length&&entityGroups[0].code!==0)throw invalid();
  const records=dxfRecords(entityGroups);
  const entities:DxfEntity[]=[],names=new Map<string,string>();
  let skippedPaperSpace=false;
  for(let i=0;i<records.length;i++){
    const [entity,...groups]=records[i],kind=entity.value,fields=dxfEntityFields(groups);

    // Subentities belong to their parent, even if their own layer is different.
    const child=kind==='POLYLINE'?'VERTEX':kind==='INSERT'&&fields.some(group=>group.code===66&&group.value==='1')?'ATTRIB':undefined;
    if(child){
      while(records[i+1]?.[0].value===child)i++;
      if(records[i+1]?.[0].value!=='SEQEND')throw invalid();
      i++;
    }
    if(isDxfPaperSpace(fields,paperOwners)){skippedPaperSpace=true;continue;}
    const layerFields=fields.filter(group=>group.code===8);
    const layer=layerFields[0]?.value??'0';
    if(layerFields.length>1||!layer||layer.length>255)throw new Error(t('Invalid DXF layer name.'));
    entities.push({kind,fields,layer});
    if(!names.has(layer.toUpperCase()))names.set(layer.toUpperCase(),layer);
  }
  const pick=(selected?:readonly string[])=>{
    if(!selected)return entities;
    const keys=new Set(selected.map(layer=>layer.toUpperCase()));
    if(!keys.size)throw new Error(t('Select at least one DXF layer.'));
    if([...keys].some(key=>!names.has(key)))throw new Error(t('Selected DXF layers are unavailable in this file.'));
    return entities.filter(entity=>keys.has(entity.layer.toUpperCase()));
  };
  return {
    skippedPaperSpace,
    layers:[...names.values()] as readonly string[],
    outline:(assumeMm=false,selected?:readonly string[])=>readDxf(pick(selected),tables,units,assumeMm,'outline'),
    path:(assumeMm=false,selected?:readonly string[])=>readDxf(pick(selected),tables,units,assumeMm,'path')
  };
}

function readDxf(entities:DxfEntity[],tables:Group[],units:number,assumeMm:boolean,mode:'path'):DxfSketchImport<DxfPath>;
function readDxf(entities:DxfEntity[],tables:Group[],units:number,assumeMm:boolean,mode:'outline'):DxfSketchImport<SketchProfile>;
function readDxf(entities:DxfEntity[],tables:Group[],units:number,assumeMm:boolean,mode:'outline'|'path'):DxfSketchImport<SketchProfile>{
  const closed=mode==='outline';
  const unsupported=()=>new Error(closed
    ?t('Use circles, closed lightweight polylines, or closed chains of 2D lines and arcs. Exclude layers with unsupported entities or remove those entities before importing.')
    :t('Use one open lightweight polyline or one connected chain of planar lines and arcs.'));
  if(!entities.length)throw new Error(t('This DXF has no model-space entities to import.'));
  const scale=units===0&&assumeMm?1:mmPerUnit[units];
  if(!scale)throw new Error(units===0
    ?t('This DXF has no units. If the coordinates are in millimetres, enable the missing-units option and import again.')
    :t('DXF import supports millimetres, centimetres, metres, inches and feet.'));
  if(entities.length>maxSketchRegionLoops*(maxSketchOutlinePoints+1))throw unsupported();
  const styles=readDxfLayerStyles(tables,scale);
  const indexed:({index:number}&DxfLoop)[]=[];
  const edges:DxfEdge[]=[];
  const paths:DxfPath[]=[];
  const prepared=entities.map(({kind,fields,layer},index)=>{
    if(!['CIRCLE','ARC','LINE','LWPOLYLINE'].includes(kind)||!closed&&kind==='CIRCLE')throw unsupported();
    if(!isSketchDxfLayer(layer))throw new Error(t('Invalid DXF layer name.'));
    const style=styles.get(layer.toUpperCase());
    const binding={...(layer==='0'?{}:{dxfLayer:layer}),...(style?{dxfLayerStyle:style}:{})};
    const read=(code:number,fallback?:number)=>{
      const matches=fields.filter(group=>group.code===code);
      if(matches.length>1)throw invalid();
      return !matches.length&&fallback!==undefined?fallback:number(matches[0]?.value);
    };
    if(read(67,0)!==0||fields.some(group=>{
      if(group.code===39)return number(group.value)!==0;
      if(kind==='LWPOLYLINE')return group.code===30&&number(group.value)!==0;
      return [38,41,42,43].includes(group.code)&&number(group.value)!==0;
    }))throw unsupported();
    if(kind==='LINE'){
      if(read(40,0)!==0)throw unsupported();
      const point=(offset:number):Vec3=>[read(10+offset)*scale,read(20+offset)*scale,read(30+offset,0)*scale];
      return {kind,index,binding,points:[point(0),point(1)] as [Vec3,Vec3]};
    }
    const plane=dxfObjectPlane([read(210,0),read(220,0),read(230,1)],read(kind==='LWPOLYLINE'?38:30,0)*scale);
    return {kind,index,binding,fields,read,plane};
  });
  const frame=dxfSketchPlane(prepared.flatMap(entity=>entity.plane?[entity.plane]:[]),prepared.flatMap(entity=>entity.points??[]));
  const result=<P extends SketchProfile>(profile:P):DxfSketchImport<P>=>({profile,unfolded:frame.unfolded});
  for(const entity of prepared){
    const {index,binding,kind}=entity;
    if(!entity.plane){
      edges.push({index,a:frame.project(entity.points[0]),b:frame.project(entity.points[1]),bulge:0,...binding});
      continue;
    }
    const {read,fields}=entity,{project,handedness}=frame.orient(entity.plane);
    if (kind === 'CIRCLE' || kind === 'ARC') {
      const radius = read(40) * scale;
      const localCenter:SketchPoint=[read(10)*scale,read(20)*scale],center=project(localCenter);
      if (radius < .01 || radius > 100000) throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
      if (!isSketchPoint(center)) throw new Error(t('Circle center must be within 100000 mm of the sketch origin.'));
      if (kind === 'CIRCLE') {
        indexed.push({index,kind:'circle',radius,segments:64,center,...binding});
      } else {
        const normalize=(degrees:number)=>{
          const turn=degrees%360;
          return turn<0?turn+360:turn;
        };
        const start=normalize(read(50)),end=normalize(read(51)),sweep=normalize(end-start);
        const point=(degrees:number):SketchPoint=>{
          const cardinal=[[1,0],[0,1],[-1,0],[0,-1]][degrees/90];
          const angle=degrees*Math.PI/180;
          const [x,y]=cardinal??[Math.cos(angle),Math.sin(angle)];
          return project([localCenter[0]+radius*x,localCenter[1]+radius*y]);
        };
        if (!sweep) throw unsupported();
        edges.push({index,a:point(start),b:point(end),bulge:handedness*(sweep===180?1:Math.tan(sweep*Math.PI/720)),...binding});
      }
      continue;
    }

    const flags = read(70,closed?undefined:0);
    const count = read(90);
    if (!(closed?[1,129]:[0,128]).includes(flags) || !Number.isInteger(count) || count < 2 || count > maxSketchOutlinePoints) throw unsupported();
    const coordinates=fields.filter(group=>[10,20,40,41,42].includes(group.code));
    const constant=read(43,0)*scale;
    if(!isDxfSegmentWidth([constant,constant]))throw invalid();
    const points: SketchPoint[] = [];
    const bulges:number[]=[],widths:DxfSegmentWidth[]=[];
    for (let i = 0; i < coordinates.length;) {
      const x = coordinates[i++], y = coordinates[i++];
      if (x.code !== 10 || y?.code !== 20) throw invalid();
      points.push(project([number(x.value)*scale,number(y.value)*scale]));
      const attributes=new Map<number,number>();
      while(i<coordinates.length&&coordinates[i].code!==10){
        const {code,value}=coordinates[i++];
        if(![40,41,42].includes(code)||attributes.has(code))throw invalid();
        attributes.set(code,number(value));
      }
      bulges.push((attributes.get(42)??0)*handedness||0);
      const width:DxfSegmentWidth=[(attributes.get(40)??0)*scale,(attributes.get(41)??0)*scale];
      if(!isDxfSegmentWidth(width))throw invalid();
      widths.push(width);
    }
    if (points.length !== count) throw invalid();
    if(!closed)widths[widths.length-1]=[0,0];
    const varying=widths.some(pair=>pair.some(Boolean));
    if(constant&&varying)throw new Error(t('Use either a constant DXF width or per-segment widths in the same polyline.'));
    const activeWidths=constant?widths.map((pair,i):DxfSegmentWidth=>closed||i<widths.length-1?[constant,constant]:pair):widths;
    const widthFields=constant||varying?{dxfWidths:activeWidths}:{};
    if(!closed){
      bulges[bulges.length-1]=0; // An open polyline has no segment after its last vertex.
      const curves=bulges.some(Boolean)?bulges:undefined;
      sketchPath(points,curves);
      paths.push({kind:'path',id:'dxf-profile',points,...(curves?{bulges:curves}:{}),...widthFields,...binding});
      continue;
    }
    const curves=bulges.some(Boolean)?bulges:undefined;
    const contour=sketchOutline(points,curves);
    indexed.push({index,kind:'outline',points:curves||constant||varying?points:contour,
     ...(curves?{bulges:curves}:{}),...widthFields,...binding});
  }
  if(!closed){
    if(paths.length===1&&!edges.length)return result(paths[0]);
    if(paths.length||!edges.length)throw unsupported();
    const {points,bulges,dxfLayer,dxfLayerStyle}=joinDxfEdges(edges,'path')[0];
    return result({kind:'path',id:'dxf-profile',points,...(bulges?{bulges}:{}),...(dxfLayer?{dxfLayer}:{}),...(dxfLayerStyle?{dxfLayerStyle}:{})});
  }
  indexed.push(...joinDxfEdges(edges,'outline').map(loop=>({...loop,kind:'outline' as const})));
  const loops=indexed.sort((a,b)=>a.index-b.index).map(({index: _index,...loop},i)=>({...loop,id:'dxf-loop-'+(i+1)}));
  if (loops.length > maxSketchRegionLoops) throw unsupported();
  if (loops.length === 1) return result({...loops[0],id:'dxf-profile'});
  evaluateSketchRegion(loops);
  return result({kind:'region',id:'dxf-profile',loops});
}
