// SPDX-License-Identifier: BSD-3-Clause
import {isSketchPoint, maxSketchOutlinePoints, sketchOutline, t} from '@brickwright/cad-core';
import type {SketchPoint, SketchProfile} from '@brickwright/cad-core';

export const maxSketchDxfBytes = 1024 * 1024;
type Group = {code: number; value: string};
const mmPerUnit: Record<number, number> = {1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000};

export function readSketchDxf(source: string, assumeMm = false): SketchProfile {
  const invalid = () => new Error(t('This file is not a supported text DXF drawing.'));
  const unsupported = () => new Error(t('Use one circle or one closed, straight 2D lightweight polyline. Remove other drawing entities before importing.'));
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

  const [entity, ...fields] = sections.get('ENTITIES') ?? [];
  if (entity?.code !== 0 || fields.some(group => group.code === 0)) throw unsupported();
  if (entity.value !== 'CIRCLE' && entity.value !== 'LWPOLYLINE') throw unsupported();
  const read = (code: number, fallback?: number) => {
    const matches = fields.filter(group => group.code === code);
    if (matches.length > 1) throw invalid();
    return matches.length === 0 && fallback !== undefined ? fallback : number(matches[0]?.value);
  };
  if (read(67, 0) !== 0 || (fields.find(group => group.code === 410)?.value ?? 'Model').toUpperCase() !== 'MODEL' ||
      read(210, 0) !== 0 || read(220, 0) !== 0 || read(230, 1) !== 1 ||
      fields.some(group => [30, 38, 39, 40, 41, 42, 43].includes(group.code) &&
        !(entity.value === 'CIRCLE' && group.code === 40) && number(group.value) !== 0)) throw unsupported();

  if (entity.value === 'CIRCLE') {
    const radius = read(40) * scale;
    const center: SketchPoint = [read(10) * scale, read(20) * scale];
    if (radius < .01 || radius > 100000) throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
    if (!isSketchPoint(center)) throw new Error(t('Circle center must be within 100000 mm of the sketch origin.'));
    return {kind: 'circle', id: 'dxf-profile', radius, segments: 64, center};
  }

  const flags = read(70);
  const count = read(90);
  if ((flags !== 1 && flags !== 129) || !Number.isInteger(count) || count < 3 || count > maxSketchOutlinePoints) throw unsupported();
  const coordinates = fields.filter(group => group.code === 10 || group.code === 20);
  if (coordinates.length !== count * 2) throw invalid();
  const points: SketchPoint[] = [];
  for (let i = 0; i < coordinates.length; i += 2) {
    if (coordinates[i].code !== 10 || coordinates[i + 1].code !== 20) throw invalid();
    points.push([number(coordinates[i].value) * scale, number(coordinates[i + 1].value) * scale]);
  }
  return {kind: 'outline', id: 'dxf-profile', points: sketchOutline(points)};
}
