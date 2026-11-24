// SPDX-License-Identifier: BSD-3-Clause
import {pruneGearMeshes} from './physics.js';
// Block/pseudocode modelling programs. One JSON syntax tree, compiled to three
// parametric targets: native CAD Script (the retained definition), OpenSCAD and
// JSCAD. Scratch hosts and MCP build the tree; nothing here executes user code.
//
// Semantics are those of a structured block program: statements run in order,
// shape blocks add solids to their enclosing group, and C-blocks (move, rotate,
// group, subtract, ...) wrap the shapes they act on. Variables are single values
// that may be set and changed; the compiler turns them into named, pure formulas
// (SSA), so the result stays parametric instead of being a frozen snapshot.
import {t} from './i18n.js';
import type {CodeProgram} from './code.js';
import {identityTransform,newId,pruneDocument,type CadDocument} from './document.js';
import {uniqueObjectName} from './fragments.js';
import type {CadSession} from './session.js';

// ---------------------------------------------------------------------------
// Public syntax tree

export type BlockBinaryOp = '+'|'-'|'*'|'/'|'%'|'<'|'>'|'<='|'>='|'=='|'!='|'&&'|'||';
export type BlockMathFn = 'abs'|'floor'|'ceil'|'round'|'sqrt'|'sin'|'cos'|'tan'|'asin'|'acos'|'atan'|'ln'|'log'|'exp'|'pow10'|'min'|'max'|'pow'|'atan2';
export type BlockExpr =
 | {k:'num';v:number}
 | {k:'var';name:string}
 | {k:'op';op:BlockBinaryOp;a:BlockExpr;b:BlockExpr}
 | {k:'not';a:BlockExpr}
 | {k:'neg';a:BlockExpr}
 | {k:'fn';fn:BlockMathFn;args:BlockExpr[]}
 /** Compile-time random value: fixed by seed, so the model is reproducible. */
 | {k:'random';min:BlockExpr;max:BlockExpr;seed?:string};

export type BlockShapeKind = 'box'|'cylinder'|'cone'|'sphere'|'halfSphere'|'tube'|'torus'|'wedge'|'roof'|'roundRoof'|'pyramid'|'prism'|'star'|'heart'|'paraboloid'|'text';
export type BlockAxis = 'x'|'y'|'z';
type Body = BlockStmt[];
interface Located {id?:string}
export type BlockStmt = Located & (
 | {k:'set';name:string;value:BlockExpr}
 | {k:'change';name:string;by:BlockExpr}
 | {k:'shape';shape:BlockShapeKind;args?:Partial<Record<string,BlockExpr>>;text?:string}
 | {k:'move'|'rotate'|'scale';x:BlockExpr;y:BlockExpr;z:BlockExpr;body:Body}
 | {k:'mirror';axis:BlockAxis;body:Body}
 /** Paints the solids in its body (#rrggbb); the innermost colour wins, a group takes one colour. */
 | {k:'color';color:string;body:Body}
 | {k:'group'|'intersect'|'hull';body:Body}
 | {k:'subtract';body:Body;cutters:Body}
 /** Hole: cuts every solid of the enclosing group (or model), through moves, loops and ifs. */
 | {k:'hole';body:Body}
 | {k:'repeat';count:BlockExpr;body:Body}
 | {k:'for';var:string;from:BlockExpr;to:BlockExpr;step?:BlockExpr;body:Body}
 | {k:'if';cond:BlockExpr;then:Body;else?:Body}
 | {k:'comment';text:string});
export interface BlockParam {name:string;value:number;min?:number;max?:number;step?:number;id?:string}
export interface CadBlocksProgram {version:1;format:'brickwright-cad-blocks';name?:string;params:BlockParam[];body:Body}

/** Shape argument names and defaults (mm unless noted). Hosts derive block inputs from this table. */
export const BLOCK_SHAPES:Readonly<Record<BlockShapeKind,{args:readonly (readonly [string,number])[];integer?:readonly string[];text?:true}>>=Object.freeze({
 box:{args:[['width',20],['depth',20],['height',20]]},
 cylinder:{args:[['radius',10],['height',20],['sides',48]]},
 cone:{args:[['radius',10],['top',0],['height',20],['sides',48]]},
 sphere:{args:[['radius',10],['sides',48]]},
 halfSphere:{args:[['radius',10],['sides',48]]},
 tube:{args:[['radius',10],['wall',2],['height',20],['sides',48]]},
 torus:{args:[['radius',10],['thickness',3],['sides',48]]},
 wedge:{args:[['width',20],['depth',20],['height',20]]},
 roof:{args:[['width',20],['depth',20],['height',20]]},
 roundRoof:{args:[['width',20],['depth',20],['height',10]]},
 pyramid:{args:[['width',20],['height',20]]},
 prism:{args:[['radius',10],['sides',6],['height',20]],integer:['sides']},
 star:{args:[['points',5],['radius',10],['inner',5],['height',4]],integer:['points']},
 heart:{args:[['size',20],['height',4]]},
 paraboloid:{args:[['radius',10],['height',20],['sides',48]]},
 text:{args:[['size',10],['height',4]],text:true},
});
export const BLOCK_LIMITS=Object.freeze({nodes:4096,depth:32,params:64,textLength:64,starPoints:24,prismSides:64});

export class CadBlocksError extends Error {
 constructor(message:string,readonly blockId?:string,readonly code:string='invalid-blocks'){super(message);this.name='CadBlocksError';}
}

// ---------------------------------------------------------------------------
// Intermediate form: core shapes, explicit bindings, two scope kinds (program and loop)

type E =
 | {k:'num';v:number}
 | {k:'ref';name:string}
 | {k:'op';op:BlockBinaryOp;a:E;b:E}
 | {k:'not';a:E}
 | {k:'neg';a:E}
 | {k:'fn';fn:BlockMathFn;args:E[]}
 | {k:'cond';c:E;a:E;b:E};
type Pt = [E,E];
type Core =
 | {c:'cuboid';w:E;d:E;h:E}
 | {c:'frustum';r1:E;r2:E;h:E;n:E}
 | {c:'sphere';r:E;n:E}
 /** XY polygon extruded along Z, centred on Z. */
 | {c:'prism';h:E;pts:Pt[]}
 /** Profile in the XZ half-plane (x>=0) revolved once around Z. */
 | {c:'revolve';pts:Pt[];n:E}
 | {c:'text';text:string;size:E;h:E}
 | {c:'move'|'rotate'|'scale';v:[E,E,E];body:Core[]}
 | {c:'mirror';axis:0|1|2;body:Core[]}
 | {c:'color';color:string;body:Core[]}
 /** A group's result: one solid, so one colour (its own colour block's, else its first coloured member's). */
 | {c:'unit';body:Core[]}
 | {c:'union'|'intersect'|'hull';body:Core[]}
 | {c:'subtract';base:Core[];cut:Core[]}
 | {c:'hole';body:Core[]}
 | {c:'loop';v:string;from:E;to:E;step:E;scope:Scope}
 | {c:'if';cond:E;then:Core[];else:Core[]};
interface Binding {name:string;value:E;seq:number}
interface Scope {lets:Binding[];body:Core[]}
interface Compiled {params:(BlockParam&{ident:string})[];scope:Scope;name:string;root:Core[]}

const num=(v:number):E=>({k:'num',v});
const ref=(name:string):E=>({k:'ref',name});
const op=(o:BlockBinaryOp,a:E,b:E):E=>{
 if(a.k==='num'&&b.k==='num'){const v=fold(o,a.v,b.v);if(v!==undefined)return num(v);}
 if(o==='*'){if(a.k==='num'&&a.v===1)return b;if(b.k==='num'&&b.v===1)return a;}
 if((o==='+'||o==='-')&&b.k==='num'&&b.v===0)return a;
 if(o==='+'&&a.k==='num'&&a.v===0)return b;
 return {k:'op',op:o,a,b};
};
function fold(o:BlockBinaryOp,a:number,b:number):number|undefined{
 const v=o==='+'?a+b:o==='-'?a-b:o==='*'?a*b:o==='/'?(b===0?NaN:a/b):undefined;
 return v!==undefined&&Number.isFinite(v)?v:undefined;
}
const half=(e:E)=>op('/',e,num(2));
const neg=(e:E):E=>e.k==='num'?num(-e.v):{k:'neg',a:e};

