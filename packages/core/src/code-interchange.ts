// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {CadCodeError,compileCode} from './code.js';
import type {CodeProgram,CodeShape,CodeProfile} from './code.js';
export {importOpenSCAD} from './openscad-import.js';
const vec=(v:readonly number[])=>`[${v.join(', ')}]`;

function scadProfile(p:CodeProfile):string{
 if(p.kind==='resize')return `resize(${vec(p.size)},auto=[${p.auto.join(',')}]) ${scadProfile(p.profile)}`;
 if(p.kind==='affine'){const m=p.matrix;return `multmatrix([[${m[0]},${m[1]},0,${m[2]}],[${m[3]},${m[4]},0,${m[5]}],[0,0,1,0],[0,0,0,1]]) ${scadProfile(p.profile)}`;}
 if(p.kind==='offset')return `offset(${p.round?'r':'delta'}=${p.distance},$fn=${p.segments}) ${scadProfile(p.profile)}`;
 if(p.kind==='text')return `text(${JSON.stringify(p.text)},size=${p.size},font=${JSON.stringify(p.font==='serif'?'Droid Serif':p.font==='mono'?'Droid Sans Mono':'Droid Sans')},halign=${JSON.stringify(p.halign)},valign=${JSON.stringify(p.valign)},spacing=${p.spacing});`;
 if(p.kind==='empty')return 'union() {}';
 if(p.kind==='rectangle')return `square(${vec(p.size)}, center=${p.center});`;
 if(p.kind==='circle')return `circle(r=${p.radius}, $fn=${p.segments});`;
 if(p.kind==='polygon'){let offset=0;const points=p.contours.flat(),paths=p.contours.map(c=>c.map(()=>offset++));return `polygon(points=[${points.map(vec).join(', ')}], paths=[${paths.map(vec).join(', ')}]);`;}
 if('profiles'in p)return `${p.kind==='subtract'?'difference':p.kind==='intersect'?'intersection':p.kind}() {${p.profiles.map(scadProfile).join('\n')}}`;
 return `${p.kind==='move'?'translate':p.kind}(${p.kind==='rotate'?p.angle:vec(p.vector)}) ${scadProfile(p.profile)}`;
}
function jscadScale(vector:number[],body:string):string{let result=`scale(${vec(vector.map(Math.abs))}, ${body})`;for(let axis=0;axis<vector.length;axis++)if(vector[axis]<0)result=`mirror({normal:${vec([0,1,2].map(i=>i===axis?1:0))}}, ${result})`;return result;}
function jscadProfile(p:CodeProfile):string{
 if(p.kind==='affine'){const m=p.matrix;return `transform(${vec([m[0],m[3],0,0,m[1],m[4],0,0,0,0,1,0,m[2],m[5],0,1])}, ${jscadProfile(p.profile)})`;}
 if(p.kind==='resize'||p.kind==='offset'||p.kind==='minkowski')throw new CadCodeError(t('This profile operation cannot yet be exported to JSCAD'),0,'','unsupported-feature');
 if(p.kind==='text')throw new CadCodeError(t('Text profiles cannot yet be exported to JSCAD'),0,'','unsupported-feature');
 if(p.kind==='empty')return 'geom2.create()';if(p.kind==='rectangle')return `translate(${vec(p.center?[0,0]:p.size.map(v=>v/2))}, rectangle({size:${vec(p.size)}}))`;
 if(p.kind==='circle')return `circle({radius:${p.radius}, segments:${p.segments}})`;
 if(p.kind==='polygon'){const parts=p.contours.map(c=>{const area=c.reduce((a,p,i)=>a+p[0]*c[(i+1)%c.length][1]-c[(i+1)%c.length][0]*p[1],0);return `polygon({points:[${(area<0?[...c].reverse():c).map(vec).join(', ')}]})`;});return parts.length?parts.reduce((a,b)=>`xorProfile(${a},${b})`):'geom2.create()';}
 if('profiles'in p)return p.profiles.length===1&&p.kind!=='hull'?jscadProfile(p.profiles[0]):`${p.kind}(${p.profiles.map(jscadProfile).join(', ')})`;
 if(p.kind==='scale')return jscadScale(p.vector,jscadProfile(p.profile));
 return `${p.kind==='move'?'translate':p.kind==='rotate'?'rotateZ':'scale'}(${p.kind==='rotate'?p.angle*Math.PI/180:vec(p.vector)}, ${jscadProfile(p.profile)})`;
}

