// SPDX-License-Identifier: BSD-3-Clause
// Original symbolic translator from published language documentation, not GPL code.
import {CadCodeError,CODE_LIMITS,compileCode} from './code.js';
import type {CodeProgram} from './code.js';
import {t} from './i18n.js';
import {evaluateExpression} from './parameters.js';
class FunctionValue {constructor(readonly definition:Definition){}}
class TextValue {constructor(readonly text:string){}}
class UndefinedValue {readonly kind='undefined';constructor(readonly reason?:string){}}
class ChoiceValue {constructor(readonly condition:string,readonly yes:Value,readonly no:Value){}}
type Value=string|TextValue|UndefinedValue|ChoiceValue|FunctionValue|Value[];
type ScopeValue=Value|LocalBinding;
class LocalBinding {constructor(readonly start:number,readonly end:number,readonly scope:Map<string,ScopeValue>,readonly outer?:Map<string,ScopeValue>,readonly moduleScope?:Map<string,Definition>,readonly functionScope?:Map<string,Definition>){}}
type Definition={scope?:Map<string,ScopeValue>;moduleScope:Map<string,Definition>;functionScope:Map<string,Definition>;parameters:{name:string;start?:number;end?:number}[];start:number;end:number};
/** Bounded declarative OpenSCAD subset. Unsupported constructs fail closed. */
export function importOpenSCAD(source:string):CodeProgram{
 if(typeof source!=='string')throw new CadCodeError(t('Expected source text'),0,'');
 const tokens:{text:string;at:number}[]=[];let position=0,cursor=0,statements=0,fn='48',fullRenderPreviewUsed=false,xyTranslation=false,assertionsUsed=false,rootSelectionUsed=false;const warnings=new Set<string>(),rootObjects:string[]=[];const localCache=new WeakMap<LocalBinding,Value>();const assertedScalars=new Map<string,{condition:string;value:string}>(),assertedArrays=new WeakMap<Value[],{condition:string;value:Value[]}>();const assignments=new Map<string,string>();
 const globals=new Map<string,LocalBinding>(),globalCache=new Map<string,Value>(),globalDeclarations=new Map<number,number>(),nativeNames=new Map<string,string>();
 const vectors=new Map<string,Value>();let locals=new Map<string,ScopeValue>();const resolving=new Set<LocalBinding>();
 let modules=new Map<string,Definition>(),functions=new Map<string,Definition>();let functionDepth=0;
 const fail=(message:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(message,at,source);};
 const limited=(message:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(message,at,source,'resource-limit');};
 let valueEvaluations=0;const chargeValues=(count=1)=>{valueEvaluations+=count;if(valueEvaluations>16384)limited(t('OpenSCAD construction limit exceeded'));};
 if(new TextEncoder().encode(source).length>CODE_LIMITS.sourceBytes)limited(t('Source exceeds 32 KiB'),0);
 while(position<source.length){if(/\s/.test(source[position])){position++;continue;}if(source.startsWith('//',position)){const end=source.indexOf('\n',position);position=end<0?source.length:end+1;continue;}if(source.startsWith('/*',position)){const end=source.indexOf('*/',position+2);if(end<0)fail(t('Unclosed OpenSCAD comment'),position);position=end+2;continue;}
  const text=/^"(?:\\.|[^"\\])*"|^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_$][A-Za-z0-9_$]*|^(?:==|!=|<=|>=|&&|\|\|)|^[{}\[\](),;=+*/%!?<>:^#~.-]|^[\s\S]/.exec(source.slice(position))?.[0];if(!text)fail(t('Unsupported OpenSCAD token'),position);tokens.push({text:text!,at:position});position+=text!.length;if(tokens.length>CODE_LIMITS.tokens)limited(t('Too many source tokens'),position);
 }
 const peek=(ahead=0)=>tokens[cursor+ahead]?.text;
 const take=()=>{const next=tokens[cursor++];if(!next)fail(t('Unexpected end of source'));return next!;};
 const expect=(value:string)=>{if(peek()!==value)fail(t`Expected “${value}”`);take();};
 const unsupported=(name:string,at=tokens[cursor]?.at??source.length):never=>{throw new CadCodeError(t`Unsupported OpenSCAD feature “${name}”`,at,source,'unsupported-feature');};
 for(let i=0;i<tokens.length;i++)if(tokens[i].text==='$preview'&&tokens[i+1]?.text==='=')unsupported('assignment to readonly $preview',tokens[i].at);
 // Defaults apply to scalar reads, not absence checks that select legacy tessellation.
 function fragmentDefault(name:string):string|undefined{return name==='$fn'?'0':name==='$fa'?'12':name==='$fs'?'2':undefined;}
 function localValue(name:string):Value|undefined{chargeValues();
  const binding=locals.get(name);if(binding===undefined&&globals.has(name)){const v=globalValue(name);return typeof v==='string'&&!name.startsWith('$')?nativeNames.get(name)!:v;}if(!(binding instanceof LocalBinding))return binding;const cached=localCache.get(binding);if(cached!==undefined)return cached;
  if(resolving.has(binding)){if(binding.outer?.has(name)){const previous=locals;locals=binding.outer;try{return localValue(name);}finally{locals=previous;}}if(globals.has(name)){const result=globalValue(name);return typeof result==='string'&&!name.startsWith('$')?nativeNames.get(name)!:result;}const fallback=fragmentDefault(name);if(fallback!==undefined)return fallback;return new UndefinedValue('local variable dependency cycle');}
  if(resolving.size>=32)limited(t('OpenSCAD construction limit exceeded'));
  const resume=cursor,outer=locals,outerModules=modules,outerFunctions=functions;resolving.add(binding);locals=binding.scope;modules=binding.moduleScope??modules;functions=binding.functionScope??functions;cursor=binding.start;
  try{const result=value();if(cursor!==binding.end)unsupported('local variable expression');localCache.set(binding,result);return result;}
  finally{cursor=resume;locals=outer;modules=outerModules;functions=outerFunctions;resolving.delete(binding);}
 }
 const mathFunctions=new Set(['sin','cos','tan','asin','acos','atan','atan2','sqrt','abs','floor','ceil','round','exp','ln','log','pow','min','max']);
 const bounded=(text:string)=>{if(text.length>1024)limited(t('OpenSCAD expanded expression limit exceeded'));return text;};
 function constant(v:Value):number|undefined{if(typeof v!=='string')return undefined;try{return evaluateExpression(v,()=>{throw new Error('symbolic');}).value;}catch{return undefined;}}
 function truth(v:Value):string{chargeValues();const guard=assertionCondition([v]);if(guard)return scalar(guardValue(guard,truth(withoutAssertions(v))));if(v instanceof ChoiceValue)return scalar(conditional(v.condition,truth(v.yes),truth(v.no)));if(v instanceof TextValue)return v.text.length?'true':'false';if(v instanceof UndefinedValue)return 'false';if(v instanceof FunctionValue)return 'true';if(Array.isArray(v))return v.length?'true':'false';return v;}
 function conditional(c:Value,a:Value,b:Value):Value{chargeValues();const cg=assertionCondition([c]),ag=assertionCondition([a]),bg=assertionCondition([b]);if(cg||ag||bg){const raw=withoutAssertions(c),branch=ag||bg?`(${truth(raw)}) ? (${ag??'true'}) : (${bg??'true'})`:'true',guard=bounded(cg?`(${cg}) && (${branch})`:branch);return guardValue(guard,conditional(raw,withoutAssertions(a),withoutAssertions(b)));}const condition=truth(c),n=constant(condition);if(n!==undefined)return n?a:b;if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length)return a.map((v,i)=>conditional(c,v,(b as Value[])[i]));if(typeof a!=='string'||typeof b!=='string')return new ChoiceValue(condition,a,b);return bounded(`(${condition}) ? (${a}) : (${b})`);}
 function binary(op:string,a:Value,b:Value):Value{chargeValues();const guard=assertionCondition([a,b]);if(guard)return guardValue(guard,binary(op,withoutAssertions(a),withoutAssertions(b)));
  if(a instanceof ChoiceValue)return conditional(a.condition,binary(op,a.yes,b),binary(op,a.no,b));if(b instanceof ChoiceValue)return conditional(b.condition,binary(op,a,b.yes),binary(op,a,b.no));
  if(op==='=='||op==='!='){
   if(a instanceof TextValue||b instanceof TextValue||a instanceof UndefinedValue||b instanceof UndefinedValue){const equal=a instanceof TextValue&&b instanceof TextValue?a.text===b.text:a instanceof UndefinedValue&&b instanceof UndefinedValue;return (op==='=='?equal:!equal)?'true':'false';}
   if(Array.isArray(a)||Array.isArray(b)){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return op==='=='?'false':'true';if(!a.length)return op==='=='?'true':'false';const parts=a.map((v,i)=>binary('==',v,(b as Value[])[i]));return (op==='!='?'!':'')+'('+parts.map(truth).join(' && ')+')';}
  }
  const reason=cycle(a)??cycle(b);if(reason)unsupported(reason);
  if(Array.isArray(a)||Array.isArray(b)){
   if(Array.isArray(a)&&Array.isArray(b)){if(a.length!==b.length)unsupported('vector dimension mismatch');if(op==='*')return a.map((v,i)=>scalar(binary('*',v,(b as Value[])[i]))).reduce((sum,v)=>bounded(`(${sum}) + (${v})`),'0');if(!['+','-'].includes(op))unsupported('vector operator '+op);return a.map((v,i)=>binary(op,v,(b as Value[])[i]));}
   if(!['*','/'].includes(op)||op==='/'&&Array.isArray(b))unsupported('vector operator '+op);return Array.isArray(a)?a.map(v=>binary(op,v,b)):(b as Value[]).map(v=>binary(op,a,v));
  }
  if(op==='&&'||op==='||'){a=truth(a);b=truth(b);}
  if(typeof a!=='string'||typeof b!=='string')unsupported('numeric operation on string or undef');
  const result=op==='^'?`pow(${a}, ${b})`:`(${a}) ${op} (${b})`,n=constant(result);if(n!==undefined&&Number.isFinite(n))return ['==','!=','<','>','<=','>=','&&','||'].includes(op)?n?'true':'false':String(n);return bounded(result);
 }
 function indexValue(v:Value,index:Value):Value{chargeValues();const guard=assertionCondition([v,index]);if(guard)return guardValue(guard,indexValue(withoutAssertions(v),withoutAssertions(index)));if(v instanceof ChoiceValue)return conditional(v.condition,indexValue(v.yes,index),indexValue(v.no,index));const key=scalar(index);if(key==='true'||key==='false')return unsupported('boolean vector index');const n=constant(key),items=v instanceof TextValue?[...v.text].map(ch=>new TextValue(ch)):Array.isArray(v)?v:undefined;if(!items)return new UndefinedValue();if(n!==undefined)return Number.isInteger(n)&&n>=0&&n<items.length?items[n]:new UndefinedValue();let out:Value=new UndefinedValue();for(let i=items.length-1;i>=0;i--)out=conditional(`(${key}) == ${i}`,items[i],out);return out;}
 function builtin(name:string,args:Value[]):Value{chargeValues();const guard=assertionCondition(args);if(guard)return guardValue(guard,builtin(name,args.map(withoutAssertions)));
  const variant=args.findIndex(v=>v instanceof ChoiceValue);if(variant>=0){const v=args[variant] as ChoiceValue;return conditional(v.condition,builtin(name,args.map((a,i)=>i===variant?v.yes:a)),builtin(name,args.map((a,i)=>i===variant?v.no:a)));}
  if(name==='search'){
   if(args.length<2||args.length>4||!Array.isArray(args[0])||!Array.isArray(args[1]))unsupported('search requires fixed needle and table lists');
   const needles=args[0] as Value[],table=args[1] as Value[],limit=args.length>2?constant(args[2]):1,column=args.length>3?constant(args[3]):0;
   if(limit===undefined||column===undefined||!Number.isSafeInteger(limit)||limit<0||limit>256||!Number.isSafeInteger(column)||column<0||column>255)unsupported('constant search limit and column');
   return needles.map(needle=>{const matches:Value[]=[];for(let i=0;i<table.length;i++){chargeValues();const row=table[i],cell=Array.isArray(row)?row[column!]:row;if(cell===undefined)continue;const equal=constant(truth(binary('==',needle,cell)));if(equal===undefined)unsupported('parameter-dependent search match');if(equal){matches.push(String(i));if(limit&&matches.length>=limit)break;}}return limit===1?(matches[0]??[]):matches;});
  }
  if(name==='len'){if(args.length!==1||!Array.isArray(args[0])&&!(args[0] instanceof TextValue))unsupported('len argument');return String(args[0] instanceof TextValue?[...args[0].text].length:(args[0] as Value[]).length);}
  if(name==='concat'){const result=args.flatMap(v=>Array.isArray(v)?v:[v]);if(result.length>256)limited(t('OpenSCAD array limit exceeded'));return result;}
  if(name==='norm'){if(args.length!==1||!Array.isArray(args[0]))unsupported('norm argument');return bounded(`sqrt(${scalar(binary('*',args[0],args[0]))})`);}
  if(name.startsWith('is_')){if(args.length!==1)unsupported(name+' argument');const v=args[0],yes=name==='is_function'?v instanceof FunctionValue:name==='is_undef'?v instanceof UndefinedValue:name==='is_string'?v instanceof TextValue:name==='is_list'?Array.isArray(v):name==='is_bool'?v==='true'||v==='false':name==='is_num'?typeof v==='string'&&v!=='true'&&v!=='false':undefined;if(yes===undefined)unsupported(name);return yes?'true':'false';}
  if(name==='str'){return new TextValue(args.map(v=>v instanceof TextValue?v.text:v instanceof UndefinedValue?'undef':typeof v==='string'?constant(v)??unsupported('symbolic string formatting'):unsupported('vector string formatting')).join(''));}
  if(name==='pow'&&args.length===2)return binary('^',args[0],args[1]);
  if((name==='min'||name==='max')&&args.length===1&&Array.isArray(args[0]))args=args[0];
  if(!mathFunctions.has(name))unsupported(name);return bounded(`${name}(${args.map(v=>scalar(v)).join(', ')})`);
 }
 function skipValue(extraStops:string[]=[]):void{const stops=new Set([',',')',']',';',...extraStops]);let parens=0,brackets=0,questions=0;while(cursor<tokens.length){const n=peek()!;if(parens===0&&brackets===0&&stops.has(n)&&!(n===':'&&questions>0))break;if(n==='(')parens++;if(n===')'){if(!parens)break;parens--;}if(n==='[')brackets++;if(n===']'){if(!brackets)break;brackets--;}if(!parens&&!brackets){if(n==='?')questions++;if(n===':'&&questions)questions--;}take();}}
 function comprehension(depth:number):Value[]{
  if(depth>32)limited(t('OpenSCAD array nesting limit exceeded'));expect('for');expect('(');
  const bindings:{variable:{text:string;at:number};start:number;end:number}[]=[];
  while(true){
   const variable=take();if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variable.text)||variable.text==='$preview'||bindings.some(b=>b.variable.text===variable.text))unsupported('comprehension variable',variable.at);expect('=');
   const start=cursor;skipValue();if(cursor===start)fail(t('Expected a complete dimensional expression'));bindings.push({variable,start,end:cursor});if(bindings.length>8)limited(t('OpenSCAD construction limit exceeded'));if(peek()!==',')break;take();
  }
  expect(')');if(peek()==='if')unsupported('comprehension filters',tokens[cursor].at);
  const begin=cursor,outer=locals,result:Value[]=[];let end:number|undefined;
  const append=(values:Value[])=>{if(result.length+values.length>256)limited(t('OpenSCAD array limit exceeded'));result.push(...values);};
  function input(variable:{text:string;at:number}):Value[]{
  const items:Value[]=[];
  const rangeNumber=(v:Value):number=>{const n=constant(v);if(typeof v!=='string'||v==='true'||v==='false'||n===undefined||!Number.isFinite(n)||Math.abs(n)>1e6)return unsupported('comprehension range must be finite and independent of parameters',variable.at);return n;};
  if(peek()==='['){take();if(peek()!==']'){
    const first=value(depth+1,[':']);
    if(peek()===':'){
     take();const second=value(depth+1,[':']);let start=rangeNumber(first),end=rangeNumber(second),step=1;
     if(peek()===':'){take();step=rangeNumber(second);end=rangeNumber(value(depth+1));}else [start,end]=[Math.min(start,end),Math.max(start,end)];
     if(step===0)unsupported('comprehension range step must be nonzero',variable.at);
     const quotient=(end-start)/step,count=quotient<0?0:Math.floor(quotient+4*Number.EPSILON*Math.max(1,Math.abs(quotient)))+1;
     if(count>64)limited(t('Loop exceeds 64 values'));chargeValues(count);
     for(let i=0;i<count;i++)items.push(String(start+i*step));
    }else{
     items.push(first);while(peek()===','){take();if(peek()===']')break;items.push(value(depth+1));if(items.length>64)limited(t('Loop exceeds 64 values'));}
    }
   }expect(']');
  }else{const list=value(depth+1);if(!Array.isArray(list))unsupported('comprehension requires a fixed-length vector',variable.at);if(assertionCondition([list]))unsupported('asserted comprehension input',variable.at);items.push(...list as Value[]);}
  if(assertionCondition(items))unsupported('asserted comprehension input',variable.at);if(items.length>64)limited(t('Loop exceeds 64 values'));
   return items;
  }
  function expand(index:number):void{
   chargeValues();
   if(index===bindings.length){
    cursor=begin;
    if(peek()==='for')append(comprehension(depth+1));
    else if(peek()==='each'){take();const list=value(depth+1);if(!Array.isArray(list))unsupported('each requires a fixed-length vector');append(list as Value[]);}
    else append([value(depth+1)]);
    if(end!==undefined&&cursor!==end)unsupported('comprehension body');end=cursor;return;
   }
   const binding=bindings[index];cursor=binding.start;const items=input(binding.variable);if(cursor!==binding.end)unsupported('comprehension input',binding.variable.at);
   const scope=locals;
   try{for(const item of items){locals=new Map(scope);locals.set(binding.variable.text,item);expand(index+1);}}finally{locals=scope;}
  }
  try{expand(0);if(end===undefined){cursor=begin;if(peek()===']')fail(t('Expected a complete dimensional expression'));skipValue();}else cursor=end;return result;}finally{locals=outer;}
 }

 function value(depth=0,extraStops:string[]=[]):Value{chargeValues();
  if(depth>32)limited(t('OpenSCAD array nesting limit exceeded'));const stop=new Set([',',')',']',';',...extraStops]);
  const precedences:Record<string,number>={'||':1,'&&':2,'==':3,'!=':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6,'^':7};
  function primary(level:number):Value{
   if(level>32)limited(t('Expression nesting exceeds 32'));const token=peek();let result:Value;
   if(token==='+'||token==='-'||token==='!'){take();const child=primary(level+1);result=token==='!'?binary('==',truth(child),'false'):Array.isArray(child)?child.map(v=>binary('*',token==='-'?'-1':'1',v)):unaryScalar(token,child);}
   else if(token==='('){take();result=expression(0,level+1);expect(')');}
   else if(token==='['){take();if(peek()==='for'){result=comprehension(depth+1);expect(']');}else{const list:Value[]=[];while(peek()!==']'){if(peek()==='for')list.push(...comprehension(depth+1));else list.push(value(depth+1));if(list.length>256)limited(t('OpenSCAD array limit exceeded'));if(peek()!==',')break;take();}expect(']');result=list;}}
   else if(token?.startsWith('"')){take();try{result=new TextValue(JSON.parse(token));}catch{return fail(t('Invalid OpenSCAD string'),tokens[cursor-1].at);}}
   else if(token==='undef'){take();result=new UndefinedValue();}
   else if(token==='let'){
    take();expect('(');const outer=locals,scope=new Map(outer),bindings:Value[]=[];locals=scope;
    try{while(peek()!==')'){
     const name=take();if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name.text)||name.text==='$preview')unsupported('let expression binding',name.at);expect('=');const binding=value(depth+1);scope.set(name.text,binding);bindings.push(binding);if(bindings.length>64)limited(t('OpenSCAD construction limit exceeded'));if(peek()!==',')break;take();
    }expect(')');result=value(depth+1,extraStops);const guard=assertionCondition(bindings);if(guard)result=guardValue(guard,result);
    }finally{locals=outer;}
   }
   else if(token==='function'){take();result=functionLiteral(extraStops);}
   else if(token==='assert'){take();const condition=assertion();result=guardValue(condition,value(depth+1,extraStops));}
   else if(token&&functions.has(token)&&peek(1)==='(')result=callFunction();
   else if(token&&peek(1)==='('&&(localValue(token) instanceof FunctionValue))result=callFunction((localValue(token) as FunctionValue).definition);
   else if(token&&peek(1)==='('){take();take();const args:Value[]=[];while(peek()!==')'){args.push(value(depth+1));if(peek()!==',')break;take();}expect(')');result=builtin(token,args);}
   else if(token&&/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)){
    take();if(token==='$preview')fullRenderPreviewUsed=true;const bound=localValue(token)??vectors.get(token);
    if(bound!==undefined)result=bound;
    else if(token==='$t'){warnings.add(t('Unbound animation time uses $t=0; motion is not retained.'));result='0';}
    else result=token==='PI'&&!declaredGlobals.has('PI')?'3.141592653589793':token==='true'||token==='false'?token:fragmentDefault(token)??(token==='$children'?'0':token==='$preview'?'false':new UndefinedValue());
   }
   else if(token&&/^(?:\d|\.\d)/.test(token)){take();result=token;}
   else return fail(t('Expected a complete dimensional expression'));
   while(peek()==='['||peek()==='.'){if(peek()==='.'){take();const component=take();const index=['x','y','z'].indexOf(component.text);if(index<0)unsupported('vector component',component.at);result=indexValue(result,String(index));}else{take();const index=value(depth+1);expect(']');result=indexValue(result,index);}}return result;
  }
  function skipOperand(minimum:number):void{const head=take().text;if(['+','-','!'].includes(head))skipOperand(8);else if(head==='('||head==='['){const close=head==='('?')':']';let nesting=1;while(nesting){const n=take().text;if(n===head)nesting++;if(n===close)nesting--;}}else if(peek()==='('){take();let nesting=1;while(nesting){const n=take().text;if(n==='(')nesting++;if(n===')')nesting--;}}while(peek()==='['||peek()==='.'){if(peek()==='.'){take();take();}else{take();let nesting=1;while(nesting){const n=take().text;if(n==='[')nesting++;if(n===']')nesting--;}}}while(precedences[peek()!]!==undefined&&precedences[peek()!]>=minimum){const op=take().text,p=precedences[op];skipOperand(p+(op==='^'?0:1));}}
  function expression(minimum:number,level:number):Value{let left=primary(level);while(true){const op=peek()!,p=precedences[op];if(p===undefined||p<minimum||stop.has(op))break;take();const known=(op==='&&'||op==='||')?constant(truth(left)):undefined;if(op==='&&'&&known===0||op==='||'&&known!==undefined&&known!==0){skipOperand(p+1);left=op==='&&'?'false':'true';}else left=binary(op,left,expression(p+(op==='^'?0:1),level+1));}if(minimum===0&&peek()==='?'&&!stop.has('?')){take();const known=constant(truth(left));let yes:Value=new UndefinedValue(),no:Value=new UndefinedValue();if(known===0)skipValue([':']);else yes=value(depth+1,[':']);expect(':');if(known!==undefined&&known!==0)skipValue(extraStops);else no=value(depth+1,extraStops);left=known!==undefined?known?yes:no:conditional(left,yes,no);}return left;}
  return expression(0,0);
 }
 const cycle=(v:Value|undefined,seen=new Set<object>()):string|undefined=>{chargeValues();if(v instanceof UndefinedValue)return v.reason;if(!Array.isArray(v)||seen.has(v))return undefined;seen.add(v);for(const item of v){const reason=cycle(item,seen);if(reason)return reason;}return undefined;};
 const scalar=(v:Value|undefined,fallback?:string):string=>{const guard=v===undefined?undefined:assertionCondition([v]);if(guard&&v instanceof ChoiceValue)return scalar(guardValue(guard,scalar(withoutAssertions(v))));if(v instanceof ChoiceValue)return bounded(`(${v.condition}) ? (${v.yes instanceof UndefinedValue?'0/0':scalar(v.yes)}) : (${v.no instanceof UndefinedValue?'0/0':scalar(v.no)})`);const reason=cycle(v);if(reason)unsupported(reason);if(v===undefined&&fallback!==undefined)return fallback;if(typeof v!=='string')return fail(t('Expected a numeric OpenSCAD argument'));return v;};
 const vector=(v:Value|undefined,allowScalar=false):string[]=>{const reason=cycle(v);if(reason)unsupported(reason);if(v instanceof ChoiceValue){const vectorLeaf=(value:Value):boolean=>value instanceof ChoiceValue?vectorLeaf(value.yes)||vectorLeaf(value.no):Array.isArray(value);if(allowScalar&&!vectorLeaf(v)){const component=scalar(v);return [component,component,component];}return [0,1,2].map(i=>scalar(indexValue(v,String(i))));}if(Array.isArray(v)&&v.length===3)return v.map(x=>scalar(x));if(allowScalar&&!Array.isArray(v)&&v!==undefined){const component=scalar(v);return [component,component,component];}if(Array.isArray(v))return unsupported('vector length other than three');return fail(t('Expected a three-component OpenSCAD vector'));};
 // Definitions are hoisted in the file scope, so calls may precede declarations.
 const definitions=new Map<number,number>(),declaredGlobals=new Set<string>();
 function scanDefinition(scope?:Map<string,ScopeValue>){const begin=cursor,kind=take().text,collection=kind==='module'?modules:functions;const name=take();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.text))unsupported(`${kind} name`,name.at);expect('(');
  const parameters:{name:string;start?:number;end?:number}[]=[];
  while(peek()!==')'){const parameter=take();if(parameter.text==='$preview')unsupported('readonly $preview parameter',parameter.at);if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(parameter.text)||parameters.some(p=>p.name===parameter.text))unsupported('module parameter',parameter.at);
   const entry:{name:string;start?:number;end?:number}={name:parameter.text};
   if(peek()==='='){take();entry.start=cursor;let depth=0;while(cursor<tokens.length){const n=peek()!;if(depth===0&&(n===','||n===')'))break;if(n==='('||n==='[')depth++;if(n===')'||n===']')depth--;if(depth<0||depth>32)limited(t('Expression nesting exceeds 32'));take();}entry.end=cursor;if(entry.start===entry.end)fail(t('Expected a complete dimensional expression'));}
   parameters.push(entry);if(parameters.length>64)limited(t('OpenSCAD construction limit exceeded'));if(peek()!==',')break;take();
  }expect(')');if(kind==='function'){expect('=');const start=cursor;while(peek()!==';'){if(!peek())fail(t('Unexpected end of source'));take();}if(cursor===start)fail(t('Expected a complete dimensional expression'));collection.set(name.text,{scope,moduleScope:modules,functionScope:functions,parameters,start,end:cursor});expect(';');definitions.set(begin,cursor);return;}const start=cursor;
  // A module body is one statement; braces contain arbitrarily nested statements.
  let depth=0;do{const n=take().text;if(n==='{')depth++;if(n==='}')depth--;if(depth<0)fail(t('Unclosed OpenSCAD block'));if(depth===0&&(n===';'||n==='}'))break;}while(cursor<tokens.length);
  if(depth||cursor===start||![';','}'].includes(tokens[cursor-1].text))fail(t('Unclosed OpenSCAD block'));
  collection.set(name.text,{scope,moduleScope:modules,functionScope:functions,parameters,start,end:cursor});definitions.set(begin,cursor);
 }
 function globalValue(name:string):Value{const cached=globalCache.get(name);if(cached!==undefined)return cached;const binding=globals.get(name)!;if(resolving.has(binding))return new UndefinedValue('global variable dependency cycle');if(resolving.size>=32)limited(t('OpenSCAD construction limit exceeded'));const resume=cursor,outer=locals,outerModules=modules,outerFunctions=functions;resolving.add(binding);locals=new Map();modules=binding.moduleScope??modules;functions=binding.functionScope??functions;cursor=binding.start;try{const result=value();if(cursor!==binding.end)unsupported('global variable expression');globalCache.set(name,result);return result;}finally{cursor=resume;locals=outer;modules=outerModules;functions=outerFunctions;resolving.delete(binding);}}
 {let braces=0,parens=0,brackets=0;while(cursor<tokens.length){const n=peek();if(braces===0&&parens===0&&brackets===0&&(n==='include'||n==='use'))unsupported(n,tokens[cursor].at);if(braces===0&&parens===0&&brackets===0&&(n==='module'||n==='function')){scanDefinition();continue;}if(braces===0&&parens===0&&brackets===0&&peek(1)==='='){const begin=cursor,name=take();take();const start=cursor;let depth=0;while(peek()!==';'||depth!==0){const next=peek();if(!next||next==='{'||next==='}')unsupported('global variable expression',name.at);if(next==='('||next==='[')depth++;if(next===')'||next===']')depth--;if(depth<0||depth>32)limited(t('Expression nesting exceeds 32'));take();}const end=cursor;expect(';');if(start===end)fail(t('Expected a complete dimensional expression'),name.at);declaredGlobals.add(name.text);globals.set(name.text,new LocalBinding(start,end,new Map(),undefined,modules,functions));globalDeclarations.set(begin,cursor);if(!nativeNames.has(name.text)){const safe=/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name.text)&&!['mm','cm','m','in','deg','rad','constructor','prototype'].includes(name.text);let generated='cadGlobal'+nativeNames.size;while(tokens.some(token=>token.text===generated)||[...nativeNames.values()].includes(generated))generated+='x';nativeNames.set(name.text,safe?name.text:generated);}continue;}if(n==='{')braces++;if(n==='}')braces--;if(n==='(')parens++;if(n===')')parens--;if(n==='[')brackets++;if(n===']')brackets--;take();}cursor=0;}
 for(const [name] of globals){const v=globalValue(name);if(typeof v==='string'&&!name.startsWith('$'))assignments.set(nativeNames.get(name)!,v);if(++statements>4096)limited(t('Too many statements'));}
 function union(shapes:string[]):string{if(!shapes.length)return 'empty()';return shapes.length===1?shapes[0]:`union(${shapes.join(', ')})`;}
 function blockParts(depth:number,anonymous=false,planar=false):string[]{
  expect('{');const begin=cursor,outer=locals,outerModules=modules,outerFunctions=functions,scope=new Map<string,ScopeValue>(outer),declarations=new Map<number,number>();modules=new Map(modules);functions=new Map(functions);
  // Predeclare all direct assignments. OpenSCAD's last assignment wins throughout
  // its lexical scope, including uses appearing before the assignment.
  let braces=0,parentheses=0,brackets=0;
  while(cursor<tokens.length){const next=peek()!;if(next==='}'&&braces===0)break;
   if(braces===0&&parentheses===0&&brackets===0&&(next==='module'||next==='function')){const statement=cursor;scanDefinition(scope);declarations.set(statement,cursor);continue;}
   if(braces===0&&parentheses===0&&brackets===0&&peek(1)==='='){
    const statement=cursor,name=take();if(anonymous)unsupported('assignments in anonymous blocks',name.at);if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name.text))unsupported('local variable name',name.at);take();const start=cursor;
    let nesting=0;while(peek()!==';'||nesting!==0){const n=peek();if(!n||n==='{'||n==='}')unsupported('local variable expression',name.at);if(n==='('||n==='[')nesting++;if(n===')'||n===']')nesting--;if(nesting<0||nesting>32)limited(t('Expression nesting exceeds 32'));take();}
    const end=cursor;expect(';');if(start===end)fail(t('Expected a complete dimensional expression'),name.at);
    scope.set(name.text,new LocalBinding(start,end,scope,outer,modules,functions));declarations.set(statement,cursor);
    if(++statements>4096)limited(t('OpenSCAD construction limit exceeded'));continue;
   }
   if(next==='{')braces++;if(next==='}')braces--;if(next==='(')parentheses++;if(next===')')parentheses--;if(next==='[')brackets++;if(next===']')brackets--;take();
  }
  cursor=begin;locals=scope;
  try{const shapes:string[]=[];while(peek()!=='}'){
    if(!peek())fail(t('Unclosed OpenSCAD block'));const end=declarations.get(cursor);if(end!==undefined){cursor=end;continue;}shapes.push(planar?profile(depth+1):shape(depth+1));
   }expect('}');return shapes;
  }finally{locals=outer;modules=outerModules;functions=outerFunctions;}
 }
 function block(depth:number,anonymous=false):string{return union(blockParts(depth,anonymous));}
 function argumentsFor(name:string,at:number){
  expect('(');const named=new Map<string,Value>(),positional:Value[]=[];
  while(peek()!==')'){if(peek(1)==='='){const key=take().text;take();if(named.has(key))fail(t`Duplicate OpenSCAD argument “${key}”`);named.set(key,value());}else{if(named.size)fail(t('Positional OpenSCAD arguments must precede named arguments'));positional.push(value());}if(peek()!==',')break;take();}expect(')');
  const use=(key:string,index:number,fallback?:Value):Value|undefined=>{if(named.has(key)&&positional[index]!==undefined)fail(t`Duplicate OpenSCAD argument “${key}”`);return named.get(key)??positional[index]??fallback;};
  const allowed=(keys:string[],max:number)=>{for(const key of named.keys())if(!keys.includes(key)&&!key.startsWith('$'))unsupported(`${name}.${key}`,at);if(positional.length>max)unsupported(`${name}: too many arguments`,at);};
return {named,positional,use,allowed};
 }
 function unaryScalar(token:string,v:Value):Value{const guard=assertionCondition([v]),base=bounded(`${token}(${scalar(guard?withoutAssertions(v):v)})`);return guard?guardValue(guard,base):base;}
 function assertion():string{
  assertionsUsed=true;const at=tokens[cursor-1]?.at??0,args=argumentsFor('assert',at);args.allowed(['condition','message'],2);
  const condition=args.use('condition',0);if(condition===undefined)fail(t('Assertion requires a condition'),at);
  const message=args.use('message',1);if(message!==undefined){if(!(message instanceof TextValue))unsupported('constant assertion message',at);warnings.add(t('Assertion messages are archived; failures use a generic diagnostic.'));warnings.add('Assertion message: '+(message as TextValue).text);}
  return truth(condition!);
 }
 function assertionCondition(values:Value[]):string|undefined{
  if(!assertedScalars.size)return undefined;const conditions=new Set<string>();function collect(v:Value):void{chargeValues();if(typeof v==='string'){const guard=assertedScalars.get(v);if(guard)conditions.add(guard.condition);}else if(Array.isArray(v)){const guard=assertedArrays.get(v);if(guard)conditions.add(guard.condition);else v.forEach(collect);}else if(v instanceof ChoiceValue){const yes=assertionCondition([v.yes]),no=assertionCondition([v.no]);if(yes||no)conditions.add(bounded(`(${v.condition}) ? (${yes??'true'}) : (${no??'true'})`));}}
  values.forEach(collect);return conditions.size?bounded([...conditions].map(c=>`(${c})`).join(' && ')):undefined;
 }
 function withoutAssertions(v:Value):Value{chargeValues();if(typeof v==='string')return assertedScalars.get(v)?.value??v;if(Array.isArray(v)){const guard=assertedArrays.get(v);return guard?guard.value:v.map(withoutAssertions);}if(v instanceof ChoiceValue)return new ChoiceValue(v.condition,withoutAssertions(v.yes),withoutAssertions(v.no));return v;}
 function guardValue(condition:string,v:Value):Value{
  chargeValues();const known=constant(condition);if(known!==undefined&&known!==0)return v;
  if(typeof v==='string'){const result=bounded(`assertValue(${condition}, ${v})`);assertedScalars.set(result,{condition,value:v});return result;}
  if(Array.isArray(v)&&v.length){const result=v.map(item=>guardValue(condition,item));assertedArrays.set(result,{condition,value:v});return result;}
  if(v instanceof ChoiceValue)return new ChoiceValue(v.condition,guardValue(condition,v.yes),guardValue(condition,v.no));
  if(known===0)fail(t('Assertion failed'));return unsupported('parameter-dependent assertion returning empty, string or undefined value');
 }
 function invokeDefinition<T>(kind:string,definition:Definition,args:ReturnType<typeof argumentsFor>,at:number,body:()=>T):T{
  if(args.positional.length>definition.parameters.length||[...args.named.keys()].some(key=>!key.startsWith('$')&&!definition.parameters.some(p=>p.name===key)))warnings.add(t('Extra or unknown module/function arguments are ignored, as in OpenSCAD.'));
  const resume=cursor,outer=locals,outerModules=modules,outerFunctions=functions,specials:[string,Value][]=[...outer.keys()].filter(key=>key.startsWith('$')).map(key=>[key,localValue(key)!]);
  for(const [key,v] of args.named)if(key.startsWith('$'))specials.push([key,v]);
  const scope=new Map<string,ScopeValue>([...definition.scope??[],...specials]);locals=scope;modules=definition.moduleScope;functions=definition.functionScope;
  try{for(let i=0;i<definition.parameters.length;i++){
    const parameter=definition.parameters[i];let v=args.use(parameter.name,i);
    if(v===undefined&&parameter.start!==undefined){cursor=parameter.start;locals=new Map([...definition.scope??[],...specials]);try{v=value();}finally{locals=scope;}if(cursor!==parameter.end)unsupported(`${kind} default expression`);}
    if(v===undefined)v=new UndefinedValue();scope.set(parameter.name,v);
   }
   cursor=definition.start;const result=body();if(cursor!==definition.end)unsupported(`${kind} body`,at);return result;
  }finally{locals=outer;modules=outerModules;functions=outerFunctions;cursor=resume;}
 }
 function functionLiteral(extraStops:string[]):FunctionValue{
  expect('(');const parameters:Definition['parameters']=[];
  while(peek()!==')'){
   const name=take();if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name.text)||name.text==='$preview'||parameters.some(p=>p.name===name.text))unsupported('function literal parameter',name.at);
   const parameter:Definition['parameters'][number]={name:name.text};
   if(peek()==='='){take();parameter.start=cursor;skipValue();parameter.end=cursor;if(parameter.start===parameter.end)fail(t('Expected a complete dimensional expression'));}
   parameters.push(parameter);if(parameters.length>64)limited(t('OpenSCAD construction limit exceeded'));if(peek()!==',')break;take();
  }
  expect(')');const start=cursor;skipValue(extraStops);const end=cursor;if(start===end)fail(t('Expected a complete dimensional expression'));
  return new FunctionValue({scope:new Map(locals),moduleScope:modules,functionScope:functions,parameters,start,end});
 }
 function callFunction(literal?:Definition):Value{
  if(++functionDepth>32||++statements>4096)limited(t('OpenSCAD construction limit exceeded'));
  try{const token=take(),definition=literal??functions.get(token.text)!,args=argumentsFor(token.text,token.at);return invokeDefinition('function',definition,args,token.at,()=>{const result=value(),guard=assertionCondition([...definition.parameters.map(p=>localValue(p.name)!),...args.positional,...args.named.values()]);return guard?guardValue(guard,result):result;});}
  finally{functionDepth--;}
 }
 let loopSequence=0;
 const symbolNames=new Set(tokens.filter(token=>/^[A-Za-z_$]/.test(token.text)).map(token=>token.text));
 function controlLoop(depth:number,planar=false):string{
  expect('(');const outer=locals,scope=new Map(outer),bindings:{variable:string;generated:string;range?:string[];items:Value[]}[]=[];locals=scope;
  try{while(true){const variable=take();if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variable.text))unsupported('loop variable',variable.at);expect('=');let generated:string;do{generated=`cadLoop${loopSequence++}`;}while(symbolNames.has(generated));symbolNames.add(generated);let range:string[]|undefined,items:Value[]=[];
    if(peek()==='['){take();if(peek()!==']'){const first=value(0,[':']);if(peek()===':'){take();const second=value(0,[':']);let step='1',start=scalar(first),end=scalar(second);if(peek()===':'){take();step=scalar(second);end=scalar(value());}else{start=`min(${scalar(first)}, ${scalar(second)})`;end=`max(${scalar(first)}, ${scalar(second)})`;}range=[start,end,step];}else{items.push(first);while(peek()===','){take();if(peek()===']')break;items.push(value());if(items.length>64)limited(t('Loop exceeds 64 values'));}}}expect(']');}
    else{const list=value();if(!Array.isArray(list))unsupported('for requires a range or vector',variable.at);if(assertionCondition([list]))unsupported('asserted loop input',variable.at);items=list as Value[];}
    bindings.push({variable:variable.text,generated,range,items});scope.set(variable.text,generated);if(bindings.length>8)limited(t('OpenSCAD construction limit exceeded'));if(peek()!==',')break;take();
   }expect(')');const begin=cursor;let end:number|undefined;
   function expand(index:number):string{if(index===bindings.length){cursor=begin;const result=planar?profile(depth+1):peek()==='{'?block(depth+1):shape(depth+1);end=cursor;return result;}const binding=bindings[index];if(binding.range||binding.items.every(v=>typeof v==='string')){locals.set(binding.variable,binding.generated);const body=expand(index+1);return binding.range?`forRange${planar?'2d':''}(${binding.generated}, ${binding.range.join(', ')}, ${body})`:`forValues${planar?'2d':''}(${binding.generated}, [${binding.items.join(', ')}], ${body})`;}const parts:string[]=[];for(const item of binding.items){locals.set(binding.variable,item);parts.push(expand(index+1));}return planar?`union2d(${parts.join(', ')})`:union(parts);}
   const result=expand(0);if(end!==undefined)cursor=end;else{cursor=begin;skipStatement();}return result;
  }finally{locals=outer;}
 }
 if([...globalCache.values()].some(v=>v instanceof TextValue))warnings.add(t('String settings are resolved during conversion; retain the original source to change them.'));
 function skipStatement():void{
  if(!peek())return fail(t('Unexpected end of source'));
  if(['#','%','*','!'].includes(peek()!)){take();skipStatement();return;}
  if(peek()==='{'){take();let depth=1;while(depth){const n=take().text;if(n==='{')depth++;if(n==='}')depth--;}return;}
  const name=take().text;if(name===';')return;if(name==='module'||name==='function'){skipStatement();return;}
  if(peek()==='('){take();let depth=1;while(depth){const n=take().text;if(n==='(')depth++;if(n===')')depth--;}if(peek()===';'){take();return;}skipStatement();if(name==='if'&&peek()==='else'){take();skipStatement();}return;}
  while(peek()!==';')take();take();
 }
 function positiveShape(body:string,dimensions:string[],planar=false):string{const guard=assertionCondition(dimensions);if(guard)return `assert${planar?'2d':'Shape'}(${guard}, ${positiveShape(body,dimensions.map(v=>scalar(withoutAssertions(v))),planar)})`;if(dimensions.some(d=>d==='true'||d==='false'))fail(t('Expected a numeric OpenSCAD argument'));const empty=planar?'union2d()':'empty()';if(dimensions.some(d=>{const n=constant(d);return n!==undefined&&n<=0;}))return empty;const unknown=[...new Set(dimensions.filter(d=>constant(d)===undefined))];return unknown.length?`choose${planar?'2d':''}(${unknown.map(d=>`(${d}) <= 0`).join(' || ')}, ${empty}, ${body})`:body;}
 function specialSegments(named:Map<string,Value>,radius:string):string{
  const explicit=named.get('$fn')??localValue('$fn'),adaptive=named.has('$fa')||named.has('$fs')||localValue('$fa')!==undefined||localValue('$fs')!==undefined;
  const count=scalar(explicit,adaptive?'0':fn),known=constant(count);
  if(known!==undefined&&known>0)return String(Math.max(3,Math.floor(known)));
  const fa=scalar(named.get('$fa')??localValue('$fa'),'12'),fs=scalar(named.get('$fs')??localValue('$fs'),'2');
  return bounded(`(${count}) > 0 ? max(3, floor(${count})) : ceil(max(5, min(360/max(0.01, ${fa}), 2*3.141592653589793*abs(${radius})/max(0.01, ${fs}))))`);
 }
 function scopedOperator(name:string,depth:number,planar=false):string{expect('(');const outer=locals,scope=new Map(outer),values:Value[]=[];if(name==='let')locals=scope;try{while(peek()!==')'){const key=take().text;expect('=');const v=value();values.push(v);scope.set(key,v);if(peek()!==',')break;take();}expect(')');locals=scope;constructionGuard=assertionCondition(values);return planar?profile(depth+1):peek()==='{'?block(depth+1):shape(depth+1);}finally{locals=outer;}}
 interface ChildrenContext{start:number;end:number;scope:Map<string,ScopeValue>;parent?:ChildrenContext;planar:boolean}
 let childrenContext:ChildrenContext|undefined;
 function childCount(context:ChildrenContext):number{const resume=cursor;cursor=context.start;let count=0;try{if(peek()!=='{')return 1;take();while(peek()!=='}'){const declaration=peek(1)==='='||peek()==='module'||peek()==='function';skipStatement();if(!declaration)count++;}return count;}finally{cursor=resume;}}
 function invokeModule(name:string,args:ReturnType<typeof argumentsFor>,at:number,depth:number,planar=false):string{
  const parent=childrenContext,start=cursor,scope=new Map(locals);let context:ChildrenContext|undefined;
  if(peek()===';')take();else{skipStatement();context={start,end:cursor,scope,parent,planar};}
  const outer=childrenContext;childrenContext=context;
  try{return invokeDefinition('module',modules.get(name)!,args,at,()=>{locals.set('$children',String(context?childCount(context):0));const result=planar?profile(depth+1):peek()==='{'?block(depth+1):shape(depth+1),guard=assertionCondition([...modules.get(name)!.parameters.map(p=>localValue(p.name)!),...args.positional,...args.named.values()]);return guard?`assert${planar?'2d':'Shape'}(${guard}, ${result})`:result;});}finally{childrenContext=outer;}
 }
 function children(args:ReturnType<typeof argumentsFor>,at:number,depth:number,planar=false):string{
  args.allowed(['index'],1);const context=childrenContext;if(!context)return planar?'union2d()':'empty()';
  const resume=cursor,outer=locals,parent=childrenContext;let parts:string[]=[];
  try{cursor=context.start;locals=new Map(context.scope);childrenContext=context.parent;parts=peek()==='{'?blockParts(depth,false,planar):[planar?profile(depth+1):shape(depth+1)];}finally{cursor=resume;locals=outer;childrenContext=parent;}
  const index=args.use('index',0);if(index===undefined)return planar?`union2d(${parts.join(',')})`:union(parts);
  const indices=Array.isArray(index)?index:[index],selected=indices.map(v=>{const expression=scalar(v),n=constant(expression);if(n!==undefined)return Number.isInteger(n)&&n>=0&&n<parts.length?parts[n]:planar?'union2d()':'empty()';let result=planar?'union2d()':'empty()';for(let i=parts.length-1;i>=0;i--)result=`choose${planar?'2d':''}((${expression}) == ${i}, ${parts[i]}, ${result})`;return result;});return planar?`union2d(${selected.join(',')})`:union(selected);
 }
 function withSpecials<T>(named:Map<string,Value>,body:()=>T):T{const outer=locals;locals=new Map(outer);for(const [key,value] of named)if(key.startsWith('$'))locals.set(key,value);try{return body();}finally{locals=outer;}}
 function validateColor(value:Value|undefined,at:number,branch=false):void{chargeValues();const reason=cycle(value);if(reason)unsupported(reason,at);if(value instanceof ChoiceValue){validateColor(value.yes,at,true);validateColor(value.no,at,true);return;}if(branch&&value instanceof UndefinedValue)return;if(value instanceof TextValue){if(!/^(?:[A-Za-z]+|#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8})$/.test(value.text))unsupported('color string',at);return;}if(!Array.isArray(value)||![3,4].includes(value.length)||value.some(v=>{const n=constant(v);return n===undefined||n<0||n>1;}))unsupported('constant RGB or RGBA color',at);}
 let constructionGuard:string|undefined;
 function profile(depth=0):string{const outer=constructionGuard;constructionGuard=undefined;try{const result=profileBody(depth);return constructionGuard?`assert2d(${constructionGuard}, ${result})`:result;}finally{constructionGuard=outer;}}
 function profileBody(depth=0):string{
  if(depth>32)limited(t('OpenSCAD construction nesting exceeds 32'));if(++statements>4096)limited(t('OpenSCAD construction limit exceeded'));
  const combine=(parts:string[],kind='union2d')=>parts.length===1&&kind!=='hull2d'?parts[0]:`${kind}(${parts.join(', ')})`;
  if(peek()==='{')return combine(blockParts(depth,false,true));
  const token=take(),name=token.text;if(name==='assert'){const condition=assertion();const body=peek()===';'?(take(),'union2d()'):profile(depth+1);return `assert2d(${condition}, ${body})`;}if(name==='#'){warnings.add(t('Preview highlights are omitted; rendered geometry is retained.'));return profile(depth+1);}if(name==='%'||name==='*'){skipStatement();return 'union2d()';}if(name==='for')return controlLoop(depth,true);if(name==='let'||name==='assign')return scopedOperator(name,depth,true);if(name===';')return 'union2d()';if(name==='if'){expect('(');const condition=truth(value());expect(')');const known=constant(condition);let yes='union2d()',no='union2d()';if(known===0)skipStatement();else yes=profile(depth+1);if(peek()==='else'){take();if(known!==undefined&&known!==0)skipStatement();else no=profile(depth+1);}return known!==undefined?known?yes:no:`choose2d(${condition}, ${yes}, ${no})`;}if(name==='children'){const args=argumentsFor(name,token.at);constructionGuard=assertionCondition([...args.positional,...args.named.values()]);expect(';');return children(args,token.at,depth,true);}if(modules.has(name))return invokeModule(name,argumentsFor(name,token.at),token.at,depth,true);if(!['offset','minkowski','text','polygon','square','circle','union','difference','intersection','hull','translate','rotate','scale'].includes(name))unsupported(`extrusion profile: ${name}`,token.at);
  const {named,positional,use,allowed}=argumentsFor(name,token.at);constructionGuard=assertionCondition([...positional,...named.values()]);
  if(name==='offset'){allowed(['r','delta','chamfer','$fn','$fa','$fs'],1);const round=!named.has('delta'),distance=scalar(round?use('r',0,'1'):named.get('delta'));if(named.has('r')&&named.has('delta'))unsupported('offset radius and delta together',token.at);if(!round&&truth(named.get('chamfer')??'false')!=='false')unsupported('offset chamfer',token.at);return `offset2d(${distance}, ${round?1:0}, ${specialSegments(named,distance)}, ${withSpecials(named,()=>profile(depth+1))})`;}
  if(['union','difference','intersection','hull','minkowski'].includes(name)){allowed([],0);const parts:string[]=[];if(peek()==='{')parts.push(...blockParts(depth,false,true));else parts.push(profile(depth+1));return combine(parts,name==='difference'?'subtract2d':name==='intersection'?'intersect2d':name+'2d');}
  if(['translate','rotate','scale'].includes(name)){
   allowed([name==='rotate'?'a':'v'],1);const raw=use(name==='rotate'?'a':'v',0);let components:string[];
   if(name==='rotate'){if(typeof raw==='string')components=[raw];else if(Array.isArray(raw)&&raw.length===3&&raw.slice(0,2).every(v=>v==='0'))components=[scalar(raw[2])];else unsupported('profile rotation outside XY plane',token.at);}
   else if(typeof raw==='string'&&name==='scale')components=[raw,raw];else if(Array.isArray(raw)&&[2,3].includes(raw.length)&&raw.every(v=>typeof v==='string'))components=(raw as string[]).slice(0,2);else return fail(t('Expected a two-dimensional profile transform'),token.at);
   return `${name==='translate'?'move2d':name+'2d'}(${components!.join(', ')}, ${withSpecials(named,()=>profile(depth+1))})`;
  }
  expect(';');
  if(name==='text'){if(named.has('center'))warnings.add(t('Extra or unknown module/function arguments are ignored, as in OpenSCAD.'));allowed(['text','size','font','halign','valign','spacing','direction','language','script','$fn','center'],9);const content=use('text',0),requested=use('font',2,new TextValue('Liberation Sans'));const direction=use('direction',6,new TextValue('ltr'));if(!(direction instanceof TextValue)||direction.text!=='ltr')unsupported('text direction',token.at);warnings.add(t('Text uses bundled Droid fonts; source font metrics, styling and kerning can differ.'));const align=(key:string,fallback:string)=>{const v=use(key,key==='halign'?3:4,new TextValue(fallback));if(!(v instanceof TextValue))unsupported('text alignment',token.at);return JSON.stringify((v as TextValue).text);};const render=(text:Value|undefined,requested:Value|undefined):string=>{if(text instanceof ChoiceValue)return `choose2d(${text.condition}, ${render(text.yes,requested)}, ${render(text.no,requested)})`;if(requested instanceof ChoiceValue)return `choose2d(${requested.condition}, ${render(text,requested.yes)}, ${render(text,requested.no)})`;if(text instanceof UndefinedValue)return 'union2d()';if(!(text instanceof TextValue)||!(requested instanceof TextValue))return unsupported('text must resolve to a string',token.at);const font=requested.text.toLowerCase(),family=font.includes('mono')?'mono':font.includes('serif')?'serif':'sans';return `text2d(${JSON.stringify(text.text)}, ${scalar(use('size',1,'10'))}, ${JSON.stringify(family)}, ${align('halign','left')}, ${align('valign','baseline')}, ${scalar(use('spacing',5),'1')}, 8)`;};return render(content,requested);}
  if(name==='polygon'){allowed(['points','paths','convexity'],2);const points=use('points',0),paths=use('paths',1);const render=(points:Value|undefined,paths:Value|undefined):string=>{if(points instanceof ChoiceValue)return `choose2d(${points.condition}, ${render(points.yes,paths)}, ${render(points.no,paths)})`;if(paths instanceof ChoiceValue)return `choose2d(${paths.condition}, ${render(points,paths.yes)}, ${render(points,paths.no)})`;if(points instanceof UndefinedValue||Array.isArray(points)&&points.length<3){warnings.add(t('Undefined or empty polygon inputs contribute no geometry.'));return 'union2d()';}if(!Array.isArray(points)||!points.every(p=>Array.isArray(p)&&p.length===2))return fail(t('Expected an OpenSCAD polygon point list'),token.at);if(paths!==undefined&&!(paths instanceof UndefinedValue)&&(!Array.isArray(paths)||!paths.every(p=>Array.isArray(p))))unsupported('polygon paths',token.at);return `polygon2d([${points.map(row=>'['+(row as Value[]).map(v=>scalar(v)).join(',')+']').join(',')}]${Array.isArray(paths)?', ['+paths.map(row=>'['+(row as Value[]).map(v=>scalar(v)).join(',')+']').join(',')+']':''})`;};return render(points,paths);}
  if(name==='square'){allowed(['size','center'],2);const raw=use('size',0,'1'),size=typeof raw==='string'?[raw,raw]:raw;if(!Array.isArray(size)||size.length!==2||!size.every(v=>typeof v==='string'))fail(t('Expected an OpenSCAD square size'),token.at);return positiveShape(`rectangle2d(${(size as string[]).join(', ')}, ${scalar(use('center',1,'false'))})`,size as string[],true);}
  allowed(['r','d','center','$fn','$fa','$fs'],1);if(named.has('d')&&(named.has('r')||use('r',0)!==undefined))unsupported('circle: both radius and diameter',token.at);return `circle2d(${named.has('d')?'('+scalar(named.get('d'))+') / 2':scalar(use('r',0,'1'))}, ${specialSegments(named,named.has('d')?'('+scalar(named.get('d'))+') / 2':scalar(use('r',0,'1')))})`;
 }
 function shape(depth=0):string{const outer=constructionGuard;constructionGuard=undefined;try{const result=shapeBody(depth);return constructionGuard?`assertShape(${constructionGuard}, ${result})`:result;}finally{constructionGuard=outer;}}
 function shapeBody(depth=0):string{
  if(depth>32)limited(t('OpenSCAD construction nesting exceeds 32'));if(++statements>4096)limited(t('OpenSCAD construction limit exceeded'));if(peek()==='{')return block(depth,true);
  const token=take(),name=token.text;
  if(name==='assert'){const condition=assertion();const body=peek()===';'?(take(),'empty()'):shape(depth+1);return `assertShape(${condition}, ${body})`;}
  if(name==='%'||name==='*'){skipStatement();return 'empty()';}
  if(name==='#'){warnings.add(t('Preview highlights are omitted; rendered geometry is retained.'));return shape(depth+1);}
  if(name==='!'){rootSelectionUsed=true;const body=shape(depth+1);rootObjects.push(body);return body;}
  if(name==='let'||name==='assign')return scopedOperator(name,depth);
  if(name==='children'){const args=argumentsFor(name,token.at);constructionGuard=assertionCondition([...args.positional,...args.named.values()]);expect(';');return children(args,token.at,depth);}
  if(name==='echo'){expect('(');let nested=1;while(nested){const n=take().text;if(n==='assert')unsupported('assertion inside omitted echo');if(n==='(')nested++;if(n===')')nested--;}warnings.add(t('Echo console output is omitted from the converted model.'));if(peek()===';'){take();return 'empty()';}return shape(depth+1);}
  if(name==='for')return controlLoop(depth);
  if(name==='if'){expect('(');const condition=truth(value());expect(')');const known=constant(condition);let yes='empty()',no='empty()';if(known===0)skipStatement();else yes=peek()==='{'?block(depth+1):shape(depth+1);if(peek()==='else'){take();if(known!==undefined&&known!==0)skipStatement();else no=peek()==='{'?block(depth+1):shape(depth+1);}return known!==undefined?known?yes:no:`choose(${condition}, ${yes}, ${no})`;}
  if(name===';')return 'empty()';
  if(!modules.has(name)&&!['cube','sphere','cylinder','translate','rotate','scale','union','difference','intersection','hull','linear_extrude','rotate_extrude','color','render','mirror','resize','minkowski','polyhedron'].includes(name))unsupported(name,token.at);
  const {named,positional,use,allowed}=argumentsFor(name,token.at);
  if(modules.has(name))return invokeModule(name,{named,positional,use,allowed},token.at,depth);
  constructionGuard=assertionCondition([...positional,...named.values()]);
  if(name==='color'||name==='render'){allowed(name==='color'?['c','alpha']:['convexity'],name==='color'?2:1);if(name==='color'){validateColor(use('c',0),token.at);const alpha=use('alpha',1);if(alpha!==undefined){const n=constant(alpha);if(n===undefined||n<0||n>1)unsupported('constant color alpha',token.at);}warnings.add(t('Source colours and transparency are not retained; solid geometry is preserved.'));}return withSpecials(named,()=>peek()==='{'?block(depth+1):shape(depth+1));}
  const centerZ=(v:Value|undefined,height:string)=>v==='true'?'0':v===undefined||v==='false'?`(${height}) / 2`:`(${scalar(v)}) ? 0 : (${height}) / 2`;
  const segments=(radius='1')=>specialSegments(named,radius);
  if(['union','difference','intersection','hull','minkowski'].includes(name)){allowed([],0);const parts:string[]=[];if(peek()==='{')parts.push(...blockParts(depth));else parts.push(shape(depth+1));if(!parts.length)return 'empty()';if(parts.length===1&&name!=='hull')return parts[0];return `${name==='hull'||name==='minkowski'?name:name==='difference'?'subtract':name==='intersection'?'intersect':'union'}(${parts.join(', ')})`;}
  if(name==='resize'){allowed(['newsize','auto'],2);const size=vector(use('newsize',0)),auto=use('auto',1,'false');if(auto!=='false')unsupported('resize auto axes',token.at);return `resize([${size.join(', ')}], ${peek()==='{'?block(depth+1):shape(depth+1)})`;}
  if(['translate','rotate','scale','mirror'].includes(name)){allowed(name==='rotate'?['a','v']:['v'],name==='rotate'?2:1);const v=use(name==='rotate'?'a':'v',0,name==='mirror'?['1','0','0']:undefined);if(name==='rotate'&&typeof v==='string'&&use('v',1)!==undefined){const axis=vector(use('v',1));return `axisRotate([${axis.join(', ')}], ${v}, ${withSpecials(named,()=>peek()==='{'?block(depth+1):shape(depth+1))})`;}let vec=name==='translate'&&Array.isArray(v)&&v.length===2?[...v.map(x=>scalar(x)),'0']:name==='rotate'&&typeof v==='string'?['0','0',v]:vector(v,name==='scale');if(name==='translate'&&Array.isArray(v)&&v.length===2){xyTranslation=true;vec=[...v.map(x=>scalar(x)),'0'];}const child=withSpecials(named,()=>peek()==='{'?block(depth):shape(depth+1));return `${name==='translate'?'move':name}([${vec.join(', ')}], ${child})`;}

  if(name==='rotate_extrude'){allowed(['angle','convexity','$fn'],0);return `revolve(${withSpecials(named,()=>profile(depth+1))}, ${scalar(named.get('angle'),'360')}, ${segments()})`;}
  if(name==='linear_extrude'){allowed(['height','center','convexity','twist','slices','scale','$fn'],2);const height=scalar(use('height',0,'1')),twist=scalar(named.get('twist'),'0'),top=named.get('scale')??'1',scale=typeof top==='string'?[top,top]:top;if(!Array.isArray(scale)||scale.length!==2||!scale.every(v=>typeof v==='string'))unsupported('linear_extrude scale',token.at);const count=scalar(named.get('slices'),twist==='0'?'1':scalar(named.get('$fn')??localValue('$fn'),fn)),body=positiveShape(`extrudeProfile(${height}, ${withSpecials(named,()=>profile(depth+1))}, -(${twist}), ${count}, ${(scale as string[]).join(', ')})`,[height]);const flag=use('center',1);return flag===undefined||flag==='false'?body:`move([0, 0, (${scalar(flag)}) ? -(${height}) / 2 : 0], ${body})`;}
  expect(';');
  if(name==='polyhedron'){allowed(['points','faces','triangles','convexity'],2);const points=use('points',0),faces=use('faces',1)??named.get('triangles');if(!Array.isArray(points)||!Array.isArray(faces)||!points.every(v=>Array.isArray(v)&&v.length===3)||!faces.every(v=>Array.isArray(v)&&v.length>=3))unsupported('polyhedron points/faces',token.at);const rows=(v:Value[],reverse=false)=>'['+v.map(row=>'['+(reverse?[...(row as Value[])].reverse():row as Value[]).map(x=>scalar(x)).join(',')+']').join(',')+']';return `polyhedron(${rows(points as Value[])}, ${rows(faces as Value[],true)})`;}
  if(name==='cube'){allowed(['size','center'],2);const size=vector(use('size',0,'1'),true),body=positiveShape(`box(${size.join(', ')})`,size);const flag=use('center',1);return flag==='true'?body:`move([${size.map(v=>centerZ(flag,v)).join(', ')}], ${body})`;}
  if(name==='sphere'){allowed(['r','d','center','$fn','$fa','$fs'],1);if(named.has('d')&&(named.has('r')||positional.length))unsupported('sphere: both radius and diameter',token.at);const radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',0,'1'));return positiveShape(`sphere(${radius}, ${segments(radius)})`,[radius]);}
  if(['r1','r2','d1','d2'].some(key=>named.has(key))||positional.length>2){
   allowed(['h','r1','r2','d1','d2','center','$fn','$fa','$fs'],4);
   if(named.has('r1')&&named.has('d1')||named.has('r2')&&named.has('d2')||positional[1]!==undefined&&named.has('d1')||positional[2]!==undefined&&named.has('d2'))unsupported('cylinder: duplicate taper radius',token.at);
   const height=scalar(use('h',0,'1')),bottom=named.has('d1')?`(${scalar(named.get('d1'))}) / 2`:scalar(use('r1',1,'1')),top=named.has('d2')?`(${scalar(named.get('d2'))}) / 2`:scalar(use('r2',2,'1'));
   const body=positiveShape(`frustum(${bottom}, ${top}, ${height}, ${segments('max('+bottom+', '+top+')')})`,[height,'max('+bottom+', '+top+')']);return `move([0, 0, ${centerZ(use('center',3),height)}], ${body})`;
  }
  allowed(['h','r','d','center','$fn','$fa','$fs'],2);if(named.has('d')&&(named.has('r')||positional[1]!==undefined))unsupported('cylinder: both radius and diameter',token.at);const height=scalar(use('h',0,'1')),radius=named.has('d')?`(${scalar(named.get('d'))}) / 2`:scalar(use('r',1,'1')),body=positiveShape(`cylinder(${radius}, ${height}, ${segments(radius)})`,[radius,height]);return `move([0, 0, ${centerZ(named.get('center'),height)}], ${body})`;
 }
 let constructionAt=0;const shapes:string[]=[];while(cursor<tokens.length){const end=definitions.get(cursor)??globalDeclarations.get(cursor);if(end!==undefined){cursor=end;continue;}constructionAt=tokens[cursor]?.at??0;shapes.push(shape());}
 if(assertionsUsed&&rootSelectionUsed)unsupported('assertions combined with root modifier');
 if(!shapes.length)fail(t('OpenSCAD block contains no supported solid'));
 const program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:`// Converted from the supported OpenSCAD subset.\n// Curved and twisted surfaces use the native kernel tessellation.\n${fullRenderPreviewUsed?'// Full-render import context: $preview = false.\n':''}${xyTranslation?'// Two-component translations interpreted as [x,y,0].\n':''}${[...warnings].map(w=>'// Import warning: '+JSON.stringify(w)).join('\n')}\n${warnings.has(t('Source colours and transparency are not retained; solid geometry is preserved.'))?'// Appearance colors omitted; solid geometry retained.\n':''}${warnings.has(t('Preview highlights are omitted; rendered geometry is retained.'))?'// Preview highlights omitted; solid geometry retained.\n':''}${[...assignments].map(([name,v])=>`param ${name}: scalar = ${v};`).join('\n')}\nreturn ${union(rootObjects.length?rootObjects:shapes)};\n`};try{compileCode(program);}catch(error){if(error instanceof CadCodeError)throw new CadCodeError(t`Converted OpenSCAD construction: ${error.detail}`,constructionAt,source,error.code);throw error;}return program;
}

/** Conversion losses are retained in generated source and exposed to every host. */
export function getOpenSCADImportWarnings(program:CodeProgram):string[]{const messages:string[]=[];for(const line of program.source.split('\n'))if(line.startsWith('// Import warning: ')){try{const message=JSON.parse(line.slice(19));if(typeof message==='string')messages.push(message);}catch{}}return messages;}