// ---------------------------------------------------------------------------
// Names. Generated identifiers must be valid and collision-free in all three languages.

const RESERVED=new Set(`
param const let return scalar mm cm m in deg rad true false undef PI
box cylinder frustum sphere hull empty choose forRange forValues union subtract intersect move rotate scale repeat mirror axisRotate resize affine polyhedron minkowski extrude extrudeProfile revolve assertCode
rectangle2d circle2d polygon2d move2d rotate2d scale2d union2d subtract2d intersect2d hull2d text2d offset2d minkowski2d choose2d forRange2d forValues2d polygonGenerated2d spurGear2d internalSpurGear2d pointRange pointValues pointConcat pointChoose sumRange filterAt formatSCAD formatText
sin cos tan asin acos atan atan2 sqrt abs floor ceil round exp ln log pow min max norm cross len concat lookup str chr ord search version rands sign
cube sphere polygon square circle text translate color offset linear_extrude rotate_extrude projection surface import render children module function include use each assert echo for if else intersection_for difference intersection
break case catch class continue debugger default delete do export extends finally function import instanceof new null super switch this throw try typeof var void while with yield await enum implements interface package private protected public static of arguments eval undefined NaN Infinity Math require module exports main params
jscad primitives booleans transforms extrusions hulls geometries geom2 geom3 cuboid cylinderElliptic extrudeLinear extrudeRotate translate group range deg sscale poly roundAway
`.split(/\s+/).filter(Boolean));

function sanitize(raw:string):string{
 const map:Record<string,string>={ä:'ae',ö:'oe',ü:'ue',Ä:'Ae',Ö:'Oe',Ü:'Ue',ß:'ss'};
 let s=raw.normalize('NFC').replace(/[äöüÄÖÜß]/g,c=>map[c]).normalize('NFKD').replace(/[̀-ͯ]/g,'')
  .replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').replace(/__+/g,'_');
 if(!s)s='v';if(!/^[A-Za-z]/.test(s))s='v'+s;
 s=s.slice(0,32);if(RESERVED.has(s)||RESERVED.has(s.toLowerCase()))s+='_v';
 return s;
}
class Names {
 private used=new Set<string>();
 fresh(raw:string):string{const base=sanitize(raw);let name=base,i=2;while(this.used.has(name))name=`${base}_${i++}`;this.used.add(name);return name;}
}

// ---------------------------------------------------------------------------
// Validation (structure, limits) of untrusted JSON

const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const BINOPS=new Set<string>(['+','-','*','/','%','<','>','<=','>=','==','!=','&&','||']);
const FNS:Record<BlockMathFn,number>={abs:1,floor:1,ceil:1,round:1,sqrt:1,sin:1,cos:1,tan:1,asin:1,acos:1,atan:1,ln:1,log:1,exp:1,pow10:1,min:2,max:2,pow:2,atan2:2};
const STMT_KINDS=new Set(['set','change','shape','move','rotate','scale','mirror','color','group','intersect','hull','hole','subtract','repeat','for','if','comment']);

export function validateBlocksProgram(program:unknown):asserts program is CadBlocksProgram{
 let nodes=0;
 const fail=(message:string,id?:unknown):never=>{throw new CadBlocksError(message,typeof id==='string'?id:undefined);};
 const count=(id?:unknown)=>{if(++nodes>BLOCK_LIMITS.nodes)throw new CadBlocksError(t('The block program is too large'),typeof id==='string'?id:undefined,'resource-limit');};
 const name=(v:unknown,id?:unknown)=>{if(typeof v!=='string'||!v.trim()||v.length>64)fail(t('Variable names must be 1–64 characters'),id);};
 const expr=(e:unknown,depth:number,id?:unknown):void=>{
  count(id);if(depth>BLOCK_LIMITS.depth)fail(t('Blocks are nested too deeply'),id);
  if(!isObj(e))return fail(t('Missing value in a block'),id);
  switch(e.k){
   case 'num':if(typeof e.v!=='number'||!Number.isFinite(e.v))fail(t('Numbers must be finite'),id);return;
   case 'var':return name(e.name,id);
   case 'op':if(!BINOPS.has(e.op as string))fail(t('Unknown operator'),id);expr(e.a,depth+1,id);expr(e.b,depth+1,id);return;
   case 'not':case 'neg':return expr(e.a,depth+1,id);
   case 'fn':{const arity=FNS[e.fn as BlockMathFn];if(!arity||!Array.isArray(e.args)||e.args.length!==arity)fail(t('Unknown maths function'),id);(e.args as unknown[]).forEach(a=>expr(a,depth+1,id));return;}
   case 'random':expr(e.min,depth+1,id);expr(e.max,depth+1,id);if(e.seed!==undefined&&typeof e.seed!=='string')fail(t('Invalid random seed'),id);return;
   default:fail(t('Unknown value block'),id);
  }
 };
 const body=(b:unknown,depth:number):void=>{
  if(!Array.isArray(b))return fail(t('Missing block list'));
  if(depth>BLOCK_LIMITS.depth)fail(t('Blocks are nested too deeply'));
  for(const s of b){
   if(!isObj(s)||!STMT_KINDS.has(s.k as string))fail(t('Unknown block'),isObj(s)?s.id:undefined);
   const st=s as Record<string,unknown>,id=st.id;count(id);
   if(id!==undefined&&(typeof id!=='string'||id.length>128))fail(t('Invalid block id'));
   switch(st.k){
    case 'set':name(st.name,id);expr(st.value,depth+1,id);break;
    case 'change':name(st.name,id);expr(st.by,depth+1,id);break;
    case 'shape':{const spec=BLOCK_SHAPES[st.shape as BlockShapeKind];if(!spec||!Object.hasOwn(BLOCK_SHAPES,st.shape as string))fail(t('Unknown shape'),id);
     if(st.args!==undefined){if(!isObj(st.args))fail(t('Invalid shape inputs'),id);for(const [key,value] of Object.entries(st.args as object)){if(!spec.args.some(([n])=>n===key))fail(t`Unknown shape input ${key}`,id);if(value!==undefined)expr(value,depth+1,id);}}
     if(spec.text&&(typeof st.text!=='string'||!st.text.trim()||st.text.length>BLOCK_LIMITS.textLength))fail(t('Text must contain 1–64 characters'),id);break;}
    case 'move':case 'rotate':case 'scale':expr(st.x,depth+1,id);expr(st.y,depth+1,id);expr(st.z,depth+1,id);body(st.body,depth+1);break;
    case 'mirror':if(!['x','y','z'].includes(st.axis as string))fail(t('Mirror axis must be x, y or z'),id);body(st.body,depth+1);break;
    case 'color':if(typeof st.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(st.color))fail(t('Colours must be written #rrggbb'),id);body(st.body,depth+1);break;
    case 'group':case 'intersect':case 'hull':case 'hole':body(st.body,depth+1);break;
    case 'subtract':body(st.body,depth+1);body(st.cutters,depth+1);break;
    case 'repeat':expr(st.count,depth+1,id);body(st.body,depth+1);break;
    case 'for':name(st.var,id);expr(st.from,depth+1,id);expr(st.to,depth+1,id);if(st.step!==undefined)expr(st.step,depth+1,id);body(st.body,depth+1);break;
    case 'if':expr(st.cond,depth+1,id);body(st.then,depth+1);if(st.else!==undefined)body(st.else,depth+1);break;
    case 'comment':if(typeof st.text!=='string'||st.text.length>1024)fail(t('Invalid comment'),id);break;
   }
  }
 };
 if(!isObj(program)||program.version!==1||program.format!=='brickwright-cad-blocks')fail(t('Unsupported block program format'));
 const p=program as Record<string,unknown>;
 if(p.name!==undefined&&(typeof p.name!=='string'||p.name.length>128))fail(t('Invalid model name'));
 if(!Array.isArray(p.params)||p.params.length>BLOCK_LIMITS.params)fail(t('A block program can have at most 64 parameters'));
 const seen=new Set<string>();
 for(const param of p.params as unknown[]){
  if(!isObj(param))fail(t('Invalid parameter'));const q=param as Record<string,unknown>;name(q.name,q.id);
  if(seen.has(q.name as string))fail(t`Parameter ${q.name} is declared twice`,q.id);seen.add(q.name as string);
  for(const key of ['value','min','max','step'])if(q[key]!==undefined&&(typeof q[key]!=='number'||!Number.isFinite(q[key])))fail(t`Parameter ${q.name} needs finite numbers`,q.id);
  if(typeof q.value!=='number')fail(t`Parameter ${q.name} needs a value`,q.id);
 }
 body(p.body,0);
}

