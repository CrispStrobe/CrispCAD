// SPDX-License-Identifier: BSD-3-Clause
// Original symbolic translator from published language documentation, not GPL code.
import {CadCodeError,CODE_LIMITS,compileCode} from './code.js';
import type {CodeProgram} from './code.js';
import {t} from './i18n.js';
class LiteralString {constructor(readonly text:string){}}
class LiteralPalette {constructor(readonly entries:(LiteralString|LiteralPalette)[]){}}
type Value=string|LiteralString|LiteralPalette|Value[];
const colorLiteral=(v:Value|undefined):v is LiteralString|LiteralPalette=>v instanceof LiteralString||v instanceof LiteralPalette;
type ScopeValue=Value|LocalBinding|ArgumentBinding;
class ArgumentBinding {constructor(readonly value:Value,readonly indexLiteral?:string){}}
class LocalBinding {constructor(readonly start:number,readonly end:number,readonly scope:Map<string,ScopeValue>){}}
type Definition={parameters:{name:string;start?:number;end?:number}[];start:number;end:number;localScope?:Map<string,ScopeValue>;moduleScope:Map<string,Definition>};
/** Bounded declarative OpenSCAD subset. Unsupported constructs fail closed. */
export function importOpenSCAD(source:string):CodeProgram{
 if(typeof source!=='string')throw new CadCodeError(t('Expected source text'),0,'');
 const tokens:{text:string;at:number}[]=[];let position=0,cursor=0,statements=0,fn='48',omittedColor=false,omittedHighlight=false,fullRenderPreview=false;const assignments=new Map<string,string>();
 const vectors=new Map<string,Value>();let locals=new Map<string,ScopeValue>();const resolving=new Set<LocalBinding>();
 let modules=new Map<string,Definition>();const functions=new Map<string,Definition>();let functionDepth=0;
 const fail=(message:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(message,at,source);};
 const limited=(message:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(message,at,source,'resource-limit');};
 if(new TextEncoder().encode(source).length>CODE_LIMITS.sourceBytes)limited(t('Source exceeds 32 KiB'),0);
 while(position<source.length){if(/\s/.test(source[position])){position++;continue;}if(source.startsWith('//',position)){const end=source.indexOf('\n',position);position=end<0?source.length:end+1;continue;}if(source.startsWith('/*',position)){const end=source.indexOf('*/',position+2);if(end<0)fail(t('Unclosed OpenSCAD comment'),position);position=end+2;continue;}
  const text=/^"(?:[^"\\]|\\.)*"|^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_$][A-Za-z0-9_$]*|^(?:==|!=|<=|>=|&&|\|\|)|^[{}\[\](),;=+*/%!?<>:-]|^[\s\S]/.exec(source.slice(position))?.[0];if(!text)fail(t('Unsupported OpenSCAD token'),position);tokens.push({text:text!,at:position});position+=text!.length;if(tokens.length>CODE_LIMITS.tokens)limited(t('Too many source tokens'),position);
 }
 const peek=(ahead=0)=>tokens[cursor+ahead]?.text;
 const take=()=>{const next=tokens[cursor++];if(!next)fail(t('Unexpected end of source'));return next!;};
 const expect=(value:string)=>{if(peek()!==value)fail(t`Expected “${value}”`);take();};
 const unsupported=(name:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(t`Unsupported OpenSCAD feature “${name}”`,at,source,'unsupported-feature');};
 for(let i=0;i<tokens.length;i++)if(tokens[i].text==='$preview'&&tokens[i+1]?.text==='=')unsupported('read-only full-render $preview',tokens[i].at);
 let valueEvaluations=0;
 const chargeValues=(count=1)=>{valueEvaluations+=count;if(valueEvaluations>CODE_LIMITS.tokens)limited(t('OpenSCAD construction limit exceeded'));};
 function localValue(name:string):Value|undefined{
  const binding=locals.get(name);if(binding instanceof ArgumentBinding)return binding.value;if(!(binding instanceof LocalBinding))return binding;
  // Charge before descending into aliases: a small source DAG can expand exponentially.
  chargeValues();
  if(resolving.has(binding))unsupported('local variable dependency cycle',tokens[binding.start]?.at);
  if(resolving.size>=32)limited(t('OpenSCAD construction limit exceeded'));
  const resume=cursor,outer=locals;resolving.add(binding);locals=binding.scope;cursor=binding.start;
  try{const result=value();if(cursor!==binding.end)unsupported('local variable expression');return result;}
  finally{cursor=resume;locals=outer;resolving.delete(binding);}
 }
 function localIndex(name:string,depth=0):string|undefined{
  if(depth>32)limited(t('OpenSCAD construction limit exceeded'));chargeValues();
  const binding=locals.get(name);if(binding instanceof ArgumentBinding)return binding.indexLiteral;
  if(!(binding instanceof LocalBinding)||binding.end!==binding.start+1)return undefined;
  const token=tokens[binding.start].text;if(/^\d+$/.test(token))return token;
  const outer=locals;locals=binding.scope;try{return localIndex(token,depth+1);}finally{locals=outer;}
 }
 function indexLiteral(start:number,end:number):string|undefined{
  if(end!==start+1)return undefined;const token=tokens[start].text;return /^\d+$/.test(token)?token:localIndex(token);
 }
 // Substitute symbolic arguments, retaining scalar parameter dependencies in the native program.
 function reference():Value|undefined {
  const name=peek();if(!name)return undefined;let v:Value|undefined;if(name==='$preview'){fullRenderPreview=true;v='false';take();}else if(functions.has(name)&&peek(1)==='(')v=callFunction();else{v=localValue(name)??vectors.get(name);if(v===undefined)return undefined;take();}
  while(peek()==='['){take();const index=take(),literal=/^\d+$/.test(index.text)?index.text:localIndex(index.text);const array:Value|undefined=v;
   if(array instanceof LiteralPalette){if(literal===undefined||Number(literal)>=array.entries.length)return unsupported('literal palette index',index.at);expect(']');v=array.entries[Number(literal)];}
   else{if(!Array.isArray(array)||literal===undefined||Number(literal)>=array.length)return unsupported('vector index',index.at);expect(']');v=array[Number(literal)];}
  }
  return v;
 }
 const mathFunctions=new Set(['sin','cos','tan','asin','acos','atan','atan2','sqrt','abs','floor','ceil','round','exp','ln','log','pow','min','max']);
 function expr(stops:string[],initial?:string):string{const out:string[]=initial===undefined?[]:[initial];let nesting=0,questions=0;while(cursor<tokens.length){const next=peek()!;if(nesting===0&&stops.includes(next)&&!(next===':'&&questions>0))break;if(next==='?')questions++;if(next===':'&&questions>0)questions--;
  const replacement=reference();if(replacement!==undefined){if(colorLiteral(replacement))unsupported('color literal used as a scalar');if(typeof replacement!=='string')return unsupported('vector used as a scalar');if(out.join(' ').length+replacement.length+3>256)limited(t('OpenSCAD expanded expression limit exceeded'));out.push(`(${replacement})`);continue;}
  if(next==='(')nesting++;if(next===')'){if(!nesting)break;nesting--;}
  if(/^[A-Za-z][A-Za-z0-9_]*$/.test(next)&&peek(1)==='('&&!mathFunctions.has(next))unsupported(next);
  if(!/^[A-Za-z][A-Za-z0-9_]*$|^(?:\d|\.\d)|^(?:[(),+*/%!?<>:-]|==|!=|<=|>=|&&|\|\|)$/.test(next))unsupported(next);
  out.push(take().text==='PI'&&!declaredGlobals.has('PI')?'3.141592653589793':next);if(out.length>256||nesting>32)limited(t('Expression nesting exceeds 32'));}
  if(!out.length||nesting)fail(t('Expected a complete dimensional expression'));if(out.join(' ').length>256)limited(t('OpenSCAD expanded expression limit exceeded'));return out.join(' ');}
 function value(depth=0,extraStops:string[]=[]):Value{if(depth>32)limited(t('OpenSCAD array nesting limit exceeded'));
  if(peek()?.startsWith('"')){chargeValues();const token=take();try{return new LiteralString(JSON.parse(token.text));}catch{return unsupported('literal color string',token.at);}}
  // A whole vector reference can be passed to size/v/points. Scalar expressions continue in expr().
  if((locals.has(peek()!)||vectors.has(peek()!)||(functions.has(peek()!)&&peek(1)==='('))){const v=reference();if([',',')',']',';',...extraStops].includes(peek()??''))return v!;if(colorLiteral(v))unsupported('computed color literal');if(typeof v!=='string')unsupported('vector used as a scalar');return expr([',',')',']',';',...extraStops],`(${v})`);}
  if(peek()!=='[')return expr([',',')',']',';',...extraStops]);take();const values:Value[]=[];while(peek()!==']'){values.push(value(depth+1));if(values.length>256)limited(t('OpenSCAD array limit exceeded'));if(peek()!==',')break;take();}expect(']');
  if(values.some(colorLiteral)){if(!values.every(colorLiteral))return unsupported('mixed color palette');chargeValues(values.length+1);return new LiteralPalette(values);}
  return values;}
 const scalar=(v:Value|undefined,fallback?:string):string=>{if(v===undefined&&fallback!==undefined)return fallback;if(colorLiteral(v))return unsupported('color literal used as a numeric argument');if(typeof v!=='string')return fail(t('Expected a numeric OpenSCAD argument'));return v;};
 const vector=(v:Value|undefined,allowScalar=false):string[]=>{if(colorLiteral(v))return unsupported('color literal used as a numeric vector');if(Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='string'))return v as string[];if(allowScalar&&typeof v==='string')return [v,v,v];if(Array.isArray(v))return unsupported('vector length other than three');return fail(t('Expected a three-component OpenSCAD vector'));};
 // Definitions are hoisted in the file scope, so calls may precede declarations.
 const definitions=new Map<number,number>(),declaredGlobals=new Set<string>();
 function scanDefinition(localScope?:Map<string,ScopeValue>,declared?:Set<string>){const begin=cursor,kind=take().text,collection=kind==='module'?modules:functions;if(localScope&&kind!=='module')unsupported('nested functions');const name=take();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.text)||(declared?declared.has(name.text):collection.has(name.text)))unsupported(`${kind} name`,name.at);declared?.add(name.text);expect('(');
  const parameters:{name:string;start?:number;end?:number}[]=[];
  while(peek()!==')'){const parameter=take();if(parameter.text==='$preview')unsupported('read-only full-render $preview',parameter.at);if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(parameter.text)||parameters.some(p=>p.name===parameter.text))unsupported('module parameter',parameter.at);
   const entry:{name:string;start?:number;end?:number}={name:parameter.text};
   if(peek()==='='){take();entry.start=cursor;let depth=0;while(cursor<tokens.length){const n=peek()!;if(depth===0&&(n===','||n===')'))break;if(n==='('||n==='[')depth++;if(n===')'||n===']')depth--;if(depth<0||depth>32)limited(t('Expression nesting exceeds 32'));take();}entry.end=cursor;if(entry.start===entry.end)fail(t('Expected a complete dimensional expression'));}
   parameters.push(entry);if(parameters.length>64)limited(t('OpenSCAD construction limit exceeded'));if(peek()!==',')break;take();
  }expect(')');if(kind==='function'){expect('=');const start=cursor;while(peek()!==';'){if(!peek())fail(t('Unexpected end of source'));take();}if(cursor===start)fail(t('Expected a complete dimensional expression'));collection.set(name.text,{parameters,start,end:cursor,localScope,moduleScope:modules});expect(';');definitions.set(begin,cursor);return;}const start=cursor;
  // A module body is one statement; braces contain arbitrarily nested statements.
  let depth=0;do{const n=take().text;if(n==='{')depth++;if(n==='}')depth--;if(depth<0)fail(t('Unclosed OpenSCAD block'));if(depth===0&&(n===';'||n==='}'))break;}while(cursor<tokens.length);
  if(depth||cursor===start||![';','}'].includes(tokens[cursor-1].text))fail(t('Unclosed OpenSCAD block'));
  collection.set(name.text,{parameters,start,end:cursor,localScope,moduleScope:modules});definitions.set(begin,cursor);
 }
 {let depth=0;while(cursor<tokens.length){const n=peek();if(depth===0&&(n==='module'||n==='function')){scanDefinition();continue;}if(depth===0&&peek(1)==='=')declaredGlobals.add(n!);if(n==='{')depth++;if(n==='}')depth--;take();}cursor=0;}
 function union(shapes:string[]):string{if(!shapes.length)return 'empty()';return shapes.length===1?shapes[0]:`union(${shapes.join(', ')})`;}
 function blockParts(depth:number,anonymous=false):string[]{
  expect('{');const begin=cursor,outer=locals,outerModules=modules,scope=new Map<string,ScopeValue>(outer),declarations=new Map<number,number>(),declaredModules=new Set<string>();
  // Capture the block's declarative bindings and module registry by reference;
  // all direct definitions are visible before their textual declarations.
  locals=scope;modules=new Map(outerModules);
  try{
   let braces=0,parentheses=0,brackets=0;
   while(cursor<tokens.length){const next=peek()!;if(next==='}'&&braces===0)break;
    if(braces===0&&parentheses===0&&brackets===0&&(next==='module'||next==='function')){
     const statement=cursor;scanDefinition(scope,declaredModules);declarations.set(statement,cursor);
     if(++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));continue;
    }
    // OpenSCAD's last assignment wins throughout its lexical scope.
    if(braces===0&&parentheses===0&&brackets===0&&peek(1)==='='){
     const statement=cursor,name=take();if(name.text==='$preview')unsupported('read-only full-render $preview',name.at);if(anonymous)unsupported('assignments in anonymous blocks',name.at);if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name.text))unsupported('local variable name',name.at);take();const start=cursor;
     let nesting=0;while(peek()!==';'||nesting!==0){const n=peek();if(!n||n==='{'||n==='}')unsupported('local variable expression',name.at);if(n==='('||n==='[')nesting++;if(n===')'||n===']')nesting--;if(nesting<0||nesting>32)limited(t('Expression nesting exceeds 32'));take();}
     const end=cursor;expect(';');if(start===end)fail(t('Expected a complete dimensional expression'),name.at);
     scope.set(name.text,new LocalBinding(start,end,scope));declarations.set(statement,cursor);
     if(++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));continue;
    }
    if(next==='{')braces++;if(next==='}')braces--;if(next==='(')parentheses++;if(next===')')parentheses--;if(next==='[')brackets++;if(next===']')brackets--;take();
   }
   cursor=begin;const shapes:string[]=[];while(peek()!=='}'){
    if(!peek())fail(t('Unclosed OpenSCAD block'));const end=declarations.get(cursor);if(end!==undefined){cursor=end;continue;}shapes.push(shape(depth+1));
   }expect('}');return shapes;
  }finally{locals=outer;modules=outerModules;}
 }

 function block(depth:number,anonymous=false):string{return union(blockParts(depth,anonymous));}
 function argumentsFor(name:string,at:number){
  expect('(');const named=new Map<string,Value>(),positional:Value[]=[],namedIndices=new Map<string,string|undefined>(),positionalIndices:(string|undefined)[]=[];
  while(peek()!==')'){
   if(peek(1)==='='){const key=take().text;take();if(key==='$preview')unsupported('read-only full-render $preview',at);if(named.has(key))fail(t`Duplicate OpenSCAD argument “${key}”`);const start=cursor;named.set(key,value());namedIndices.set(key,indexLiteral(start,cursor));}
   else{if(named.size)fail(t('Positional OpenSCAD arguments must precede named arguments'));const start=cursor;positional.push(value());positionalIndices.push(indexLiteral(start,cursor));}
   if(peek()!==',')break;take();
  }expect(')');
  const use=(key:string,index:number,fallback?:Value):Value|undefined=>{if(named.has(key)&&positional[index]!==undefined)fail(t`Duplicate OpenSCAD argument “${key}”`);return named.get(key)??positional[index]??fallback;};
  const allowed=(keys:string[],max:number)=>{for(const key of named.keys())if(!keys.includes(key))unsupported(`${name}.${key}`,at);if(positional.length>max)unsupported(`${name}: too many arguments`,at);};
  return {named,positional,use,allowed,indexLiteral:(key:string,index:number)=>named.has(key)?namedIndices.get(key):positionalIndices[index]};
 }

 function invokeDefinition<T>(kind:string,definition:Definition,args:ReturnType<typeof argumentsFor>,at:number,body:()=>T):T{
  args.allowed([...definition.parameters.map(p=>p.name),'$fn'],definition.parameters.length);
  const resume=cursor,outer=locals,outerModules=modules,specials:[string,Value][]=[...outer.keys()].filter(key=>key.startsWith('$')).map(key=>[key,localValue(key)!]);
  if(args.named.has('$fn'))specials.push(['$fn',args.named.get('$fn')!]);
  const defaults=new Map<string,ScopeValue>(definition.localScope);for(const [key,v] of specials)defaults.set(key,v);
  const scope=new Map(defaults);locals=scope;modules=definition.moduleScope;
  try{for(let i=0;i<definition.parameters.length;i++){
    const parameter=definition.parameters[i];let v=args.use(parameter.name,i),index=args.indexLiteral(parameter.name,i);
    if(v===undefined&&parameter.start!==undefined){cursor=parameter.start;locals=new Map(defaults);try{v=value();index=indexLiteral(parameter.start,cursor);}finally{locals=scope;}if(cursor!==parameter.end)unsupported(`${kind} default expression`);}
    if(v===undefined)unsupported(`missing ${kind} argument: ${parameter.name}`,at);if(kind==='function'&&colorLiteral(v))unsupported('string function argument',at);scope.set(parameter.name,new ArgumentBinding(v!,kind==='module'?index:undefined));
   }
   cursor=definition.start;const result=body();if(cursor!==definition.end)unsupported(`${kind} body`,at);return result;
  }finally{locals=outer;modules=outerModules;cursor=resume;}
 }
 function callFunction():Value{
  if(++functionDepth>32||++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));
  try{const token=take(),definition=functions.get(token.text)!,args=argumentsFor(token.text,token.at);const result=invokeDefinition('function',definition,args,token.at,()=>value());if(colorLiteral(result))unsupported('color-valued function',token.at);return result;}
  finally{functionDepth--;}
 }
 let loopSequence=0;
 const symbolNames=new Set(tokens.filter(token=>/^[A-Za-z_$]/.test(token.text)).map(token=>token.text));
 function controlLoop(depth:number):string{
  expect('(');const variable=take();if(variable.text==='$preview')unsupported('read-only full-render $preview',variable.at);if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variable.text))unsupported('loop variable',variable.at);expect('=');
  let generated:string;do{generated=`cadLoop${loopSequence++}`;}while(symbolNames.has(generated));symbolNames.add(generated);
  let range:string[]|undefined,items:Value[];
  if(peek()==='['){take();items=[];
   if(peek()!==']'){const first=value(0,[':']);if(peek()===':'){take();const second=value(0,[':']);let step='1',start=scalar(first),end=scalar(second);if(peek()===':'){take();step=scalar(second);end=scalar(value());}else{start=`min(${scalar(first)}, ${scalar(second)})`;end=`max(${scalar(first)}, ${scalar(second)})`;}range=[start,end,step];}
    else{items.push(first);while(peek()===','){take();if(peek()===']')break;items.push(value());if(items.length>64)limited(t('Loop exceeds 64 values'));}}
   }expect(']');
  }else{const v=value();if(!Array.isArray(v))unsupported('for requires a range or vector',variable.at);items=v as Value[];}
  if(peek()===',')unsupported('multiple for bindings; nest for operators',variable.at);expect(')');if(items.some(colorLiteral))unsupported('string loop values',variable.at);
  const outer=locals,scope=new Map<string,ScopeValue>(outer);locals=scope;
  try{
   if(range||items!.every(item=>typeof item==='string')){
    scope.set(variable.text,generated);const body=peek()==='{'?block(depth+1):shape(depth+1);
    return range?`forRange(${generated}, ${range.join(', ')}, ${body})`:`forValues(${generated}, [${items!.join(', ')}], ${body})`;
   }
   // Vector-valued lists have fixed length. Expand each lexical instance while
   // retaining the expressions within that instance, without numerical baking.
   if(items!.length>64)limited(t('Loop exceeds 64 values'));const begin=cursor,parts:string[]=[];let end:number|undefined;
   for(const item of items!){cursor=begin;locals=new Map(outer);locals.set(variable.text,item);parts.push(peek()==='{'?block(depth+1):shape(depth+1));if(end!==undefined&&cursor!==end)unsupported('loop body');end=cursor;}
   if(end!==undefined)cursor=end;return union(parts);
  }finally{locals=outer;}
 }
 function withFragmentCount<T>(named:Map<string,Value>,body:()=>T):T{
  const outer=locals;
  if(named.has('$fn')){locals=new Map(outer);locals.set('$fn',scalar(named.get('$fn')));}
  try{return body();}finally{locals=outer;}
 }
 function profile(depth=0):string{
  if(depth>32||++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));
  const combine=(parts:string[],kind='union2d')=>parts.length===1&&kind!=='hull2d'?parts[0]:`${kind}(${parts.join(', ')})`;
  if(peek()==='{'){take();const parts:string[]=[];while(peek()!=='}'){if(!peek())fail(t('Unclosed OpenSCAD block'));parts.push(profile(depth+1));}expect('}');return combine(parts);}
  const token=take(),name=token.text;if(name==='#'){omittedHighlight=true;return profile(depth+1);}if(!['polygon','square','circle','union','difference','intersection','hull','translate','rotate','scale'].includes(name))unsupported(`extrusion profile: ${name}`,token.at);
  const {named,use,allowed}=argumentsFor(name,token.at);
  if(['union','difference','intersection','hull'].includes(name)){allowed([],0);const parts:string[]=[];if(peek()==='{'){take();while(peek()!=='}'){if(!peek())fail(t('Unclosed OpenSCAD block'));parts.push(profile(depth+1));}expect('}');}else parts.push(profile(depth+1));return combine(parts,name==='difference'?'subtract2d':name==='intersection'?'intersect2d':name+'2d');}
  if(['translate','rotate','scale'].includes(name)){
   allowed([name==='rotate'?'a':'v','$fn'],1);const raw=use(name==='rotate'?'a':'v',0);let components:string[];
   if(name==='rotate'){if(typeof raw==='string')components=[raw];else if(Array.isArray(raw)&&raw.length===3&&raw.slice(0,2).every(v=>v==='0'))components=[scalar(raw[2])];else unsupported('profile rotation outside XY plane',token.at);}
   else if(typeof raw==='string'&&name==='scale')components=[raw,raw];else if(Array.isArray(raw)&&[2,3].includes(raw.length)&&raw.every(v=>typeof v==='string'))components=(raw as string[]).slice(0,2);else return fail(t('Expected a two-dimensional profile transform'),token.at);
   return `${name==='translate'?'move2d':name+'2d'}(${components!.join(', ')}, ${withFragmentCount(named,()=>profile(depth+1))})`;
  }
  expect(';');
  if(name==='polygon'){allowed(['points','paths','convexity'],2);const points=use('points',0),paths=use('paths',1);if(!Array.isArray(points)||points.length<3||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='string')))fail(t('Expected an OpenSCAD polygon point list'),token.at);if(paths!==undefined&&(!Array.isArray(paths)||!paths.every(p=>Array.isArray(p)&&p.every(v=>typeof v==='string'))))unsupported('polygon paths',token.at);return `polygon2d([${(points as string[][]).map(p=>`[${p.join(', ')}]`).join(', ')}]${Array.isArray(paths)&&paths.length?', ['+(paths as string[][]).map(p=>'['+p.join(', ')+']').join(', ')+']':''})`;}
  if(name==='square'){allowed(['size','center'],2);const raw=use('size',0,'1'),size=typeof raw==='string'?[raw,raw]:raw;if(!Array.isArray(size)||size.length!==2||!size.every(v=>typeof v==='string'))fail(t('Expected an OpenSCAD square size'),token.at);return `rectangle2d(${(size as string[]).join(', ')}, ${scalar(use('center',1,'false'))})`;}
  allowed(['r','d','$fn'],1);if(named.has('d')&&(named.has('r')||use('r',0)!==undefined))unsupported('circle: both radius and diameter',token.at);return `circle2d(${named.has('d')?'('+scalar(named.get('d'))+') / 2':scalar(use('r',0,'1'))}, ${scalar(named.get('$fn')??localValue('$fn'),fn)})`;
 }
 function shape(depth=0):string{
  if(depth>32||++statements>CODE_LIMITS.statements)limited(t('OpenSCAD construction limit exceeded'));if(peek()==='{')return block(depth,true);
  const token=take(),name=token.text;
  if(name==='#'){omittedHighlight=true;return shape(depth+1);}
  if(name==='for')return controlLoop(depth);
  if(name==='if'){expect('(');const condition=scalar(value());expect(')');const yes=peek()==='{'?block(depth+1):shape(depth+1);let no='empty()';if(peek()==='else'){take();no=peek()==='{'?block(depth+1):shape(depth+1);}return `choose(${condition}, ${yes}, ${no})`;}
  if(name===';')return 'empty()';
  if(name==='color'&&!modules.has(name)){
   // Appearance does not alter a solid. Accept explicit constant appearance only,
   // and disclose its omission in the converted source rather than claiming colors survive.
   expect('(');const namedColor=peek()==='c'&&peek(1)==='=';if(namedColor){take();take();}
   const color=value();
   if(color instanceof LiteralString){
    if(!/^(?:[A-Za-z]+|#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8})$/.test(color.text))unsupported('color string',token.at);
   }else{
    if(!Array.isArray(color)||![3,4].includes(color.length)||!color.every(component=>typeof component==='string'&&/^(?:0(?:\.\d*)?|1(?:\.0*)?|\.\d+)$/.test(component)))unsupported('constant RGB or RGBA color',token.at);
   }
   if(peek()===','){take();const namedAlpha=peek()==='alpha'&&peek(1)==='=';if(namedColor&&!namedAlpha)unsupported('positional color argument after named color',token.at);if(namedAlpha){take();take();}const alpha=scalar(value());if(!/^(?:0(?:\.\d*)?|1(?:\.0*)?|\.\d+)$/.test(alpha))unsupported('constant color alpha',token.at);}
   expect(')');omittedColor=true;return peek()==='{'?block(depth+1):shape(depth+1);
  }

  if(!modules.has(name)&&!['cube','sphere','cylinder','translate','rotate','scale','union','difference','intersection','hull','linear_extrude','rotate_extrude'].includes(name))unsupported(name,token.at);
  const args=argumentsFor(name,token.at),{named,positional,use,allowed}=args;
  if(modules.has(name)){
   const definition=modules.get(name)!;
   // Custom modules with child geometry require children() semantics, not silent discarding.
   if(peek()!==';')unsupported('module child geometry',token.at);expect(';');
   return invokeDefinition('module',definition,args,token.at,()=>peek()==='{'?block(depth+1):shape(depth+1));
  }
  const centerZ=(v:Value|undefined,height:string)=>v==='true'?'0':v===undefined||v==='false'?`(${height}) / 2`:`(${scalar(v)}) ? 0 : (${height}) / 2`;
  const segments=()=>scalar(named.get('$fn')??localValue('$fn'),fn);
  if(['union','difference','intersection','hull'].includes(name)){allowed([],0);const parts:string[]=[];if(peek()==='{')parts.push(...blockParts(depth));else parts.push(shape(depth+1));if(!parts.length)return 'empty()';if(parts.length===1&&name!=='hull')return parts[0];return `${name==='hull'?'hull':name==='difference'?'subtract':name==='intersection'?'intersect':'union'}(${parts.join(', ')})`;}
  if(['translate','rotate','scale'].includes(name)){allowed([name==='rotate'?'a':'v','$fn'],1);const v=use(name==='rotate'?'a':'v',0);const vec=name==='rotate'&&typeof v==='string'?['0','0',v]:vector(v,name==='scale');const child=withFragmentCount(named,()=>peek()==='{'?block(depth):shape(depth+1));return `${name==='translate'?'move':name}([${vec.join(', ')}], ${child})`;}
  if(name==='rotate_extrude'){allowed(['angle','convexity','$fn'],0);return `revolve(${profile(depth+1)}, ${scalar(named.get('angle'),'360')}, ${segments()})`;}
  if(name==='linear_extrude'){allowed(['height','center','convexity','twist','slices','scale','$fn'],2);const height=scalar(use('height',0,'1')),twist=scalar(named.get('twist'),'0'),top=named.get('scale')??'1',scale=typeof top==='string'?[top,top]:top;if(!Array.isArray(scale)||scale.length!==2||!scale.every(v=>typeof v==='string'))unsupported('linear_extrude scale',token.at);const count=scalar(named.get('slices'),twist==='0'?'1':scalar(named.get('$fn')??localValue('$fn'),fn)),body=`extrudeProfile(${height}, ${profile(depth+1)}, -(${twist}), ${count}, ${(scale as string[]).join(', ')})`;const flag=use('center',1);return flag===undefined||flag==='false'?body:`move([0, 0, (${scalar(flag)}) ? -(${height}) / 2 : 0], ${body})`;}
  expect(';');
  if(name==='cube'){allowed(['size','center'],2);const size=vector(use('size',0,'1'),true),body=`box(${size.join(', ')})`;const flag=use('center',1);return flag==='true'?body:`move([${size.map(v=>centerZ(flag,v)).join(', ')}], ${body})`;}
  if(name==='sphere'){allowed(['r','d','$fn'],1);if(named.has('d')&&(named.has('r')||positional.length))unsupported('sphere: both radius and diameter',token.at);const radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',0,'1'));return `sphere(${radius}, ${segments()})`;}
  if(['r1','r2','d1','d2'].some(key=>named.has(key))||positional.length>2){
   allowed(['h','r1','r2','d1','d2','center','$fn'],4);
   if(named.has('r1')&&named.has('d1')||named.has('r2')&&named.has('d2')||positional[1]!==undefined&&named.has('d1')||positional[2]!==undefined&&named.has('d2'))unsupported('cylinder: duplicate taper radius',token.at);
   const height=scalar(use('h',0,'1')),bottom=named.has('d1')?`(${scalar(named.get('d1'))}) / 2`:scalar(use('r1',1,'1')),top=named.has('d2')?`(${scalar(named.get('d2'))}) / 2`:scalar(use('r2',2,'1'));
   const body=`frustum(${bottom}, ${top}, ${height}, ${segments()})`;return `move([0, 0, ${centerZ(use('center',3),height)}], ${body})`;
  }
  allowed(['h','r','d','center','$fn'],2);if(named.has('d')&&(named.has('r')||positional[1]!==undefined))unsupported('cylinder: both radius and diameter',token.at);const height=scalar(use('h',0,'1')),radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',1,'1')),body=`cylinder(${radius}, ${height}, ${segments()})`;return `move([0, 0, ${centerZ(named.get('center'),height)}], ${body})`;
 }
 let constructionAt=0;const shapes:string[]=[];while(cursor<tokens.length){if(definitions.has(cursor)){cursor=definitions.get(cursor)!;continue;}if(peek(1)==='='){const token=take(),name=token.text;take();if(name==='$preview')unsupported('read-only full-render $preview',token.at);if(shapes.length)unsupported('assignment after geometry',token.at);const v=value();expect(';');if(colorLiteral(v))return unsupported('global color literal assignment',token.at);if(name==='$fn')fn=scalar(v);else{if(!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)||['constructor','prototype'].includes(name))unsupported(name,token.at);if(assignments.has(name)||vectors.has(name))unsupported('variable reassignment',token.at);if(Array.isArray(v))vectors.set(name,v);else assignments.set(name,v);}if(++statements>CODE_LIMITS.statements)limited(t('Too many statements'));}else{constructionAt=tokens[cursor]?.at??0;shapes.push(shape());}}
 if(!shapes.length)fail(t('OpenSCAD block contains no supported solid'));
 const program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:`// Converted from the supported OpenSCAD subset.\n// Curved and twisted surfaces use the native kernel tessellation.\n${fullRenderPreview?'// Full-render import context: $preview = false.\n':''}${omittedColor?'// Appearance colors omitted; solid geometry retained.\n':''}${omittedHighlight?'// Preview highlights omitted; solid geometry retained.\n':''}${[...assignments].map(([name,v])=>`param ${name}: scalar = ${v};`).join('\n')}\nreturn ${union(shapes)};\n`};try{compileCode(program);}catch(error){if(error instanceof CadCodeError)throw new CadCodeError(t`Converted OpenSCAD construction: ${error.detail}`,constructionAt,source,error.code);throw error;}return program;
}
