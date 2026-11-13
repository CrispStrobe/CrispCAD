// SPDX-License-Identifier: BSD-3-Clause
// Original translator from published language documentation, not interpreter code.
import {CadCodeError,CODE_LIMITS,compileCode} from './code.js';
import type {CodeProgram,CodeShape} from './code.js';
import {t} from './i18n.js';
type Value=string|string[];
/** Bounded declarative OpenSCAD subset. Unsupported constructs fail closed. */
export function importOpenSCAD(source:string):CodeProgram{
 const tokens:{text:string;at:number}[]=[];let position=0,cursor=0,statements=0,fn='48';const assignments=new Map<string,string>();
 const fail=(message:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(message,at,source);};
 if(new TextEncoder().encode(source).length>CODE_LIMITS.sourceBytes)fail(t('Source exceeds 32 KiB'),0);
 while(position<source.length){if(/\s/.test(source[position])){position++;continue;}if(source.startsWith('//',position)){const end=source.indexOf('\n',position);position=end<0?source.length:end+1;continue;}if(source.startsWith('/*',position)){const end=source.indexOf('*/',position+2);if(end<0)fail(t('Unclosed OpenSCAD comment'),position);position=end+2;continue;}
  const text=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_$][A-Za-z0-9_$]*|^[{}\[\](),;=+*/-]|^[\s\S]/.exec(source.slice(position))?.[0];if(!text)fail(t('Unsupported OpenSCAD token'),position);tokens.push({text:text!,at:position});position+=text!.length;if(tokens.length>CODE_LIMITS.tokens)fail(t('Too many source tokens'),position);
 }
 const peek=(ahead=0)=>tokens[cursor+ahead]?.text;
 const take=()=>{const next=tokens[cursor++];if(!next)fail(t('Unexpected end of source'));return next!;};
 const expect=(value:string)=>{if(peek()!==value)fail(t`Expected “${value}”`);take();};
 const unsupported=(name:string,at?:number):never=>fail(t`Unsupported OpenSCAD feature “${name}”`,at);
 function expr(stops:string[]):string{const out:string[]=[];let nesting=0;while(cursor<tokens.length){const next=peek()!;if(nesting===0&&stops.includes(next))break;if(next==='(')nesting++;if(next===')'){if(!nesting)break;nesting--;}if(!/^[A-Za-z][A-Za-z0-9_]*$|^(?:\d|\.\d)|^[()+*/-]$/.test(next))unsupported(next);out.push(take().text);if(out.length>256||nesting>32)fail(t('Expression nesting exceeds 32'));}if(!out.length||nesting)fail(t('Expected a complete dimensional expression'));return out.join(' ');}
 function value():Value{if(peek()!=='[')return expr([',',')']);take();const values:string[]=[];while(peek()!==']'){values.push(expr([',',']']));if(values.length>3)unsupported('vectors longer than 3');if(peek()!==',')break;take();}expect(']');return values;}
 const scalar=(v:Value|undefined,fallback?:string):string=>{if(v===undefined&&fallback!==undefined)return fallback;if(typeof v!=='string')return fail(t('Expected a numeric OpenSCAD argument'));return v;};
 const vector=(v:Value|undefined,allowScalar=false):string[]=>{if(Array.isArray(v)&&v.length===3)return v;if(allowScalar&&typeof v==='string')return [v,v,v];return fail(t('Expected a three-component OpenSCAD vector'));};
 function union(shapes:string[]):string{if(!shapes.length)fail(t('OpenSCAD block contains no supported solid'));return shapes.length===1?shapes[0]:`union(${shapes.join(', ')})`;}
 function block(depth:number):string{expect('{');const shapes:string[]=[];while(peek()!=='}'){if(!peek())fail(t('Unclosed OpenSCAD block'));shapes.push(shape(depth+1));}expect('}');return union(shapes);}
 function shape(depth=0):string{
  if(depth>32||++statements>CODE_LIMITS.statements)fail(t('OpenSCAD construction limit exceeded'));if(peek()==='{')return block(depth);
  const token=take(),name=token.text;
  if(!['cube','sphere','cylinder','translate','rotate','scale','union','difference','intersection'].includes(name))unsupported(name,token.at);
  expect('(');const named=new Map<string,Value>(),positional:Value[]=[];
  while(peek()!==')'){if(peek(1)==='='){const key=take().text;take();if(named.has(key))fail(t`Duplicate OpenSCAD argument “${key}”`);named.set(key,value());}else{if(named.size)fail(t('Positional OpenSCAD arguments must precede named arguments'));positional.push(value());}if(peek()!==',')break;take();}expect(')');
  const use=(key:string,index:number,fallback?:Value):Value|undefined=>{if(named.has(key)&&positional[index]!==undefined)fail(t`Duplicate OpenSCAD argument “${key}”`);return named.get(key)??positional[index]??fallback;};
  const allowed=(keys:string[],max:number)=>{for(const key of named.keys())if(!keys.includes(key))unsupported(`${name}.${key}`,token.at);if(positional.length>max)unsupported(`${name}: too many arguments`,token.at);};
  const centered=(v:Value|undefined)=>{if(v===undefined||v==='false')return false;if(v==='true')return true;return unsupported('computed center flag',token.at);};
  const segments=()=>scalar(named.get('$fn'),fn);
  if(['union','difference','intersection'].includes(name)){allowed([],0);const parts:string[]=[];if(peek()==='{'){take();while(peek()!=='}'){if(!peek())fail(t('Unclosed OpenSCAD block'));parts.push(shape(depth+1));}take();}else parts.push(shape(depth+1));if(!parts.length)fail(t('OpenSCAD block contains no supported solid'));if(parts.length===1)return parts[0];return `${name==='difference'?'subtract':name==='intersection'?'intersect':'union'}(${parts.join(', ')})`;}
  if(['translate','rotate','scale'].includes(name)){allowed([name==='rotate'?'a':'v'],1);const v=use(name==='rotate'?'a':'v',0);const vec=name==='rotate'&&typeof v==='string'?['0','0',v]:vector(v,name==='scale');const child=peek()==='{'?block(depth):shape(depth+1);return `${name==='translate'?'move':name}([${vec.join(', ')}], ${child})`;}
  expect(';');
  if(name==='cube'){allowed(['size','center'],2);const size=vector(use('size',0,'1'),true),body=`box(${size.join(', ')})`;return centered(use('center',1))?body:`move([${size.map(v=>`(${v}) / 2`).join(', ')}], ${body})`;}
  if(name==='sphere'){allowed(['r','d','$fn'],1);if(named.has('d')&&(named.has('r')||positional.length))unsupported('sphere: both radius and diameter',token.at);const radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',0,'1'));return `sphere(${radius}, ${segments()})`;}
  allowed(['h','r','d','center','$fn'],2);if(named.has('d')&&(named.has('r')||positional[1]!==undefined))unsupported('cylinder: both radius and diameter',token.at);const height=scalar(use('h',0,'1')),radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',1,'1')),body=`cylinder(${radius}, ${height}, ${segments()})`;return centered(named.get('center'))?body:`move([0, 0, (${height}) / 2], ${body})`;
 }
 const shapes:string[]=[];while(cursor<tokens.length){if(peek(1)==='='){const token=take(),name=token.text;take();if(shapes.length)unsupported('assignment after geometry',token.at);const v=expr([';']);expect(';');if(name==='$fn')fn=v;else{if(!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)||['constructor','prototype'].includes(name))unsupported(name,token.at);if(assignments.has(name))unsupported('variable reassignment',token.at);assignments.set(name,v);}if(++statements>CODE_LIMITS.statements)fail(t('Too many statements'));}else shapes.push(shape());}
 const program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:`// Converted from the supported OpenSCAD subset.\n${[...assignments].map(([name,v])=>`param ${name}: scalar = ${v};`).join('\n')}\nreturn ${union(shapes)};\n`};compileCode(program);return program;
}
const vec=(v:readonly number[])=>`[${v.join(', ')}]`;
/** Evaluated CSG snapshot: explicit values, operation order, centering and segments. */
export function exportOpenSCAD(program:CodeProgram):string{
 const root=compileCode(program).shape;
 function shape(s:CodeShape,depth=0):string{const pad='  '.repeat(depth),child=(node:CodeShape)=>shape(node,depth+1);
  if(s.kind==='extrude')return `${pad}linear_extrude(height = ${s.height}) polygon(points = [${s.points.map(vec).join(', ')}]);`;
  if(s.kind==='box')return `${pad}cube(${vec(s.size)}, center = true);`;
  if(s.kind==='cylinder')return `${pad}cylinder(h = ${s.height}, r = ${s.radius}, center = true, $fn = ${s.segments});`;
  if(s.kind==='sphere')return `${pad}sphere(r = ${s.radius}, $fn = ${s.segments});`;
  if('shapes'in s)return `${pad}${s.kind==='subtract'?'difference':s.kind==='intersect'?'intersection':'union'}() {\n${s.shapes.map(child).join('\n')}\n${pad}}`;
  if(s.kind==='repeat')return `${pad}union() {\n${Array.from({length:s.count},(_,i)=>`${pad}  translate(${vec(s.step.map(v=>v*i))})\n${shape(s.shape,depth+2)}`).join('\n')}\n${pad}}`;
  return `${pad}${s.kind==='move'?'translate':s.kind}(${vec(s.vector)})\n${child(s.shape)}`;
 }
 return '// Evaluated construction snapshot from Brickwright CAD. Units: mm / degrees.\n// Source parameters are resolved; keep the native source for further parametric edits.\n'+shape(root)+'\n';
}
export function exportJSCAD(program:CodeProgram):string{
 function shape(s:CodeShape):string{if(s.kind==='extrude')return `extrudeLinear({height: ${s.height}}, polygon({points: [${s.points.map(vec).join(', ')}]}))`;if(s.kind==='box')return `cuboid({size: ${vec(s.size)}})`;if(s.kind==='cylinder')return `cylinder({radius: ${s.radius}, height: ${s.height}, segments: ${s.segments}})`;if(s.kind==='sphere')return `sphere({radius: ${s.radius}, segments: ${s.segments}})`;if('shapes'in s)return `${s.kind==='intersect'?'intersect':s.kind}(${s.shapes.map(shape).join(',\n    ')})`;if(s.kind==='repeat')return `union(${Array.from({length:s.count},(_,i)=>`translate(${vec(s.step.map(v=>v*i))}, ${shape(s.shape)})`).join(',\n    ')})`;return `${s.kind==='move'?'translate':s.kind}(${vec(s.vector.map(v=>s.kind==='rotate'?v*Math.PI/180:v))}, ${shape(s.shape)})`;}
 return `// Evaluated construction snapshot. Dimensions: mm. Rotation: radians.\n// Keep the native source for further parametric edits.\nconst {primitives: {cuboid, cylinder, sphere, polygon}, extrusions: {extrudeLinear}, booleans: {union, subtract, intersect}, transforms: {translate, rotate, scale}} = require('@jscad/modeling');\n\nconst main = () => ${shape(compileCode(program).shape)};\nmodule.exports = {main};\n`;
}
/** Text source with local overrides applied as new defaults, preserving formulas. */
export function exportCodeSource(program:CodeProgram):string{
 compileCode(program);const tokens=[...program.source.matchAll(/\/\/[^\n]*|;|[A-Za-z][A-Za-z0-9_]*|[^\s]/g)].filter(m=>!m[0].startsWith('//'));const edits:{start:number;end:number;value:string}[]=[];
 for(let i=0;i<tokens.length;){let end=i;while(end<tokens.length&&tokens[end][0]!==';')end++;if(tokens[i][0]==='param'){const name=tokens[i+1][0];if(Object.hasOwn(program.parameters,name)){const equal=tokens.slice(i,end).find(token=>token[0]==='=')!;edits.push({start:equal.index!+1,end:tokens[end].index!,value:' '+program.parameters[name]});}}i=end+1;}
 let source=program.source;for(const edit of edits.reverse())source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);return source;
}
