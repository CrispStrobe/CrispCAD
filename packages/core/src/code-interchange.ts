// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {CadCodeError,compileCode} from './code.js';
import type {CodeProgram,CodeShape,CodeProfile} from './code.js';
export {importOpenSCAD} from './openscad-import.js';
const vec=(v:readonly number[])=>`[${v.join(', ')}]`;

function scadProfile(p:CodeProfile):string{
 if(p.kind==='empty')return 'union() {}';
 if(p.kind==='rectangle')return `square(${vec(p.size)}, center=${p.center});`;
 if(p.kind==='circle')return `circle(r=${p.radius}, $fn=${p.segments});`;
 if(p.kind==='polygon'){let offset=0;const points=p.contours.flat(),paths=p.contours.map(c=>c.map(()=>offset++));return `polygon(points=[${points.map(vec).join(', ')}], paths=[${paths.map(vec).join(', ')}]);`;}
 if('profiles'in p)return `${p.kind==='subtract'?'difference':p.kind==='intersect'?'intersection':p.kind}() {${p.profiles.map(scadProfile).join('\n')}}`;
 return `${p.kind==='move'?'translate':p.kind}(${p.kind==='rotate'?p.angle:vec(p.vector)}) ${scadProfile(p.profile)}`;
}
function jscadProfile(p:CodeProfile):string{
 if(p.kind==='empty')return 'geom2.create()';if(p.kind==='rectangle')return `translate(${vec(p.center?[0,0]:p.size.map(v=>v/2))}, rectangle({size:${vec(p.size)}}))`;
 if(p.kind==='circle')return `circle({radius:${p.radius}, segments:${p.segments}})`;
 if(p.kind==='polygon'){const parts=p.contours.map(c=>{const area=c.reduce((a,p,i)=>a+p[0]*c[(i+1)%c.length][1]-c[(i+1)%c.length][0]*p[1],0);return `polygon({points:[${(area<0?[...c].reverse():c).map(vec).join(', ')}]})`;});return parts.length?parts.reduce((a,b)=>`xorProfile(${a},${b})`):'geom2.create()';}
 if('profiles'in p)return p.profiles.length===1&&p.kind!=='hull'?jscadProfile(p.profiles[0]):`${p.kind}(${p.profiles.map(jscadProfile).join(', ')})`;
 return `${p.kind==='move'?'translate':p.kind==='rotate'?'rotateZ':'scale'}(${p.kind==='rotate'?p.angle*Math.PI/180:vec(p.vector)}, ${jscadProfile(p.profile)})`;
}

/** Evaluated CSG snapshot: explicit values, operation order, centering and segments. */
export function exportOpenSCAD(program:CodeProgram):string{
 const root=compileCode(program).shape;
 function shape(s:CodeShape,depth=0):string{const pad='  '.repeat(depth),child=(node:CodeShape)=>shape(node,depth+1);
  if(s.kind==='empty')return `${pad}union() {}`;
  if(s.kind==='profile-extrude')return `${pad}linear_extrude(height=${s.height}, twist=${-s.twist}, slices=${s.steps}, scale=${vec(s.scaleTop)}) ${scadProfile(s.profile)}`;
  if(s.kind==='revolve')return `${pad}rotate_extrude(angle=${s.angle}, $fn=${s.segments}) ${scadProfile(s.profile)}`;
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
 function shape(s:CodeShape):string{if(s.kind==='profile-extrude'){if(s.scaleTop.some(v=>v!==1))throw new CadCodeError(t('JSCAD export of tapered profiles requires slice extrusion'),0,program.source,'unsupported-feature');return `extrudeLinear({height:${s.height},twistAngle:${s.twist*Math.PI/180},twistSteps:${s.steps}}, ${jscadProfile(s.profile)})`;}if(s.kind==='revolve'&&s.angle===0)return 'geom3.create()';if(s.kind==='revolve')return `extrudeRotate({angle:${s.angle*Math.PI/180},segments:${s.segments}}, ${jscadProfile(s.profile)})`;if(s.kind==='empty')return 'geom3.create()';if(s.kind==='extrude')return `extrudeLinear({height: ${s.height}}, polygon({points: [${s.points.map(vec).join(', ')}]}))`;if(s.kind==='box')return `cuboid({size: ${vec(s.size)}})`;if(s.kind==='cylinder')return `cylinder({radius: ${s.radius}, height: ${s.height}, segments: ${s.segments}})`;if(s.kind==='frustum')return `cylinderElliptic({height: ${s.height}, startRadius: [${s.bottom}, ${s.bottom}], endRadius: [${s.top}, ${s.top}], segments: ${s.segments}})`;if(s.kind==='sphere')return `sphere({radius: ${s.radius}, segments: ${s.segments}})`;if('shapes'in s)return `${s.kind==='intersect'?'intersect':s.kind}(${s.shapes.map(shape).join(',\n    ')})`;if(s.kind==='repeat')return `union(${Array.from({length:s.count},(_,i)=>`translate(${vec(s.step.map(v=>v*i))}, ${shape(s.shape)})`).join(',\n    ')})`;return `${s.kind==='move'?'translate':s.kind}(${vec(s.vector.map(v=>s.kind==='rotate'?v*Math.PI/180:v))}, ${shape(s.shape)})`;}
 return `// Evaluated construction snapshot. Dimensions: mm. Rotation: radians.\n// Keep the native source for further parametric edits.\nconst {geometries: {geom2, geom3}, primitives: {cuboid, cylinder, cylinderElliptic, sphere, polygon, rectangle, circle}, extrusions: {extrudeLinear, extrudeRotate}, booleans: {union, subtract, intersect}, hulls: {hull}, transforms: {translate, rotate, rotateZ, scale}} = require('@jscad/modeling');\n\nconst xorProfile = (a,b) => union(subtract(a,b),subtract(b,a));\nconst main = () => ${shape(compileCode(program).shape)};\nmodule.exports = {main};\n`;
}
/** Text source with local overrides applied as new defaults, preserving formulas. */
export function exportCodeSource(program:CodeProgram):string{
 compileCode(program);const tokens=[...program.source.matchAll(/\/\/[^\n]*|;|[A-Za-z][A-Za-z0-9_]*|[^\s]/g)].filter(m=>!m[0].startsWith('//'));const edits:{start:number;end:number;value:string}[]=[];
 for(let i=0;i<tokens.length;){let end=i;while(end<tokens.length&&tokens[end][0]!==';')end++;if(tokens[i][0]==='param'){const name=tokens[i+1][0];if(Object.hasOwn(program.parameters,name)){const equal=tokens.slice(i,end).find(token=>token[0]==='=')!;edits.push({start:equal.index!+1,end:tokens[end].index!,value:' '+program.parameters[name]});}}i=end+1;}
 let source=program.source;for(const edit of edits.reverse())source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);return source;
}