/** Conservative bounds; unresolved clipping is diagnosed rather than exporting reversed solids. */
function profileBounds(p:CodeProfile):[number[],number[]]{
 if(p.kind==='resize')throw new CadCodeError(t('This profile operation cannot yet be exported to JSCAD'),0,'','unsupported-feature');if(p.kind==='empty')return [[0,0],[0,0]];
 if(p.kind==='rectangle')return p.center?[p.size.map(v=>-v/2),p.size.map(v=>v/2)]:[[0,0],[...p.size]];
 if(p.kind==='circle')return [[-p.radius,-p.radius],[p.radius,p.radius]];
 if(p.kind==='polygon'){const points=p.contours.flat();return [ [0,1].map(i=>Math.min(...points.map(v=>v[i]))),[0,1].map(i=>Math.max(...points.map(v=>v[i]))) ];}
 if('profiles'in p){const bounds=p.profiles.map(profileBounds);if(!bounds.length)return [[0,0],[0,0]];if(p.kind==='subtract')return bounds[0];if(p.kind==='intersect')return [[0,1].map(i=>Math.max(...bounds.map(b=>b[0][i]))),[0,1].map(i=>Math.min(...bounds.map(b=>b[1][i])))];return [[0,1].map(i=>Math.min(...bounds.map(b=>b[0][i]))),[0,1].map(i=>Math.max(...bounds.map(b=>b[1][i])))];}
 if(p.kind==='text'||p.kind==='offset')throw new CadCodeError(t('This profile operation cannot yet be exported to JSCAD'),0,'','unsupported-feature');
 const [min,max]=profileBounds(p.profile),corners=[[min[0],min[1]],[min[0],max[1]],[max[0],min[1]],[max[0],max[1]]].map(([x,y])=>{if(p.kind==='affine'){const m=p.matrix;return [m[0]*x+m[1]*y+m[2],m[3]*x+m[4]*y+m[5]];}if(p.kind==='move')return [x+p.vector[0],y+p.vector[1]];if(p.kind==='scale')return [x*p.vector[0],y*p.vector[1]];const a=('angle'in p?p.angle:0)*Math.PI/180;return [x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];});return [[0,1].map(i=>Math.min(...corners.map(v=>v[i]))),[0,1].map(i=>Math.max(...corners.map(v=>v[i])))];
}
function jscadRevolve(s:Extract<CodeShape,{kind:'revolve'}>):string{if(!s.angle||s.profile.kind==='empty')return 'geom3.create()';const bounds=profileBounds(s.profile),negative=bounds[1][0]<=1e-8;if(bounds[0][0]<-1e-8&&!negative)throw new CadCodeError(t('JSCAD revolution export needs a provable radial side'),0,'','unsupported-feature');let profile=jscadProfile(s.profile);if(negative)profile=`mirror({normal:[1,0,0]},${profile})`;let body=`extrudeRotate({angle:${Math.abs(s.angle)*Math.PI/180},segments:${s.segments}}, ${profile})`;if(s.angle<0)body=`mirror({normal:[0,1,0]},${body})`;return negative&&Math.abs(s.angle)!==360?`rotate([0,0,${Math.PI}],${body})`:body;}