// ---------------------------------------------------------------------------
// Front end: variables to single-assignment bindings, loops to closed forms

type Slot = {name:string}|{poisoned:string};
type VarEffect = {kind:'delta';delta:BlockExpr[]}|{kind:'local'}|{kind:'unsupported';id?:string};

function hash01(seed:string):number{let h=0x811c9dc5;for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,0x01000193);}h^=h>>>15;h=Math.imul(h,0x2c1b3c6d);h^=h>>>12;return (h>>>0)/4294967296;}

/** Names a variable assigned anywhere in a statement list (used for loop analysis). */
function assigned(body:Body,out=new Set<string>()):Set<string>{
 for(const s of body){
  if(s.k==='set'||s.k==='change')out.add(s.name);
  if(s.k==='for')out.add(s.var);
  for(const child of children(s))assigned(child,out);
 }
 return out;
}
function children(s:BlockStmt):Body[]{
 switch(s.k){case 'move':case 'rotate':case 'scale':case 'mirror':case 'color':case 'group':case 'intersect':case 'hull':case 'hole':case 'repeat':case 'for':return [s.body];case 'subtract':return [s.body,s.cutters];case 'if':return [s.then,s.else??[]];default:return [];}
}
function reads(e:BlockExpr,out=new Set<string>()):Set<string>{
 if(e.k==='var')out.add(e.name);else if(e.k==='op'){reads(e.a,out);reads(e.b,out);}else if(e.k==='not'||e.k==='neg')reads(e.a,out);else if(e.k==='fn')e.args.forEach(a=>reads(a,out));else if(e.k==='random'){reads(e.min,out);reads(e.max,out);}
 return out;
}

/** Values a statement reads directly (not those of nested block lists). */
function stmtReads(s:BlockStmt):Set<string>{
 const out=new Set<string>(),add=(e?:BlockExpr)=>{if(e)reads(e,out);};
 switch(s.k){
  case 'set':add(s.value);break;case 'change':add(s.by);out.add(s.name);break;
  case 'shape':Object.values(s.args??{}).forEach(add);break;
  case 'move':case 'rotate':case 'scale':add(s.x);add(s.y);add(s.z);break;
  case 'repeat':add(s.count);break;case 'for':add(s.from);add(s.to);add(s.step);break;
  case 'if':add(s.cond);break;
 }
 return out;
}

/**
 * How each variable evolves over one loop iteration. Supported: unconditional
 * `change by` with loop-invariant amounts (an induction variable, also through
 * nested loops with invariant counts), or a value first `set` in the iteration
 * (iteration-local). Anything that would carry another kind of value from one
 * iteration to the next is refused instead of silently giving wrong geometry.
 */
function loopEffects(body:Body,invariantOk:(e:BlockExpr)=>boolean):Map<string,VarEffect>{
 const fx=new Map<string,VarEffect>(),readFirst=new Set<string>();
 const unsupported=(name:string,id?:string)=>fx.set(name,{kind:'unsupported',id});
 const walk=(list:Body,conditional:boolean):void=>{
  for(const s of list){
   for(const name of stmtReads(s))if(!fx.has(name))readFirst.add(name);
   if(s.k==='set'){
    const cur=fx.get(s.name);
    if(cur?.kind==='local')continue;
    if(cur||conditional||readFirst.has(s.name))unsupported(s.name,s.id);else fx.set(s.name,{kind:'local'});
   }else if(s.k==='change'){
    const cur=fx.get(s.name);
    if(cur?.kind==='local'||cur?.kind==='unsupported')continue;
    if(conditional||!invariantOk(s.by)){unsupported(s.name,s.id);continue;}
    fx.set(s.name,{kind:'delta',delta:[...(cur?.delta??[]),s.by]});
   }else if(s.k==='if'){walk(s.then,true);walk(s.else??[],true);}
   else if(s.k==='repeat'||s.k==='for'){
    const count=s.k==='repeat'?repeatCount(s.count):forCount(s);
    const inner=loopEffects(s.body,invariantOk);
    if(s.k==='for'&&!fx.has(s.var))fx.set(s.var,{kind:'local'});
    for(const [name,effect] of inner){
     const cur=fx.get(name);
     if(effect.kind==='unsupported')unsupported(name,effect.id??s.id);
     else if(cur?.kind==='local'||cur?.kind==='unsupported')continue;
     else if(effect.kind==='delta'&&!conditional&&invariantOk(count))
      fx.set(name,{kind:'delta',delta:[...(cur?.delta??[]),...effect.delta.map(d=>({k:'op' as const,op:'*' as const,a:count,b:d}))]});
     else if(effect.kind==='local'&&!cur&&!readFirst.has(name))fx.set(name,{kind:'local'});
     else unsupported(name,s.id);
    }
   }else for(const child of children(s))walk(child,conditional);
  }
 };
 walk(body,false);
 return fx;
}
const repeatCount=(count:BlockExpr):BlockExpr=>({k:'fn',fn:'max',args:[{k:'num',v:0},{k:'fn',fn:'round',args:[count]}]});
const forStep=(s:{step?:BlockExpr}):BlockExpr=>s.step??{k:'num',v:1};
/** Iterations of an inclusive directed range; matches forRange, OpenSCAD [a:s:b] and the JSCAD helper. */
const forCount=(s:{from:BlockExpr;to:BlockExpr;step?:BlockExpr}):BlockExpr=>({k:'fn',fn:'max',args:[{k:'num',v:0},
 {k:'op',op:'+',a:{k:'fn',fn:'floor',args:[{k:'op',op:'+',a:{k:'op',op:'/',a:{k:'op',op:'-',a:s.to,b:s.from},b:forStep(s)},b:{k:'num',v:1e-9}}]},b:{k:'num',v:1}}]});

class FrontEnd {
 private names=new Names();
 private env=new Map<string,Slot>();
 private scope:Scope={lets:[],body:[]};
 private paramIdents=new Map<string,string>();
 private randomKeys=new WeakMap<BlockExpr,string>();
 private randomCount=0;
 private activeCounters=new Set<string>();
 private seq=0;
 constructor(private program:CadBlocksProgram){}

 run():Compiled{
  const params=this.program.params.map(p=>{const ident=this.names.fresh(p.name);this.env.set(p.name,{name:ident});this.paramIdents.set(p.name,ident);return {...p,ident};});
  const root=this.body(this.program.body);
  this.scope.body=closeGroup(root);
  pruneBindings(this.scope);
  return {params,scope:this.scope,name:this.program.name??'Blocks model',root};
 }

 private let(raw:string,value:E):string{
  // Plain references and literals need no binding of their own, but readable names help; keep one per assignment.
  const name=this.names.fresh(raw);this.scope.lets.push({name,value,seq:this.seq++});return name;
 }
 private read(name:string,id?:string):E{
  const slot=this.env.get(name);
  if(!slot)throw new CadBlocksError(t`Variable ${name} is used before it is set. Set it first or make it a parameter.`,id,'undefined-variable');
  if('poisoned'in slot)throw new CadBlocksError(slot.poisoned,id,'loop-variable');
  return ref(slot.name);
 }
 expr(e:BlockExpr,id?:string):E{
  switch(e.k){
   case 'num':return num(e.v);
   case 'var':return this.read(e.name,id);
   case 'op':return op(e.op,this.expr(e.a,id),this.expr(e.b,id));
   case 'not':return {k:'not',a:this.expr(e.a,id)};
   case 'neg':return neg(this.expr(e.a,id));
   case 'fn':return {k:'fn',fn:e.fn,args:e.args.map(a=>this.expr(a,id))};
   case 'random':{
    const lo=this.expr(e.min,id),hi=this.expr(e.max,id);
    if(lo.k!=='num'||hi.k!=='num')throw new CadBlocksError(t('Random numbers need fixed limits so the model stays reproducible'),id,'random-limits');
    let key=e.seed;if(key===undefined){key=this.randomKeys.get(e);if(key===undefined){key=`#${this.randomCount++}`;this.randomKeys.set(e,key);}}
    const r=hash01(key),a=Math.min(lo.v,hi.v),b=Math.max(lo.v,hi.v);
    // Scratch semantics: whole-number limits give a whole number, otherwise a decimal.
    const value=Number.isInteger(a)&&Number.isInteger(b)?a+Math.floor(r*(b-a+1)):a+r*(b-a);
    return num(Number(value.toPrecision(12)));
   }
  }
 }
 private assign(name:string,value:E,id?:string){
  if(this.activeCounters.has(name))throw new CadBlocksError(t`The loop counter ${name} cannot be changed inside its loop`,id,'loop-variable');
  this.env.set(name,{name:this.let(name,value)});
 }

