// SPDX-License-Identifier: BSD-3-Clause
// Original symbolic translator from published language documentation, not GPL code.
import {CadCodeError,CODE_LIMITS,compileCode} from './code.js';
import type {CodeProgram} from './code.js';
import {t} from './i18n.js';
type Value=string|Value[];
type ScopeValue=Value|LocalBinding;
class LocalBinding {constructor(readonly start:number,readonly end:number,readonly scope:Map<string,ScopeValue>){}}
type Definition={parameters:{name:string;start?:number;end?:number}[];start:number;end:number};
/** Bounded declarative OpenSCAD subset. Unsupported constructs fail closed. */
export function importOpenSCAD(source:string):CodeProgram{
 if(typeof source!=='string')throw new CadCodeError(t('Expected source text'),0,'');
 const tokens:{text:string;at:number}[]=[];let position=0,cursor=0,statements=0,fn='48';const assignments=new Map<string,string>();
 const vectors=new Map<string,Value>();let locals=new Map<string,ScopeValue>();const resolving=new Set<LocalBinding>();
 const modules=new Map<string,Definition>(),functions=new Map<string,Definition>();let functionDepth=0;
 const fail=(message:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(message,at,source);};
 const limited=(message:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(message,at,source,'resource-limit');};
 if(new TextEncoder().encode(source).length>CODE_LIMITS.sourceBytes)limited(t('Source exceeds 32 KiB'),0);
 while(position<source.length){if(/\s/.test(source[position])){position++;continue;}if(source.startsWith('//',position)){const end=source.indexOf('\n',position);position=end<0?source.length:end+1;continue;}if(source.startsWith('/*',position)){const end=source.indexOf('*/',position+2);if(end<0)fail(t('Unclosed OpenSCAD comment'),position);position=end+2;continue;}
  const text=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_$][A-Za-z0-9_$]*|^[{}\[\](),;=+*/-]|^[\s\S]/.exec(source.slice(position))?.[0];if(!text)fail(t('Unsupported OpenSCAD token'),position);tokens.push({text:text!,at:position});position+=text!.length;if(tokens.length>CODE_LIMITS.tokens)limited(t('Too many source tokens'),position);
 }
 const peek=(ahead=0)=>tokens[cursor+ahead]?.text;
 const take=()=>{const next=tokens[cursor++];if(!next)fail(t('Unexpected end of source'));return next!;};
 const expect=(value:string)=>{if(peek()!==value)fail(t`Expected “${value}”`);take();};
 const unsupported=(name:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(t`Unsupported OpenSCAD feature “${name}”`,at,source,'unsupported-feature');};
 function localValue(name:string):Value|undefined{
  const binding=locals.get(name);if(!(binding instanceof LocalBinding))return binding;
  if(resolving.has(binding))unsupported('local variable dependency cycle',tokens[binding.start]?.at);
  if(resolving.size>=32)limited(t('OpenSCAD construction limit exceeded'));
  const resume=cursor,outer=locals;resolving.add(binding);locals=binding.scope;cursor=binding.start;
  try{const result=value();if(cursor!==binding.end)unsupported('local variable expression');return result;}
  finally{cursor=resume;locals=outer;resolving.delete(binding);}
 }
 // Substitute symbolic arguments, retaining scalar parameter dependencies in the native program.
 function reference():Value|undefined {
  const name=peek();if(!name)return undefined;let v:Value|undefined;if(functions.has(name)&&peek(1)==='(')v=callFunction();else{v=localValue(name)??vectors.get(name);if(v===undefined)return undefined;take();}
  while(peek()==='['){take();const index=take();if(!/^\d+$/.test(index.text)||!Array.isArray(v)||Number(index.text)>=v.length)unsupported('vector index',index.at);expect(']');v=v[Number(index.text)];}
  return v;
 }
 const mathFunctions=new Set(['sin','cos','tan','asin','acos','atan','atan2','sqrt','abs','floor','ceil','round','exp','ln','log','pow','min','max']);
 function expr(stops:string[],initial?:string):string{const out:string[]=initial===undefined?[]:[initial];let nesting=0;while(cursor<tokens.length){const next=peek()!;if(nesting===0&&stops.includes(next))break;
  const replacement=reference();if(replacement!==undefined){if(typeof replacement!=='string')unsupported('vector used as a scalar');if(out.join(' ').length+replacement.length+3>256)limited(t('OpenSCAD expanded expression limit exceeded'));out.push(`(${replacement})`);continue;}
  if(next==='(')nesting++;if(next===')'){if(!nesting)break;nesting--;}
  if(/^[A-Za-z][A-Za-z0-9_]*$/.test(next)&&peek(1)==='('&&!mathFunctions.has(next))unsupported(next);
  if(!/^[A-Za-z][A-Za-z0-9_]*$|^(?:\d|\.\d)|^[(),+*/-]$/.test(next))unsupported(next);
  out.push(take().text==='PI'&&!declaredGlobals.has('PI')?'3.141592653589793':next);if(out.length>256||nesting>32)limited(t('Expression nesting exceeds 32'));}
  if(!out.length||nesting)fail(t('Expected a complete dimensional expression'));if(out.join(' ').length>256)limited(t('OpenSCAD expanded expression limit exceeded'));return out.join(' ');}
 function value(depth=0):Value{if(depth>32)limited(t('OpenSCAD array nesting limit exceeded'));
  // A whole vector reference can be passed to size/v/points. Scalar expressions continue in expr().
  if((locals.has(peek()!)||vectors.has(peek()!)||(functions.has(peek()!)&&peek(1)==='('))){const v=reference();if([',',')',']',';'].includes(peek()??''))return v!;if(typeof v!=='string')unsupported('vector used as a scalar');return expr([',',')',']',';'],`(${v})`);}
  if(peek()!=='[')return expr([',',')',']',';']);take();const values:Value[]=[];while(peek()!==']'){values.push(value(depth+1));if(values.length>256)limited(t('OpenSCAD array limit exceeded'));if(peek()!==',')break;take();}expect(']');return values;}
 const scalar=(v:Value|undefined,fallback?:string):string=>{if(v===undefined&&fallback!==undefined)return fallback;if(typeof v!=='string')return fail(t('Expected a numeric OpenSCAD argument'));return v;};
 const vector=(v:Value|undefined,allowScalar=false):string[]=>{if(Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='string'))return v as string[];if(allowScalar&&typeof v==='string')return [v,v,v];if(Array.isArray(v))return unsupported('vector length other than three');return fail(t('Expected a three-component OpenSCAD vector'));};
 // Definitions are hoisted in the file scope, so calls may precede declarations.
 const definitions=new Map<number,number>(),declaredGlobals=new Set<string>();
 function scanDefinition(){const begin=cursor,kind=take().text,collection=kind==='module'?modules:functions;const name=take();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.text)||collection.has(name.text))unsupported(`${kind} name`,name.at);expect('(');
  const parameters:{name:string;start?:number;end?:number}[]=[];
  while(peek()!==')'){const parameter=take();if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(parameter.text)||parameters.some(p=>p.name===parameter.text))unsupported('module parameter',parameter.at);
   const entry:{name:string;start?:number;end?:number}={name:parameter.text};
   if(peek()==='='){take();entry.start=cursor;let depth=0;while(cursor<tokens.length){const n=peek()!;if(depth===0&&(n===','||n===')'))break;if(n==='('||n==='[')depth++;if(n===')'||n===']')depth--;if(depth<0||depth>32)limited(t('Expression nesting exceeds 32'));take();}entry.end=cursor;if(entry.start===entry.end)fail(t('Expected a complete dimensional expression'));}
   parameters.push(entry);if(parameters.length>64)limited(t('OpenSCAD construction limit exceeded'));if(peek()!==',')break;take();
  }expect(')');if(kind==='function'){expect('=');const start=cursor;while(peek()!==';'){if(!peek())fail(t('Unexpected end of source'));take();}if(cursor===start)fail(t('Expected a complete dimensional expression'));collection.set(name.text,{parameters,start,end:cursor});expect(';');definitions.set(begin,cursor);return;}const start=cursor;
  // A module body is one statement; braces contain arbitrarily nested statements.
  let depth=0;do{const n=take().text;if(n==='{')depth++;if(n==='}')depth--;if(depth<0)fail(t('Unclosed OpenSCAD block'));if(depth===0&&(n===';'||n==='}'))break;}while(cursor<tokens.length);
  if(depth||cursor===start||![';','}'].includes(tokens[cursor-1].text))fail(t('Unclosed OpenSCAD block'));
  collection.set(name.text,{parameters,start,end:cursor});definitions.set(begin,cursor);
 }
 {let depth=0;while(cursor<tokens.length){const n=peek();if(depth===0&&(n==='module'||n==='function')){scanDefinition();continue;}if(depth===0&&peek(1)==='=')declaredGlobals.add(n!);if(n==='{')depth++;if(n==='}')depth--;take();}cursor=0;}
 function union(shapes:string[]):string{if(!shapes.length)fail(t('OpenSCAD block contains no supported solid'));return shapes.length===1?shapes[0]:`union(${shapes.join(', ')})`;}
 function blockParts(depth:number,anonymous=false):string[]{
  expect('{');const begin=cursor,outer=locals,scope=new Map<string,ScopeValue>(outer),declarations=new Map<number,number>();
  // Predeclare all direct assignments. OpenSCAD's last assignment wins throughout
  // its lexical scope, including uses appearing before the assignment.
  let braces=0,parentheses=0,brackets=0;
  while(cursor<tokens.length){const next=peek()!;if(next==='}'&&braces===0)break;
   if(braces===0&&parentheses===0&&brackets===0&&peek(1)==='='){
    const statement=cursor,name=take();if(anonymous)unsupported('assignments in anonymous blocks',name.at);if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name.text))unsupported('local variable name',name.at);take();const start=cursor;
    let nesting=0;while(peek()!==';'||nesting!==0){const n=peek();if(!n||n==='{'||n==='}')unsupported('local variable expression',name.at);if(n==='('||n==='[')nesting++;if(n===')'||n===']')nesting--;if(nesting<0||nesting>32)limited(t('Expression nesting exceeds 32'));take();}
    const end=cursor;expect(';');if(start===end)fail(t('Expected a complete dimensional expression'),name.at);
    scope.set(name.text,new LocalBinding(start,end,scope));declarations.set(statement,cursor);
    if(++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));continue;
   }
   if(next==='{')braces++;if(next==='}')braces--;if(next==='(')parentheses++;if(next===')')parentheses--;if(next==='[')brackets++;if(next===']')brackets--;take();
  }
  cursor=begin;locals=scope;
  try{const shapes:string[]=[];while(peek()!=='}'){
    if(!peek())fail(t('Unclosed OpenSCAD block'));const end=declarations.get(cursor);if(end!==undefined){cursor=end;continue;}shapes.push(shape(depth+1));
   }expect('}');return shapes;
  }finally{locals=outer;}
 }
 function block(depth:number,anonymous=false):string{return union(blockParts(depth,anonymous));}
 function argumentsFor(name:string,at:number){
  expect('(');const named=new Map<string,Value>(),positional:Value[]=[];
  while(peek()!==')'){if(peek(1)==='='){const key=take().text;take();if(named.has(key))fail(t`Duplicate OpenSCAD argument “${key}”`);named.set(key,value());}else{if(named.size)fail(t('Positional OpenSCAD arguments must precede named arguments'));positional.push(value());}if(peek()!==',')break;take();}expect(')');
  const use=(key:string,index:number,fallback?:Value):Value|undefined=>{if(named.has(key)&&positional[index]!==undefined)fail(t`Duplicate OpenSCAD argument “${key}”`);return named.get(key)??positional[index]??fallback;};
  const allowed=(keys:string[],max:number)=>{for(const key of named.keys())if(!keys.includes(key))unsupported(`${name}.${key}`,at);if(positional.length>max)unsupported(`${name}: too many arguments`,at);};
return {named,positional,use,allowed};
 }
 function invokeDefinition<T>(kind:string,definition:Definition,args:ReturnType<typeof argumentsFor>,at:number,body:()=>T):T{
  args.allowed([...definition.parameters.map(p=>p.name),'$fn'],definition.parameters.length);
  const resume=cursor,outer=locals,specials:[string,Value][]=[...outer.keys()].filter(key=>key.startsWith('$')).map(key=>[key,localValue(key)!]);
  if(args.named.has('$fn'))specials.push(['$fn',args.named.get('$fn')!]);
  const scope=new Map<string,ScopeValue>(specials);locals=scope;
  try{for(let i=0;i<definition.parameters.length;i++){
    const parameter=definition.parameters[i];let v=args.use(parameter.name,i);
    if(v===undefined&&parameter.start!==undefined){cursor=parameter.start;locals=new Map(specials);try{v=value();}finally{locals=scope;}if(cursor!==parameter.end)unsupported(`${kind} default expression`);}
    if(v===undefined)unsupported(`missing ${kind} argument: ${parameter.name}`,at);scope.set(parameter.name,v!);
   }
   cursor=definition.start;const result=body();if(cursor!==definition.end)unsupported(`${kind} body`,at);return result;
  }finally{locals=outer;cursor=resume;}
 }
 function callFunction():Value{
  if(++functionDepth>32||++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));
  try{const token=take(),definition=functions.get(token.text)!,args=argumentsFor(token.text,token.at);return invokeDefinition('function',definition,args,token.at,()=>value());}
  finally{functionDepth--;}
 }
 function profile(depth:number,height:string):string{if(depth>32||++statements>128)limited(t('OpenSCAD construction limit exceeded'));if(peek()==='{'){take();const result=profile(depth+1,height);expect('}');return result;}const token=take(),name=token.text;if(!['polygon','square','circle'].includes(name))unsupported(`linear_extrude profile: ${name}`,token.at);const {named,use,allowed}=argumentsFor(name,token.at);expect(';');
  if(name==='polygon'){allowed(['points'],1);const points=use('points',0);if(!Array.isArray(points)||points.length<3||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='string')))fail(t('Expected an OpenSCAD polygon point list'),token.at);return `extrude(${height}, [${(points as string[][]).map(p=>`[${p.join(', ')}]`).join(', ')}])`;}
  if(name==='square'){allowed(['size','center'],2);const raw=use('size',0,'1'),size=typeof raw==='string'?[raw,raw]:raw;if(!Array.isArray(size)||size.length!==2||!size.every(v=>typeof v==='string'))fail(t('Expected an OpenSCAD square size'),token.at);const [w,d]=size as string[],center=use('center',1,'false');if(center!=='true'&&center!=='false')unsupported('computed center flag',token.at);return `move([${center==='true'?'0':`(${w}) / 2`}, ${center==='true'?'0':`(${d}) / 2`}, (${height}) / 2], box(${w}, ${d}, ${height}))`;}
  allowed(['r','d','$fn'],1);if(named.has('d')&&(named.has('r')||use('r',0)!==undefined))unsupported('circle: both radius and diameter',token.at);const radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',0,'1')),count=scalar(named.get('$fn')??localValue('$fn'),fn);return `move([0, 0, (${height}) / 2], cylinder(${radius}, ${height}, ${count}))`;
 }
 function shape(depth=0):string{
  if(depth>32||++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));if(peek()==='{')return block(depth,true);
  const token=take(),name=token.text;
  if(!modules.has(name)&&!['cube','sphere','cylinder','translate','rotate','scale','union','difference','intersection','linear_extrude'].includes(name))unsupported(name,token.at);
  const {named,positional,use,allowed}=argumentsFor(name,token.at);
  if(modules.has(name)){
   const definition=modules.get(name)!;
   // Custom modules with child geometry require children() semantics, not silent discarding.
   if(peek()!==';')unsupported('module child geometry',token.at);expect(';');
   return invokeDefinition('module',definition,{named,positional,use,allowed},token.at,()=>peek()==='{'?block(depth+1):shape(depth+1));
  }
  const centered=(v:Value|undefined)=>{if(v===undefined||v==='false')return false;if(v==='true')return true;return unsupported('computed center flag',token.at);};
  const segments=()=>scalar(named.get('$fn')??localValue('$fn'),fn);
  if(['union','difference','intersection'].includes(name)){allowed([],0);const parts:string[]=[];if(peek()==='{')parts.push(...blockParts(depth));else parts.push(shape(depth+1));if(!parts.length)fail(t('OpenSCAD block contains no supported solid'));if(parts.length===1)return parts[0];return `${name==='difference'?'subtract':name==='intersection'?'intersect':'union'}(${parts.join(', ')})`;}
  if(['translate','rotate','scale'].includes(name)){allowed([name==='rotate'?'a':'v'],1);const v=use(name==='rotate'?'a':'v',0);const vec=name==='rotate'&&typeof v==='string'?['0','0',v]:vector(v,name==='scale');const child=peek()==='{'?block(depth):shape(depth+1);return `${name==='translate'?'move':name}([${vec.join(', ')}], ${child})`;}
  if(name==='linear_extrude'){allowed(['height','center'],2);const height=scalar(use('height',0,'1')),body=profile(depth+1,height);return centered(use('center',1))?`move([0, 0, -(${height}) / 2], ${body})`:body;}
  expect(';');
  if(name==='cube'){allowed(['size','center'],2);const size=vector(use('size',0,'1'),true),body=`box(${size.join(', ')})`;return centered(use('center',1))?body:`move([${size.map(v=>`(${v}) / 2`).join(', ')}], ${body})`;}
  if(name==='sphere'){allowed(['r','d','$fn'],1);if(named.has('d')&&(named.has('r')||positional.length))unsupported('sphere: both radius and diameter',token.at);const radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',0,'1'));return `sphere(${radius}, ${segments()})`;}
  allowed(['h','r','d','center','$fn'],2);if(named.has('d')&&(named.has('r')||positional[1]!==undefined))unsupported('cylinder: both radius and diameter',token.at);const height=scalar(use('h',0,'1')),radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',1,'1')),body=`cylinder(${radius}, ${height}, ${segments()})`;return centered(named.get('center'))?body:`move([0, 0, (${height}) / 2], ${body})`;
 }
 let constructionAt=0;const shapes:string[]=[];while(cursor<tokens.length){if(definitions.has(cursor)){cursor=definitions.get(cursor)!;continue;}if(peek(1)==='='){const token=take(),name=token.text;take();if(shapes.length)unsupported('assignment after geometry',token.at);const v=value();expect(';');if(name==='$fn')fn=scalar(v);else{if(!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)||['constructor','prototype'].includes(name))unsupported(name,token.at);if(assignments.has(name)||vectors.has(name))unsupported('variable reassignment',token.at);if(Array.isArray(v)||v==='true'||v==='false')vectors.set(name,v);else assignments.set(name,v);}if(++statements>CODE_LIMITS.statements)limited(t('Too many statements'));}else{constructionAt=tokens[cursor]?.at??0;shapes.push(shape());}}
 const program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:`// Converted from the supported OpenSCAD subset.\n${[...assignments].map(([name,v])=>`param ${name}: scalar = ${v};`).join('\n')}\nreturn ${union(shapes)};\n`};try{compileCode(program);}catch(error){if(error instanceof CadCodeError)throw new CadCodeError(t`Converted OpenSCAD construction: ${error.detail}`,constructionAt,source,error.code);throw error;}return program;
}