function axisEuler(axis:readonly number[],degrees:number):number[]{const length=Math.hypot(...axis),[x,y,z]=axis.map(v=>v/length),a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),t=1-c,yAngle=Math.asin(Math.max(-1,Math.min(1,-(t*x*z-s*y))));return Math.abs(Math.cos(yAngle))>1e-8?[Math.atan2(t*y*z+s*x,t*z*z+c),yAngle,Math.atan2(t*x*y+s*z,t*x*x+c)]:[0,yAngle,Math.atan2(-(t*x*y-s*z),t*y*y+c)];}
/** Evaluated CSG snapshot: explicit values, operation order, centering and segments. */
export function exportOpenSCAD(program:CodeProgram):string{
 const root=compileCode(program).shape;
 function shape(s:CodeShape,depth=0):string{const pad='  '.repeat(depth),child=(node:CodeShape)=>shape(node,depth+1);
  if(s.kind==='affine')return `${pad}multmatrix([${[0,4,8].map(i=>vec(s.matrix.slice(i,i+4))).join(',')},[0,0,0,1]]) ${child(s.shape)}`;
  if(s.kind==='polyhedron')return `${pad}polyhedron(points=[${s.points.map(vec).join(',')}],faces=[${s.faces.map(face=>vec([...face].reverse())).join(',')}]);`;
  if(s.kind==='resize'&&s.auto)return `${pad}resize(${vec(s.vector)},auto=[${s.auto.join(',')}]) ${child(s.shape)}`;
  if(s.kind==='axisRotate')return `${pad}rotate(a=${s.angle}, v=${vec(s.vector)}) ${child(s.shape)}`;
  if(s.kind==='empty')return `${pad}union() {}`;
  if(s.kind==='profile-extrude')return `${pad}linear_extrude(height=${s.height}, twist=${-s.twist}, slices=${s.steps}, scale=${vec(s.scaleTop)}) ${scadProfile(s.profile)}`;
  if(s.kind==='revolve')return `${pad}rotate_extrude(angle=${s.angle}, $fn=${s.segments}) ${scadProfile(s.profile)}`;
  if(s.kind==='extrude')return `${pad}linear_extrude(height = ${s.height}) polygon(points = [${s.points.map(vec).join(', ')}]);`;
  if(s.kind==='box')return `${pad}cube(${vec(s.size)}, center = true);`;
  if(s.kind==='cylinder')return `${pad}cylinder(h = ${s.height}, r = ${s.radius}, center = true, $fn = ${s.segments});`;
  if(s.kind==='frustum')return `${pad}cylinder(h = ${s.height}, r1 = ${s.bottom}, r2 = ${s.top}, center = true, $fn = ${s.segments});`;
  if(s.kind==='sphere')return `${pad}sphere(r = ${s.radius}, $fn = ${s.segments});`;
  if('shapes'in s)return `${pad}${s.kind==='minkowski'?'minkowski':s.kind==='hull'?'hull':s.kind==='subtract'?'difference':s.kind==='intersect'?'intersection':'union'}() {\n${s.shapes.map(child).join('\n')}\n${pad}}`;
  if(s.kind==='repeat')return `${pad}union() {\n${Array.from({length:s.count},(_,i)=>`${pad}  translate(${vec(s.step.map(v=>v*i))})\n${shape(s.shape,depth+2)}`).join('\n')}\n${pad}}`;
  return `${pad}${s.kind==='move'?'translate':s.kind}(${vec(s.vector)})\n${child(s.shape)}`;
 }
 return '// Evaluated construction snapshot from CrispCAD. Units: mm / degrees.\n// Source parameters are resolved; keep the native source for further parametric edits.\n'+shape(root)+'\n';
}
export function exportJSCAD(program:CodeProgram):string{
 function shape(s:CodeShape):string{if(s.kind==='scale')return jscadScale(s.vector,shape(s.shape));if(s.kind==='affine'){const m=s.matrix;return `transform(${vec([m[0],m[4],m[8],0,m[1],m[5],m[9],0,m[2],m[6],m[10],0,m[3],m[7],m[11],1])}, ${shape(s.shape)})`;}if(s.kind==='polyhedron')return `polyhedron({points:[${s.points.map(vec).join(',')}],faces:[${s.faces.map(vec).join(',')}],orientation:'outward'})`;if(s.kind==='minkowski'||s.kind==='resize')throw new CadCodeError(t('This construction cannot yet be exported to JSCAD'),0,program.source,'unsupported-feature');if(s.kind==='axisRotate')return `rotate(${vec(axisEuler(s.vector,s.angle))}, ${shape(s.shape)})`;if(s.kind==='mirror')return `mirror({normal:${vec(s.vector)}}, ${shape(s.shape)})`;if(s.kind==='profile-extrude'){if(s.scaleTop.some(v=>v!==1))throw new CadCodeError(t('JSCAD export of tapered profiles requires slice extrusion'),0,program.source,'unsupported-feature');return `extrudeLinear({height:${s.height},twistAngle:${s.twist*Math.PI/180},twistSteps:${s.steps}}, ${jscadProfile(s.profile)})`;}if(s.kind==='revolve')return jscadRevolve(s);if(s.kind==='empty')return 'geom3.create()';if(s.kind==='extrude')return `extrudeLinear({height: ${s.height}}, polygon({points: [${s.points.map(vec).join(', ')}]}))`;if(s.kind==='box')return `cuboid({size: ${vec(s.size)}})`;if(s.kind==='cylinder')return `cylinder({radius: ${s.radius}, height: ${s.height}, segments: ${s.segments}})`;if(s.kind==='frustum')return `cylinderElliptic({height: ${s.height}, startRadius: [${s.bottom}, ${s.bottom}], endRadius: [${s.top}, ${s.top}], segments: ${s.segments}})`;if(s.kind==='sphere')return `sphere({radius: ${s.radius}, segments: ${s.segments}})`;if('shapes'in s)return `${s.kind==='intersect'?'intersect':s.kind}(${s.shapes.map(shape).join(',\n    ')})`;if(s.kind==='repeat')return `union(${Array.from({length:s.count},(_,i)=>`translate(${vec(s.step.map(v=>v*i))}, ${shape(s.shape)})`).join(',\n    ')})`;return `${s.kind==='move'?'translate':s.kind}(${vec(s.vector.map(v=>s.kind==='rotate'?v*Math.PI/180:v))}, ${shape(s.shape)})`;}
 return `// Evaluated construction snapshot. Dimensions: mm. Rotation: radians.\n// Keep the native source for further parametric edits.\nconst {geometries: {geom2, geom3}, primitives: {cuboid, cylinder, cylinderElliptic, sphere, polygon, polyhedron, rectangle, circle}, extrusions: {extrudeLinear, extrudeRotate}, booleans: {union, subtract, intersect}, hulls: {hull}, transforms: {translate, rotate, rotateZ, mirror, scale, transform}} = require('@jscad/modeling');\n\nconst xorProfile = (a,b) => union(subtract(a,b),subtract(b,a));\nconst main = () => ${shape(compileCode(program).shape)};\nmodule.exports = {main};\n`;
}
/** Text source with local overrides applied as new defaults, preserving formulas. */
export function exportCodeSource(program:CodeProgram):string{
 compileCode(program);const tokens=[...program.source.matchAll(/\/\/[^\n]*|;|[A-Za-z][A-Za-z0-9_]*|[^\s]/g)].filter(m=>!m[0].startsWith('//'));const edits:{start:number;end:number;value:string}[]=[];
 for(let i=0;i<tokens.length;){let end=i;while(end<tokens.length&&tokens[end][0]!==';')end++;if(tokens[i][0]==='param'){const name=tokens[i+1][0];if(Object.hasOwn(program.parameters,name)){const equal=tokens.slice(i,end).find(token=>token[0]==='=')!;edits.push({start:equal.index!+1,end:tokens[end].index!,value:' '+program.parameters[name]});}}i=end+1;}
 let source=program.source;for(const edit of edits.reverse())source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);return source;
}
