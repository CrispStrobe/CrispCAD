// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketchRegion, isSketchDxfLayer, isSketchPoint, maxSketchRegionLoops, maxSketchOutlinePoints, sketchOutline, t} from '@brickwright/cad-core';
import type {SketchLoop, SketchPoint, SketchProfile} from '@brickwright/cad-core';
import {joinDxfEdges} from './sketch-dxf-chains.js';
import type {DxfEdge} from './sketch-dxf-chains.js';

export const maxSketchDxfBytes = 1024 * 1024;
type DxfLoop = Omit<Extract<SketchLoop,{kind:'outline'}>,'id'> |
  (Omit<Extract<SketchLoop,{kind:'circle'}>,'id'|'center'> & {center:SketchPoint});
type Group = {code: number; value: string};
const mmPerUnit: Record<number, number> = {1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000};

export function readSketchDxf(source: string, assumeMm = false): SketchProfile {
  const invalid = () => new Error(t('This file is not a supported text DXF drawing.'));
  const unsupported = () => new Error(t('Use circles, closed lightweight polylines, or closed chains of 2D lines and arcs. Remove unsupported entities before importing.'));
  if (source.length > maxSketchDxfBytes || source.includes('\0')) throw invalid();
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length % 2 !== 0) throw invalid();
  const groups: Group[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = lines[i].trim();
    if (!/^\d{1,4}$/.test(code)) throw invalid();
    if (Number(code) !== 999) groups.push({code: Number(code), value: lines[i + 1].trim()});
  }
  const number = (value: string | undefined) => {
    if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw invalid();
    const result = Number(value);
    if (!Number.isFinite(result)) throw invalid();
    return result;
  };
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
  const scale = units === 0 && assumeMm ? 1 : mmPerUnit[units];
  if (!scale) throw new Error(units === 0
    ? t('This DXF has no units. If the coordinates are in millimetres, enable the missing-units option and import again.')
    : t('DXF import supports millimetres, centimetres, metres, inches and feet.'));

  const entities: Group[][] = [];
  for (const group of sections.get('ENTITIES') ?? []) {
    if (group.code === 0) entities.push([group]);
    else if (entities.length) entities.at(-1)!.push(group);
    else throw invalid();
  }
  if (!entities.length || entities.length > maxSketchRegionLoops * (maxSketchOutlinePoints + 1)) throw unsupported();
  const indexed:({index:number}&DxfLoop)[]=[];
  const edges:DxfEdge[]=[];
  for (const [index,[entity,...fields]] of entities.entries()) {
    if (!['CIRCLE','ARC','LINE','LWPOLYLINE'].includes(entity.value)) throw unsupported();
    const layer = fields.filter(group => group.code === 8);
    if (layer.length > 1 || (layer.length === 1 && !isSketchDxfLayer(layer[0].value))) {
      throw new Error(t('Invalid DXF layer name.'));
    }
    const dxfLayer = layer.length && layer[0].value !== '0' ? {dxfLayer: layer[0].value} : {};

    const read = (code: number, fallback?: number) => {
      const matches = fields.filter(group => group.code === code);
      if (matches.length > 1) throw invalid();
      return matches.length === 0 && fallback !== undefined ? fallback : number(matches[0]?.value);
    };
    if (read(67, 0) !== 0 || (fields.find(group => group.code === 410)?.value ?? 'Model').toUpperCase() !== 'MODEL' ||
        read(210, 0) !== 0 || read(220, 0) !== 0 || read(230, 1) !== 1 ||
        fields.some(group => [30, 38, 39, 40, 41, 42, 43].includes(group.code) &&
          !(['CIRCLE','ARC'].includes(entity.value) && group.code === 40) &&
          !(entity.value === 'LWPOLYLINE' && group.code === 42) && number(group.value) !== 0)) throw unsupported();

    if (entity.value === 'LINE') {
      if (read(31,0) !== 0) throw unsupported();
      edges.push({index, a:[read(10)*scale,read(20)*scale], b:[read(11)*scale,read(21)*scale],bulge:0,...dxfLayer});
      continue;
    }
    if (entity.value === 'CIRCLE' || entity.value === 'ARC') {
      const radius = read(40) * scale;
      const center: SketchPoint = [read(10) * scale, read(20) * scale];
      if (radius < .01 || radius > 100000) throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
      if (!isSketchPoint(center)) throw new Error(t('Circle center must be within 100000 mm of the sketch origin.'));
      if (entity.value === 'CIRCLE') {
        indexed.push({index,kind:'circle',radius,segments:64,center,...dxfLayer});
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
          return [center[0]+radius*x,center[1]+radius*y];
        };
        if (!sweep) throw unsupported();
        edges.push({index,a:point(start),b:point(end),bulge:sweep===180?1:Math.tan(sweep*Math.PI/720),...dxfLayer});
      }
      continue;
    }

    const flags = read(70);
    const count = read(90);
    if ((flags !== 1 && flags !== 129) || !Number.isInteger(count) || count < 2 || count > maxSketchOutlinePoints) throw unsupported();
    const coordinates = fields.filter(group => [10, 20, 42].includes(group.code));
    const points: SketchPoint[] = [];
    const bulges: number[] = [];
    for (let i = 0; i < coordinates.length;) {
      const x = coordinates[i++], y = coordinates[i++];
      if (x.code !== 10 || y?.code !== 20) throw invalid();
      points.push([number(x.value) * scale, number(y.value) * scale]);
      bulges.push(coordinates[i]?.code === 42 ? number(coordinates[i++].value) : 0);
    }
    if (points.length !== count) throw invalid();
    if (bulges.some(Boolean)) {
      sketchOutline(points, bulges);
      indexed.push({index,kind:'outline',points,bulges,...dxfLayer});
    } else indexed.push({index,kind:'outline',points:sketchOutline(points),...dxfLayer});
  }
  indexed.push(...joinDxfEdges(edges));
  const loops=indexed.sort((a,b)=>a.index-b.index).map(({index: _index,...loop},i)=>({...loop,id:'dxf-loop-'+(i+1)}));
  if (loops.length > maxSketchRegionLoops) throw unsupported();
  if (loops.length === 1) return {...loops[0],id:'dxf-profile'};
  evaluateSketchRegion(loops);
  return {kind:'region', id:'dxf-profile', loops};
}