 body(list:Body):Core[]{
  const out:Core[]=[];
  for(const s of list){const core=this.stmt(s);if(core)out.push(...core);}
  return out;
 }
 private stmt(s:BlockStmt):Core[]|null{
  const x=(e:BlockExpr)=>this.expr(e,s.id);
  switch(s.k){
   case 'comment':return null;
   case 'set':this.assign(s.name,x(s.value),s.id);return null;
   case 'change':{const cur=this.read(s.name,s.id);this.assign(s.name,op('+',cur,x(s.by)),s.id);return null;}
   case 'shape':return [lowerShape(s,x)];
   case 'move':case 'rotate':case 'scale':{const v:[E,E,E]=[x(s.x),x(s.y),x(s.z)];return [{c:s.k,v,body:this.body(s.body)}];}
   case 'mirror':return [{c:'mirror',axis:s.axis==='x'?0:s.axis==='y'?1:2,body:this.body(s.body)}];
   case 'color':return [{c:'color',color:s.color.toLowerCase(),body:this.body(s.body)}];
   case 'group':return unit(closeGroup(this.body(s.body)));
   case 'hole':return [{c:'hole',body:closeGroup(this.body(s.body))}];
   case 'intersect':case 'hull':{const {solids,holes}=splitHoles(this.body(s.body)),node:Core={c:s.k,body:solids};return unit(holes.length?[{c:'subtract',base:[node],cut:holes}]:[node]);}
   case 'subtract':{const base=closeGroup(this.body(s.body));return unit([{c:'subtract',base,cut:closeGroup(this.body(s.cutters))}]);}
   case 'if':return [this.ifStmt(s)];
   case 'repeat':case 'for':return [this.loop(s)];
  }
 }
 private ifStmt(s:Extract<BlockStmt,{k:'if'}>):Core{
  const cond=this.expr(s.cond,s.id),before=new Map(this.env);
  const thenBody=this.body(s.then),afterThen=new Map(this.env);
  this.env=new Map(before);
  const elseBody=this.body(s.else??[]),afterElse=this.env;
  // Merge: a variable changed in either branch becomes `cond ? then : else`.
  const merged=new Map(before);
  for(const name of new Set([...afterThen.keys(),...afterElse.keys()])){
   const a=afterThen.get(name),b=afterElse.get(name);
   if(a===b||(a&&b&&'name'in a&&'name'in b&&a.name===b.name)){if(a)merged.set(name,a);continue;}
   if(!a||!b||'poisoned'in a||'poisoned'in b){merged.set(name,{poisoned:t`Variable ${name} is only set in one branch of an if. Set it before the if as well.`});continue;}
   merged.set(name,{name:this.names.fresh(name)});
   this.scope.lets.push({name:(merged.get(name) as {name:string}).name,value:{k:'cond',c:cond,a:ref(a.name),b:ref(b.name)},seq:this.seq++});
  }
  this.env=merged;
  return {c:'if',cond,then:thenBody,else:elseBody};
 }
 private loop(s:Extract<BlockStmt,{k:'repeat'|'for'}>):Core{
  const id=s.id,modified=assigned(s.body);
  const counterName=s.k==='for'?s.var:'';
  const invariantOk=(e:BlockExpr)=>[...reads(e)].every(n=>!modified.has(n)&&n!==counterName);
  const effects=loopEffects(s.body,invariantOk);
  if(counterName&&effects.has(counterName))throw new CadBlocksError(t`The loop counter ${counterName} cannot be changed inside its loop`,id,'loop-variable');
  for(const [name,effect] of effects)if(effect.kind==='unsupported'&&name!==counterName)
   throw new CadBlocksError(t`Variable ${name} changes inside this loop in a way that cannot become a formula (for example inside an if, or set after being changed). Use the loop counter to compute it instead.`,effect.id??id,'loop-variable');
  // Range in the enclosing scope.
  let from:E,to:E,step:E,countExpr:E;
  if(s.k==='repeat'){const n=this.expr(s.count,id);from=num(0);to=op('-',{k:'fn',fn:'round',args:[n]},num(1));step=num(1);countExpr={k:'fn',fn:'max',args:[num(0),{k:'fn',fn:'round',args:[n]}]};}
  else{from=this.expr(s.from,id);to=this.expr(s.to,id);step=this.expr(forStep(s),id);
   if(step.k==='num'&&step.v===0)throw new CadBlocksError(t('A loop step cannot be zero'),id,'loop-step');
   countExpr=this.expr(forCount(s),id);}
  const deltas=new Map<string,E>();
  for(const [name,effect] of effects)if(effect.kind==='delta'){
   const total=effect.delta.map(d=>this.expr(d,id)).reduce((a,b)=>op('+',a,b));
   deltas.set(name,total);
  }
  const entry=new Map(this.env);
  // Loop scope.
  const outerScope=this.scope;this.scope={lets:[],body:[]};
  const loopVar=this.names.fresh(s.k==='for'?s.var:'k');
  if(s.k==='for')this.env.set(s.var,{name:loopVar});
  if(deltas.size){
   const index=s.k==='repeat'?ref(loopVar):op('/',op('-',ref(loopVar),from),step);
   const k=s.k==='repeat'?loopVar:this.let('iteration',index);
   for(const [name,d] of deltas){const start=entry.get(name);if(!start||'poisoned'in start)throw new CadBlocksError(t`Variable ${name} is changed in a loop before it is set`,id,'undefined-variable');
    this.env.set(name,{name:this.let(name,op('+',ref(start.name),op('*',ref(k),d)))});}
  }
  const countedName=s.k==='for'?s.var:undefined;
  if(countedName)this.activeCounters.add(countedName);
  const body=this.body(s.body);
  if(countedName)this.activeCounters.delete(countedName);
  const scope=this.scope;scope.body=body;this.scope=outerScope;
  // After the loop: closed forms for induction variables, iteration-locals are out of reach.
  const after=new Map(entry);
  for(const [name,effect] of effects){
   if(effect.kind==='local')after.set(name,{poisoned:t`Variable ${name} was set inside a loop and cannot be read after it. Compute it after the loop instead.`});
  }
  for(const [name,d] of deltas){const start=entry.get(name) as {name:string};after.set(name,{name:this.let(name,op('+',ref(start.name),op('*',countExpr,d)))});}
  if(countedName)after.set(countedName,{poisoned:t`The loop counter ${countedName} can only be used inside its loop`});
  this.env=after;
  return {c:'loop',v:loopVar,from,to,step,scope};
 }
}

/**
 * Separates hole contents from solids. Holes pass through transforms, loops and
 * ifs (each gets a solid and a hole copy) and stop at group boundaries.
 */
function splitHoles(list:Core[]):{solids:Core[];holes:Core[]}{
 const solids:Core[]=[],holes:Core[]=[];
 for(const c of list){
  switch(c.c){
   case 'hole':holes.push(...c.body);break;
   case 'move':case 'rotate':case 'scale':{const part=splitHoles(c.body);if(part.solids.length)solids.push({...c,body:part.solids});if(part.holes.length)holes.push({...c,body:part.holes});break;}
   case 'mirror':case 'color':{const part=splitHoles(c.body);if(part.solids.length)solids.push({...c,body:part.solids});if(part.holes.length)holes.push({...c,body:part.holes});break;}
   case 'loop':{const part=splitHoles(c.scope.body);
    if(part.solids.length)solids.push({...c,scope:{lets:[...c.scope.lets],body:part.solids}});
    if(part.holes.length)holes.push({...c,scope:{lets:[...c.scope.lets],body:part.holes}});break;}
   case 'if':{const a=splitHoles(c.then),b=splitHoles(c.else);
    if(a.solids.length||b.solids.length)solids.push({...c,then:a.solids,else:b.solids});
    if(a.holes.length||b.holes.length)holes.push({...c,then:a.holes,else:b.holes});break;}
   default:solids.push(c);
  }
 }
 return {solids,holes};
}
const unit=(list:Core[]):Core[]=>list.length?[{c:'unit',body:list}]:[];
/** A group applies its holes to its own solids. */
function closeGroup(list:Core[]):Core[]{
 const {solids,holes}=splitHoles(list);
 if(!holes.length)return solids.length>1?[{c:'union',body:solids}]:solids;
 return [{c:'subtract',base:solids,cut:holes}];
}

