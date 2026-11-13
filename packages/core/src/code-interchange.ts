// SPDX-License-Identifier: BSD-3-Clause
import {compileCode} from './code.js';
import type {CodeProgram,CodeShape} from './code.js';
export {importOpenSCAD} from './openscad-import.js';
const vec=(v:readonly number[])=>`[${v.join(', ')}]`;
/** Evaluated CSG snapshot: explicit values, operation order, centering and segments. */
export function exportOpenSCAD(program:CodeProgram):string{
 const root=compileCode(program).shape;
 function shape(s:CodeShape,depth=0):string{const pad='  '.repeat(depth),child=(node:CodeShape)=>shape(node,depth+1);
  if(s.kind==='empty')return `${pad}union() {}`;
  if(s.kind==='extrude')return `${pad}linear_extrude(height = ${s.height}) polygon(points = [${s.points.map(vec).join(', ')}]);`;
  if(s.kind==='box')return `${pad}cube(${vec(s.size)}, center = true);`;
  if(s.kind==='cylinder')return `${pad}cylinder(h = ${s.height}, r = ${s.radius}, center = true, $fn = ${s.segments});`;
  if(s.kind==='frustum')return `${pad}cylinder(h = ${s.height}, r1 = ${s.bottom}, r2 = ${s.top}, center = true, $fn = ${s.segments});`;
  if(s.kind==='sphere')return `${pad}sphere(r = ${s.radius}, $fn = ${s.segments});`;
  if('shapes'in s)return `${pad}${s.kind==='hull'?'hull':s.kind==='subtract'?'difference':s.kind==='intersect'?'intersection':'union'}() {\n${s.shapes.map(child).join('\n')}\n${pad}}`;
  if(s.kind==='repeat')return `${pad}union() {\n${Array.from({length:s.count},(_,i)=>`${pad}  translate(${vec(s.step.map(v=>v*i))})\n${shape(s.shape,depth+2)}`).join('\n')}\n${pad}}`;
  return `${pad}${s.kind==='move'?'translate':s.kind}(${vec(s.vector)})\n${child(s.shape)}`;
 }
 return '// Evaluated construction snapshot from Brickwright CAD. Units: mm / degrees.\n// Source parameters are resolved; keep the native source for further parametric edits.\n'+shape(root)+'\n';
}
export function exportJSCAD(program:CodeProgram):string{
 function shape(s:CodeShape):string{if(s.kind==='empty')return 'geom3.create()';if(s.kind==='extrude')return `extrudeLinear({height: ${s.height}}, polygon({points: [${s.points.map(vec).join(', ')}]}))`;if(s.kind==='box')return `cuboid({size: ${vec(s.size)}})`;if(s.kind==='cylinder')return `cylinder({radius: ${s.radius}, height: ${s.height}, segments: ${s.segments}})`;if(s.kind==='frustum')return `cylinderElliptic({height: ${s.height}, startRadius: [${s.bottom}, ${s.bottom}], endRadius: [${s.top}, ${s.top}], segments: ${s.segments}})`;if(s.kind==='sphere')return `sphere({radius: ${s.radius}, segments: ${s.segments}})`;if('shapes'in s)return `${s.kind==='intersect'?'intersect':s.kind}(${s.shapes.map(shape).join(',\n    ')})`;if(s.kind==='repeat')return `union(${Array.from({length:s.count},(_,i)=>`translate(${vec(s.step.map(v=>v*i))}, ${shape(s.shape)})`).join(',\n    ')})`;return `${s.kind==='move'?'translate':s.kind}(${vec(s.vector.map(v=>s.kind==='rotate'?v*Math.PI/180:v))}, ${shape(s.shape)})`;}
 return `// Evaluated construction snapshot. Dimensions: mm. Rotation: radians.\n// Keep the native source for further parametric edits.\nconst {geometries: {geom3}, primitives: {cuboid, cylinder, cylinderElliptic, sphere, polygon}, extrusions: {extrudeLinear}, booleans: {union, subtract, intersect}, hulls: {hull}, transforms: {translate, rotate, scale}} = require('@jscad/modeling');\n\nconst main = () => ${shape(compileCode(program).shape)};\nmodule.exports = {main};\n`;
}
/** Text source with local overrides applied as new defaults, preserving formulas. */
export function exportCodeSource(program:CodeProgram):string{
 compileCode(program);const tokens=[...program.source.matchAll(/\/\/[^\n]*|;|[A-Za-z][A-Za-z0-9_]*|[^\s]/g)].filter(m=>!m[0].startsWith('//'));const edits:{start:number;end:number;value:string}[]=[];
 for(let i=0;i<tokens.length;){let end=i;while(end<tokens.length&&tokens[end][0]!==';')end++;if(tokens[i][0]==='param'){const name=tokens[i+1][0];if(Object.hasOwn(program.parameters,name)){const equal=tokens.slice(i,end).find(token=>token[0]==='=')!;edits.push({start:equal.index!+1,end:tokens[end].index!,value:' '+program.parameters[name]});}}i=end+1;}
 let source=program.source;for(const edit of edits.reverse())source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);return source;
}