/** Drops bindings no shape, range or condition needs (e.g. a counter's value after its last use). */
function pruneBindings(root:Scope){
 const all=new Map<string,Binding>(),scopes:Scope[]=[],needed=new Set<string>(),work:string[]=[];
 const use=(e:E)=>{switch(e.k){case 'ref':if(!needed.has(e.name)){needed.add(e.name);work.push(e.name);}break;case 'op':use(e.a);use(e.b);break;case 'not':case 'neg':use(e.a);break;case 'fn':e.args.forEach(use);break;case 'cond':use(e.c);use(e.a);use(e.b);break;}};
 const visit=(list:Core[])=>{for(const c of list){switch(c.c){
  case 'cuboid':use(c.w);use(c.d);use(c.h);break;case 'frustum':use(c.r1);use(c.r2);use(c.h);use(c.n);break;case 'sphere':use(c.r);use(c.n);break;
  case 'prism':use(c.h);c.pts.flat().forEach(use);break;case 'revolve':use(c.n);c.pts.flat().forEach(use);break;case 'text':use(c.size);use(c.h);break;
  case 'move':case 'rotate':case 'scale':c.v.forEach(use);visit(c.body);break;case 'mirror':case 'color':case 'unit':case 'union':case 'intersect':case 'hull':case 'hole':visit(c.body);break;
  case 'subtract':visit(c.base);visit(c.cut);break;case 'if':use(c.cond);visit(c.then);visit(c.else);break;
  case 'loop':use(c.from);use(c.to);use(c.step);collect(c.scope);break;}}};
 const collect=(scope:Scope)=>{scopes.push(scope);scope.lets.forEach(b=>all.set(b.name,b));visit(scope.body);};
 collect(root);
 while(work.length){const b=all.get(work.pop()!);if(b)use(b.value);}
 for(const scope of scopes)scope.lets=scope.lets.filter(b=>needed.has(b.name));
}

// ---------------------------------------------------------------------------
// Shape lowering: every block shape becomes a small set of core solids, centred on its bounding box

const scalePts=(pts:[number,number][],sx:E,sy:E):Pt[]=>pts.map(([px,py])=>[op('*',num(r12(px)),sx),op('*',num(r12(py)),sy)]);
const r12=(v:number)=>{const r=Number(v.toFixed(12));return Object.is(r,-0)?0:r;};
const HEART:[number,number][]=(()=>{
 const raw:[number,number][]=[];for(let i=0;i<32;i++){const a=i/32*2*Math.PI;raw.push([16*Math.sin(a)**3,13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a)]);}
 const xs=raw.map(p=>p[0]),ys=raw.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),cy=(Math.max(...ys)+Math.min(...ys))/2,size=Math.max(w,h);
 return raw.map(([x,y])=>[x/size,(y-cy)/size] as [number,number]).reverse();
})();

function lowerShape(s:Extract<BlockStmt,{k:'shape'}>,x:(e:BlockExpr)=>E):Core{
 const spec=BLOCK_SHAPES[s.shape];
 const a:Record<string,E>={};
 for(const [name,def] of spec.args){const v=s.args?.[name];a[name]=v?x(v):num(def);}
 const integer=(name:string,min:number,max:number)=>{const v=a[name];if(v.k!=='num'||!Number.isInteger(v.v)||v.v<min||v.v>max)throw new CadBlocksError(t`${name} must be a whole number from ${min} to ${max}`,s.id,'shape-input');return v.v;};
 const sideways=(pts:Pt[],depth:E):Core=>({c:'rotate',v:[num(90),num(0),num(0)],body:[{c:'prism',h:depth,pts}]});
 switch(s.shape){
  case 'box':return {c:'cuboid',w:a.width,d:a.depth,h:a.height};
  case 'cylinder':return {c:'frustum',r1:a.radius,r2:a.radius,h:a.height,n:a.sides};
  case 'cone':return {c:'frustum',r1:a.radius,r2:a.top,h:a.height,n:a.sides};
  case 'sphere':return {c:'sphere',r:a.radius,n:a.sides};
  case 'prism':return {c:'frustum',r1:a.radius,r2:a.radius,h:a.height,n:num(integer('sides',3,BLOCK_LIMITS.prismSides))};
  case 'pyramid':{const r=op('*',a.width,num(r12(Math.SQRT1_2)));return {c:'rotate',v:[num(0),num(0),num(45)],body:[{c:'frustum',r1:r,r2:num(0),h:a.height,n:num(4)}]};}
  case 'halfSphere':{
   // Keep the upper half: a clipping box whose base lies exactly on the equator.
   const r=a.radius,span=op('*',r,num(2.02)),clip=op('*',r,num(1.02));
   return {c:'move',v:[num(0),num(0),neg(half(r))],body:[{c:'intersect',body:[{c:'sphere',r,n:a.sides},{c:'move',v:[num(0),num(0),half(clip)],body:[{c:'cuboid',w:span,d:span,h:clip}]}]}]};
  }
  case 'tube':return {c:'subtract',base:[{c:'frustum',r1:a.radius,r2:a.radius,h:a.height,n:a.sides}],cut:[{c:'frustum',r1:op('-',a.radius,a.wall),r2:op('-',a.radius,a.wall),h:op('+',a.height,num(2)),n:a.sides}]};
  case 'torus':{const pts:Pt[]=[];for(let i=0;i<24;i++){const ang=i/24*2*Math.PI;pts.push([op('+',a.radius,op('*',a.thickness,num(r12(Math.cos(ang))))),op('*',a.thickness,num(r12(Math.sin(ang))))]);}return {c:'revolve',pts,n:a.sides};}
  case 'paraboloid':{const pts:Pt[]=[[num(0),neg(half(a.height))]];for(let i=0;i<=12;i++){const tt=i/12;pts.push([op('*',a.radius,num(r12(Math.sqrt(1-tt)))),op('*',a.height,num(r12(tt-.5)))]);}return {c:'revolve',pts,n:a.sides};}
  case 'wedge':return sideways(scalePts([[-.5,-.5],[.5,-.5],[-.5,.5]],a.width,a.height),a.depth);
  case 'roof':return sideways(scalePts([[-.5,-.5],[.5,-.5],[0,.5]],a.width,a.height),a.depth);
  case 'roundRoof':{const raw:[number,number][]=[];for(let i=0;i<=24;i++){const ang=i/24*Math.PI;raw.push([.5*Math.cos(ang),Math.sin(ang)-.5]);}return sideways(scalePts(raw,a.width,a.height),a.depth);}
  case 'star':{const n=integer('points',3,BLOCK_LIMITS.starPoints),pts:Pt[]=[];for(let i=0;i<2*n;i++){const ang=Math.PI/2+i*Math.PI/n,r=i%2?a.inner:a.radius;pts.push([op('*',r,num(r12(Math.cos(ang)))),op('*',r,num(r12(Math.sin(ang))))]);}return {c:'prism',h:a.height,pts};}
  case 'heart':return {c:'prism',h:a.height,pts:scalePts(HEART,a.size,a.size)};
  case 'text':return {c:'text',text:s.text!.trim(),size:a.size,h:a.height};
 }
}

// ---------------------------------------------------------------------------
// Expression printing. Precedence-aware; each target maps functions itself.

const PREC:Record<BlockBinaryOp,number>={'||':1,'&&':2,'==':3,'!=':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
type Dialect = 'cad'|'scad'|'js';
function fmt(v:number):string{const s=String(r12(v));return s;}
function printExpr(e:E,d:Dialect,parent=0,right=false):string{
 const wrap=(prec:number,s:string)=>prec<parent||(right&&prec===parent)?`(${s})`:s;
 switch(e.k){
  case 'num':return e.v<0?wrap(7,fmt(e.v)):fmt(e.v);
  case 'ref':return e.name;
  case 'neg':return wrap(7,`-${printExpr(e.a,d,7)}`);
  case 'not':return wrap(7,`!${printExpr(e.a,d,7)}`);
  case 'cond':return wrap(0.5,`${printExpr(e.c,d,1)} ? ${printExpr(e.a,d,1)} : ${printExpr(e.b,d,0.5)}`);
  case 'op':{
   const p=PREC[e.op];let o:string=e.op;if(d==='js'&&(o==='=='||o==='!='))o+='=';
   return wrap(p,`${printExpr(e.a,d,p)} ${o} ${printExpr(e.b,d,p,true)}`);
  }
  case 'fn':{
   const args=e.args.map(a=>printExpr(a,d));
   if(e.fn==='pow10')return d==='js'?`Math.pow(10, ${args[0]})`:`pow(10, ${args[0]})`;
   if(d!=='js')return `${e.fn}(${args.join(', ')})`;
   const js:Record<string,string>={sin:'sinDeg',cos:'cosDeg',tan:'tanDeg',asin:'asinDeg',acos:'acosDeg',atan:'atanDeg',atan2:'atan2Deg',ln:'Math.log',log:'Math.log10',round:'roundAway'};
   return `${js[e.fn]??`Math.${e.fn}`}(${args.join(', ')})`;
  }
 }
}

// ---------------------------------------------------------------------------
// CAD Script generator (the retained, editable definition)

function cadShapes(list:Core[],pad:string):string{
 if(!list.length)return 'empty()';
 if(list.length===1)return cadShape(list[0],pad);
 return `union(\n${list.map(s=>pad+'  '+cadShape(s,pad+'  ')).join(',\n')})`;
}
function cadShape(s:Core,pad:string):string{
 const e=(x:E)=>printExpr(x,'cad'),v=(xs:E[])=>`[${xs.map(e).join(', ')}]`,inner=pad+'  ';
 const pts=(p:Pt[])=>`polygon2d([${p.map(([px,py])=>`[${e(px)}, ${e(py)}]`).join(', ')}])`;
 const list=(xs:Core[])=>xs.map(c=>inner+cadShape(c,inner)).join(',\n');
 switch(s.c){
  case 'cuboid':return `box(${e(s.w)}, ${e(s.d)}, ${e(s.h)})`;
  case 'frustum':return s.r1===s.r2?`cylinder(${e(s.r1)}, ${e(s.h)}, ${e(s.n)})`:`frustum(${e(s.r1)}, ${e(s.r2)}, ${e(s.h)}, ${e(s.n)})`;
  case 'sphere':return `sphere(${e(s.r)}, ${e(s.n)})`;
  case 'prism':return `move([0, 0, ${e(neg(half(s.h)))}], extrudeProfile(${e(s.h)}, ${pts(s.pts)}))`;
  case 'revolve':return `revolve(${pts(s.pts)}, 360, ${e(s.n)})`;
  case 'text':return `move([0, 0, ${e(neg(half(s.h)))}], extrudeProfile(${e(s.h)}, text2d(${JSON.stringify(s.text)}, ${e(s.size)}, "sans", "center", "center", 1, 8)))`;
  case 'move':case 'rotate':case 'scale':return `${s.c}(${v(s.v)}, ${cadShapes(s.body,pad)})`;
  case 'mirror':return `mirror(${v([0,1,2].map(i=>num(i===s.axis?1:0)))}, ${cadShapes(s.body,pad)})`;
  // CAD Script has no colours: a code object has one, so colours become parts (colorParts).
  case 'union':case 'unit':case 'color':return cadShapes(s.body,pad);
  case 'intersect':case 'hull':return s.body.length===0?'empty()':s.body.length===1&&s.c==='intersect'?cadShape(s.body[0],pad):`${s.c}(\n${list(s.body)})`;
  case 'subtract':return s.cut.length===0?cadShapes(s.base,pad):`subtract(\n${inner}${cadShapes(s.base,inner)},\n${list(s.cut)})`;
  case 'if':return `choose(${e(s.cond)},\n${inner}${cadShapes(s.then,inner)},\n${inner}${cadShapes(s.else,inner)})`;
  case 'hole':throw new Error('internal: unresolved hole');
  case 'loop':return `forRange(${s.v}, ${e(s.from)}, ${e(s.to)}, ${e(s.step)},\n${inner}${cadShapes(s.scope.body,inner)})`;
 }
}
function collectLets(scope:Scope,out:Binding[]=[]):Binding[]{
 out.push(...scope.lets);
 const visit=(list:Core[])=>{for(const c of list){if(c.c==='loop')collectLets(c.scope,out);else if('body'in c)visit(c.body);else if(c.c==='subtract'){visit(c.base);visit(c.cut);}else if(c.c==='if'){visit(c.then);visit(c.else);}}};
 visit(scope.body);
 const seen=new Set<string>();
 return out.sort((a,b)=>a.seq-b.seq).filter(b=>!seen.has(b.name)&&!!seen.add(b.name));
}
const comment=(text:string)=>text.replace(/[\r\n]+/g,' ').slice(0,200);

/** One code object of a model: all of its solids of one colour (no colour: the host's default). */
export interface CompiledBlocksPart {color?:string;program:CodeProgram;source:string}
export interface CompiledBlocks {program:CodeProgram;source:string;
 /** One part per colour, in order of first use; a single part (the whole model) when it uses at most one colour. */
 parts:CompiledBlocksPart[]}
function cadSource(c:Compiled):{program:CodeProgram;source:string}{
 const lines=[`// ${comment(c.name)} — generated from blocks by Brickwright CAD. Units: mm, degrees.`,`// Edit the blocks to change this definition; parameters stay editable here.`];
 for(const p of c.params)lines.push(`param ${p.ident}: scalar = ${fmt(p.value)};${p.ident!==p.name?` // ${comment(p.name)}`:''}`);
 for(const b of collectLets(c.scope))lines.push(`const ${b.name} = ${printExpr(b.value,'cad')};`);
 lines.push(`return ${cadShapes(c.scope.body,'')};`);
 const source=lines.join('\n')+'\n';
 return {source,program:{version:1,language:'brickwright-cad-script',source,parameters:{}}};
}
/** Native CAD Script. Block variables become lazy `const` formulas, block parameters become `param`s. */
export function compileBlocksToCadScript(program:CadBlocksProgram):CompiledBlocks{
 const c=compile(program),whole=cadSource(c);
 return {...whole,parts:colorParts(c).map(({color,compiled})=>({...(color?{color}:{}),...(compiled===c?whole:cadSource(compiled))}))};
}

// ---------------------------------------------------------------------------
// Colours. A code object has one colour, so a model painted in several becomes one
// object per colour. Exact, because holes cut every solid of their level whatever its
// colour ((A ∪ B) − H = (A − H) ∪ (B − H)) and a group is one solid of one colour.

const NO_COLOR='';
/** The first colour painted inside (holes and cutters do not count). */
function firstColor(list:Core[]):string|undefined{
 for(const c of list){
  if(c.c==='color')return c.color;
  if(c.c==='hole')continue;
  const inner=c.c==='subtract'?c.base:c.c==='loop'?c.scope.body:c.c==='if'?[...c.then,...c.else]:'body' in c?c.body:[];
  const found=firstColor(inner);if(found!==undefined)return found;
 }
 return undefined;
}
const atomic=(c:Core)=>c.c==='unit'||c.c==='union'||c.c==='intersect'||c.c==='hull'||c.c==='subtract';
function colorsOf(list:Core[],inherited:string|undefined,out:Set<string>):void{
 for(const c of list){
  switch(c.c){
   case 'color':colorsOf(c.body,c.color,out);break;
   case 'hole':break;
   case 'move':case 'rotate':case 'scale':case 'mirror':colorsOf(c.body,inherited,out);break;
   case 'loop':colorsOf(c.scope.body,inherited,out);break;
   case 'if':colorsOf(c.then,inherited,out);colorsOf(c.else,inherited,out);break;
   default:out.add(inherited??(atomic(c)?firstColor([c]):undefined)??NO_COLOR);
  }
 }
}
/** The model's solids of one colour, with every hole kept (holes are colourless). */
function onlyColor(list:Core[],keep:string,inherited:string|undefined):Core[]{
 const out:Core[]=[];
 for(const c of list){
  switch(c.c){
   case 'color':{const body=onlyColor(c.body,keep,c.color);if(body.length)out.push({...c,body});break;}
   case 'hole':out.push(c);break;
   case 'move':case 'rotate':case 'scale':case 'mirror':{const body=onlyColor(c.body,keep,inherited);if(body.length)out.push({...c,body});break;}
   case 'loop':{const body=onlyColor(c.scope.body,keep,inherited);if(body.length)out.push({...c,scope:{lets:[...c.scope.lets],body}});break;}
   case 'if':{const a=onlyColor(c.then,keep,inherited),b=onlyColor(c.else,keep,inherited);if(a.length||b.length)out.push({...c,then:a,else:b});break;}
   default:if((inherited??(atomic(c)?firstColor([c]):undefined)??NO_COLOR)===keep)out.push(c);
  }
 }
 return out;
}
function colorParts(c:Compiled):{color?:string;compiled:Compiled}[]{
 const colors=new Set<string>();colorsOf(c.root,undefined,colors);
 if(colors.size<=1){const only=[...colors][0];return [{...(only?{color:only}:{}),compiled:c}];}
 return [...colors].map(color=>{
  const scope:Scope={lets:[...c.scope.lets],body:closeGroup(onlyColor(c.root,color,undefined))};
  pruneBindings(scope);
  return {...(color?{color}:{}),compiled:{...c,scope}};
 });
}

/** Parameter overrides set in the editor that the new source still declares. */
function keptOverrides(overrides:Record<string,string>|undefined,source:string):Record<string,string>{
 return Object.fromEntries(Object.entries(overrides??{}).filter(([name])=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)&&new RegExp(`(^|\\n)param ${name}:`).test(source)));
}
export interface BlocksModelResult {status:'built'|'updated'|'unchanged';ids:string[]}
/**
 * Puts a compiled block model into a session as one undo step: one code object per
 * colour part, found again by name on the next build (`name`, then `name (#rrggbb)` for
 * further colours). Parameter overrides the new source still declares are kept, and
 * colour parts the model no longer has are removed.
 */
export function applyBlocksModel(session:CadSession,name:string,compiled:CompiledBlocks):BlocksModelResult{
 const label=(part:CompiledBlocksPart,i:number)=>i===0?name:`${name} (${part.color??'default'})`;
 const isPart=(n:string)=>n===name||n.startsWith(`${name} (`)&&n.endsWith(')');
 const before=session.state.document;
 const found=before.roots.map(id=>before.nodes[id]).filter(n=>n.kind==='code'&&isPart(n.name));
 const ids:string[]=[];
 const revision=session.state.revision;
 session.editAssembly(found.length?'Update block model':'Add block model',(d:CadDocument)=>{
  d.version=Math.max(d.version,4) as CadDocument['version'];
  const byName=new Map(d.roots.map(id=>d.nodes[id]).filter(n=>n.kind==='code'&&isPart(n.name)).map(n=>[n.name,n]));
  const wanted=new Set<string>();
  compiled.parts.forEach((part,i)=>{
   const partName=label(part,i);wanted.add(partName);
   const existing=byName.get(partName);
   if(existing&&existing.kind==='code'){
    if(existing.program.source!==part.program.source){
     const next={...existing,program:{...structuredClone(part.program),parameters:keptOverrides(existing.program.parameters,part.program.source)}};
     if(next.physics){next.physics={...next.physics};delete next.physics.collisionAssembly;}
     d.nodes[existing.id]=next;
    }
    if(part.color&&existing.color!==part.color)d.nodes[existing.id]={...d.nodes[existing.id],color:part.color};
    ids.push(existing.id);
   }else{
    const id=newId();
    d.nodes[id]={id,kind:'code',program:structuredClone(part.program),name:uniqueObjectName(partName,new Set(d.roots.map(key=>d.nodes[key].name))),color:part.color??'#76b7ce',transform:identityTransform()};
    d.roots.push(id);ids.push(id);
   }
  });
  const stale=[...byName.values()].filter(n=>!wanted.has(n.name)).map(n=>n.id);
  if(stale.length){d.roots=d.roots.filter(id=>!stale.includes(id));if(d.joints)d.joints=pruneGearMeshes(d.joints.filter(j=>d.roots.includes(j.bodyA)&&d.roots.includes(j.bodyB)));pruneDocument(d);}
 });
 return {status:session.state.revision===revision?'unchanged':found.length?'updated':'built',ids};
}

// ---------------------------------------------------------------------------
// OpenSCAD generator (parametric, Customizer-ready)

function scadList(list:Core[],pad:string):string[]{return list.flatMap(s=>scadShape(s,pad));}
function scadBlock(head:string,list:Core[],pad:string,lets:Binding[]=[]):string[]{
 const inner=pad+'  ';
 return [`${pad}${head} {`,...lets.map(b=>`${inner}${b.name} = ${printExpr(b.value,'scad')};`),...scadList(list,inner),`${pad}}`];
}
function scadShape(s:Core,pad:string):string[]{
 const e=(x:E)=>printExpr(x,'scad'),v=(xs:E[])=>`[${xs.map(e).join(', ')}]`;
 const pts=(p:Pt[])=>`polygon([${p.map(([px,py])=>`[${e(px)}, ${e(py)}]`).join(', ')}]);`;
 switch(s.c){
  case 'cuboid':return [`${pad}cube([${e(s.w)}, ${e(s.d)}, ${e(s.h)}], center = true);`];
  case 'frustum':return [s.r1===s.r2?`${pad}cylinder(h = ${e(s.h)}, r = ${e(s.r1)}, center = true, $fn = ${e(s.n)});`:`${pad}cylinder(h = ${e(s.h)}, r1 = ${e(s.r1)}, r2 = ${e(s.r2)}, center = true, $fn = ${e(s.n)});`];
  case 'sphere':return [`${pad}sphere(r = ${e(s.r)}, $fn = ${e(s.n)});`];
  case 'prism':return [`${pad}linear_extrude(height = ${e(s.h)}, center = true)`,`${pad}  ${pts(s.pts)}`];
  case 'revolve':return [`${pad}rotate_extrude($fn = ${e(s.n)})`,`${pad}  ${pts(s.pts)}`];
  case 'text':return [`${pad}linear_extrude(height = ${e(s.h)}, center = true)`,`${pad}  text(${JSON.stringify(s.text)}, size = ${e(s.size)}, halign = "center", valign = "center");`];
  case 'move':return scadBlock(`translate(${v(s.v)})`,s.body,pad);
  case 'rotate':case 'scale':return scadBlock(`${s.c}(${v(s.v)})`,s.body,pad);
  case 'mirror':return scadBlock(`mirror(${v([0,1,2].map(i=>num(i===s.axis?1:0)))})`,s.body,pad);
  case 'union':return scadBlock('union()',s.body,pad);
  case 'unit':return scadList(s.body,pad);
  case 'color':return scadBlock(`color(${JSON.stringify(s.color)})`,s.body,pad);
  case 'intersect':return s.body.length?scadBlock('intersection()',s.body,pad):[];
  case 'hull':return s.body.length?scadBlock('hull()',s.body,pad):[];
  case 'subtract':{
   if(!s.cut.length)return scadBlock('union()',s.base,pad);
   const base=s.base.length===1?scadShape(s.base[0],pad+'  '):scadBlock('union()',s.base,pad+'  ');
   return [`${pad}difference() {`,...base,...scadList(s.cut,pad+'  '),`${pad}}`];
  }
  case 'if':return [...scadBlock(`if (${e(s.cond)})`,s.then,pad),...(s.else.length?scadBlock('else',s.else,pad):[])];
  case 'hole':throw new Error('internal: unresolved hole');
  case 'loop':return scadBlock(`for (${s.v} = [${e(s.from)} : ${e(s.step)} : ${e(s.to)}])`,s.scope.body,pad,s.scope.lets);
 }
}
export function exportBlocksOpenSCAD(program:CadBlocksProgram):string{
 const c=compile(program),lines=[`// ${comment(c.name)} — generated from blocks by Brickwright CAD.`,'// Units: mm, degrees. Shapes are centred on their own origin.',''];
 if(c.params.length){lines.push('/* [Parameters] */');for(const p of c.params){const range=p.min!==undefined&&p.max!==undefined?` // [${fmt(p.min)}:${p.step!==undefined?fmt(p.step)+':':''}${fmt(p.max)}]`:'';lines.push(`${p.ident} = ${fmt(p.value)};${range}${p.ident!==p.name&&!range?` // ${comment(p.name)}`:''}`);}lines.push('','/* [Hidden] */');}
 for(const b of c.scope.lets)lines.push(`${b.name} = ${printExpr(b.value,'scad')};`);
 if(c.scope.lets.length)lines.push('');
 lines.push(...scadList(c.scope.body,''));
 return lines.join('\n')+'\n';
}

// ---------------------------------------------------------------------------
// JSCAD generator (parametric: getParameterDefinitions + main(params))

function jsList(list:Core[],pad:string):string{
 if(!list.length)return 'group([])';
 if(list.length===1)return jsShape(list[0],pad);
 const inner=pad+'  ';return `group([\n${list.map(s=>inner+jsShape(s,inner)).join(',\n')},\n${pad}])`;
}
function jsShape(s:Core,pad:string):string{
 const e=(x:E)=>printExpr(x,'js'),v=(xs:E[])=>`[${xs.map(e).join(', ')}]`,inner=pad+'  ';
 const pts=(p:Pt[])=>`poly([${p.map(([px,py])=>`[${e(px)}, ${e(py)}]`).join(', ')}])`;
 switch(s.c){
  case 'cuboid':return `cuboid({size: [${e(s.w)}, ${e(s.d)}, ${e(s.h)}]})`;
  case 'frustum':return s.r1===s.r2?`cylinder({radius: ${e(s.r1)}, height: ${e(s.h)}, segments: ${e(s.n)}})`:`cone(${e(s.r1)}, ${e(s.r2)}, ${e(s.h)}, ${e(s.n)})`;
  case 'sphere':return `sphere({radius: ${e(s.r)}, segments: ${e(s.n)}})`;
  case 'prism':return `translate([0, 0, ${e(neg(half(s.h)))}], extrudeLinear({height: ${e(s.h)}}, ${pts(s.pts)}))`;
  case 'revolve':return `extrudeRotate({segments: ${e(s.n)}}, ${pts(s.pts)})`;
  // JSCAD's own single-stroke font, stroked to the engine font's cap height and weight.
  case 'text':return `textShape(${JSON.stringify(s.text)}, ${e(s.size)}, ${e(s.h)})`;
  case 'move':return `translate(${v(s.v)}, ${jsList(s.body,pad)})`;
  case 'rotate':return `rotate(${v(s.v.map(x=>op('*',x,num(Math.PI/180))))}, ${jsList(s.body,pad)})`;
  case 'scale':return `sscale(${v(s.v)}, ${jsList(s.body,pad)})`;
  case 'mirror':return `mirror({normal: ${v([0,1,2].map(i=>num(i===s.axis?1:0)))}}, ${jsList(s.body,pad)})`;
  case 'union':case 'unit':return jsList(s.body,pad);
  case 'color':return `colorize(${JSON.stringify([1,3,5].map(i=>r12(parseInt(s.color.slice(i,i+2),16)/255)))}, ${jsList(s.body,pad)})`;
  case 'intersect':return s.body.length<2?jsList(s.body,pad):`intersect(\n${s.body.map(c=>inner+jsShape(c,inner)).join(',\n')})`;
  case 'hull':return s.body.length?`hull(\n${s.body.map(c=>inner+jsShape(c,inner)).join(',\n')})`:'group([])';
  case 'subtract':return s.cut.length?`subtract(${jsList(s.base,pad)},\n${s.cut.map(c=>inner+jsShape(c,inner)).join(',\n')})`:jsList(s.base,pad);
  case 'if':return `(${e(s.cond)}\n${inner}? ${jsList(s.then,inner)}\n${inner}: ${jsList(s.else,inner)})`;
  case 'hole':throw new Error('internal: unresolved hole');
  case 'loop':{
   const body=s.scope.lets.length?`{\n${s.scope.lets.map(b=>`${inner}const ${b.name} = ${e(b.value)};`).join('\n')}\n${inner}return ${jsList(s.scope.body,inner)};\n${pad}}`:jsList(s.scope.body,inner);
   return `group(range(${e(s.from)}, ${e(s.to)}, ${e(s.step)}).map((${s.v}) => ${body}))`;
  }
 }
}
const JSCAD_PRELUDE=`const {primitives, booleans, transforms, extrusions, hulls, geometries, colors, text, expansions, measurements} = require('@jscad/modeling');
const {cuboid, cylinder, cylinderElliptic, sphere, polygon} = primitives;
const {union, subtract, intersect} = booleans;
const {translate, rotate, scale, mirror} = transforms;
const {extrudeLinear, extrudeRotate} = extrusions;
const {hull} = hulls;
const {colorize} = colors;

// Helpers: degree trigonometry, inclusive loops and empty-safe groups, like the blocks.
const sinDeg = (d) => Math.sin(d * Math.PI / 180);
const cosDeg = (d) => Math.cos(d * Math.PI / 180);
const tanDeg = (d) => Math.tan(d * Math.PI / 180);
const asinDeg = (v) => Math.asin(v) * 180 / Math.PI;
const acosDeg = (v) => Math.acos(v) * 180 / Math.PI;
const atanDeg = (v) => Math.atan(v) * 180 / Math.PI;
const atan2Deg = (y, x) => Math.atan2(y, x) * 180 / Math.PI;
const roundAway = (v) => Math.sign(v) * Math.round(Math.abs(v));
const range = (from, to, step) => {
  const count = Math.max(0, Math.floor((to - from) / step + 1e-9) + 1);
  return Array.from({length: count}, (_, i) => from + i * step);
};
const group = (shapes) => shapes.length === 0 ? geometries.geom3.create() : shapes.length === 1 ? shapes[0] : union(shapes);
const cone = (bottom, top, height, segments) => cylinderElliptic({height, segments,
  startRadius: [bottom, bottom], endRadius: [Math.max(top, 1e-6), Math.max(top, 1e-6)]});
const poly = (points) => {
  const area = points.reduce((sum, p, i) => sum + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0);
  return polygon({points: area < 0 ? [...points].reverse() : points});
};
// Text: JSCAD's built-in single-stroke font, stroked into outlines (cap height = size).
const textShape = (message, size, height) => {
  const delta = size * 0.06;
  const strokes = text.vectorText({height: (size - 2 * delta) / 1.5, align: 'center'}, message)
    .filter((points) => points.length > 1)
    .map((points) => expansions.expand({delta, corners: 'round', segments: 8}, geometries.path2.fromPoints({}, points)));
  if (!strokes.length) return geometries.geom3.create();
  const outline = union(strokes);
  const [[x0, y0], [x1, y1]] = measurements.measureBoundingBox(outline);
  return translate([-(x0 + x1) / 2, -(y0 + y1) / 2, -height / 2], extrudeLinear({height}, outline));
};
const sscale = (factors, shape) => factors.reduce((result, f, axis) => f < 0
  ? mirror({normal: [0, 1, 2].map((i) => (i === axis ? 1 : 0))}, result) : result, scale(factors.map(Math.abs), shape));
`;
export function exportBlocksJSCAD(program:CadBlocksProgram):string{
 const c=compile(program);
 const defs=c.params.map(p=>`  {name: ${JSON.stringify(p.ident)}, type: ${p.min!==undefined&&p.max!==undefined?"'slider'":"'number'"}, initial: ${fmt(p.value)}${p.min!==undefined?`, min: ${fmt(p.min)}`:''}${p.max!==undefined?`, max: ${fmt(p.max)}`:''}${p.step!==undefined?`, step: ${fmt(p.step)}`:''}, caption: ${JSON.stringify(p.name)}},`);
 const lines=[`// ${comment(c.name)} — generated from blocks by Brickwright CAD.`,'// Units: mm. Block angles are degrees; the helpers convert them.',JSCAD_PRELUDE,
  'const getParameterDefinitions = () => [',...defs,'];','',
  'const main = (params = {}) => {',
  ...c.params.map(p=>`  const ${p.ident} = params.${p.ident} ?? ${fmt(p.value)};`),
  ...c.scope.lets.map(b=>`  const ${b.name} = ${printExpr(b.value,'js')};`),
  `  return ${jsList(c.scope.body,'  ')};`,'};','','module.exports = {main, getParameterDefinitions};'];
 return lines.join('\n')+'\n';
}

function compile(program:CadBlocksProgram):Compiled{validateBlocksProgram(program);return new FrontEnd(program).run();}
