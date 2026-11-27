// SPDX-License-Identifier: BSD-3-Clause
// Assemblies (document version 50): named groups of top-level bodies (an imported STEP file's
// product structure, or groups made by hand), exploded views that move groups and bodies apart
// for display without changing the model, configurations (named parameter values and suppressed
// bodies, switched in one Undo step), and the kinematics a mechanism check sweeps a joint with.
//
// Original code. The ideas follow the kernel lab's guides (assembly-configurations, exploded-view,
// mechanism-validation), not their implementation.
import {t} from './i18n.js';
import type {CadDocument,Transform,Vec3} from './document.js';
import type {CadJoint} from './physics.js';
import {localToWorldPoint,rotatePoint} from './simulation.js';
import {evaluateParameters} from './parameters.js';

/** A named group of top-level bodies. Groups nest through `parent`; a body is in at most one group. */
export interface AssemblyGroup {
 id:string;
 name:string;
 /** Top-level body ids directly in this group, in order. */
 members:string[];
 /** The group this one sits in. */
 parent?:string;
 /** Where the group came from: a STEP file's product (with its occurrence name). */
 source?:{kind:'step';product?:string;instance?:string};
}
/** One move of an exploded view: a group (with everything in it) or bodies, along a direction. */
export interface ExplodeStep {
 id:string;
 group?:string;
 bodies?:string[];
 /** Unit direction in world coordinates. */
 direction:Vec3;
 /** Millimetres at full explosion. */
 distance:number;
}
/** Named exploded view. Steps run one after another as the explosion goes from 0 to 1. */
export interface ExplodedView {id:string;name:string;steps:ExplodeStep[]}
/** Named variant: parameter expressions and the bodies it leaves out. */
export interface AssemblyConfiguration {
 id:string;
 name:string;
 /** Parameter name → expression, for parameters of the design. */
 parameters:Record<string,string>;
 /** Top-level bodies the configuration leaves out. */
 suppressed:string[];
}
export interface AssemblyDesign {
 version:1;
 groups?:AssemblyGroup[];
 views?:ExplodedView[];
 configurations?:AssemblyConfiguration[];
 /** The configuration last switched to (it may have been edited since). */
 active?:string;
 /** Top-level bodies left out of the model now: not shown, built, exported, simulated or drawn. */
 suppressed?:string[];
}
export const ASSEMBLY_DOCUMENT_VERSION=50;
export const ASSEMBLY_LIMITS={groups:500,views:32,steps:500,configurations:64,parameters:256} as const;

const idOk=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
const text=(v:unknown,limit=160):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=limit&&!/[\u0000-\u001f]/.test(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown,limit=1e6):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;

/** Refuses an assembly block that is malformed or names bodies, groups or parameters that do not exist. */
export function checkAssembly(doc:CadDocument){
 const a=doc.assembly;if(a===undefined)return;
 const fail=(why:string):never=>{throw new Error(t`Invalid assembly: ${why}`);};
 if(doc.version<ASSEMBLY_DOCUMENT_VERSION)fail(t('assemblies require document version 50'));
 if(!record(a)||a.version!==1)fail(t('unknown assembly format'));
 const known=new Set(Object.keys(a));for(const key of known)if(!['version','groups','views','configurations','active','suppressed'].includes(key))fail(t`unknown field ${key}`);
 const roots=new Set(doc.roots);
 const bodyList=(list:unknown,what:string)=>{if(!Array.isArray(list)||list.length>2000||new Set(list).size!==list.length||!list.every(id=>typeof id==='string'&&roots.has(id)))fail(t`${what} must list existing top-level bodies once each`);return list as string[];};
 const groups=new Map<string,AssemblyGroup>();
 if(a.groups!==undefined){
  if(!Array.isArray(a.groups)||a.groups.length>ASSEMBLY_LIMITS.groups)fail(t('too many groups'));
  const owner=new Map<string,string>();
  for(const g of a.groups){
   if(!record(g)||!idOk(g.id)||groups.has(g.id)||!text(g.name))fail(t('bad group'));
   for(const key of Object.keys(g))if(!['id','name','members','parent','source'].includes(key))fail(t`unknown group field ${key}`);
   for(const id of bodyList(g.members,t('group members'))){if(owner.has(id))fail(t`a body is in two groups: ${id}`);owner.set(id,g.id);}
   if(g.source!==undefined&&(!record(g.source)||g.source.kind!=='step'||Object.keys(g.source).some(k=>!['kind','product','instance'].includes(k))||g.source.product!==undefined&&!text(g.source.product,1000)||g.source.instance!==undefined&&!text(g.source.instance,1000)))fail(t('bad group source'));
   groups.set(g.id,g);
  }
  for(const g of groups.values()){
   if(g.parent===undefined)continue;
   if(!groups.has(g.parent))fail(t('a group names a missing parent'));
   const seen=new Set<string>([g.id]);let at=g.parent as string|undefined;
   while(at!==undefined){if(seen.has(at))fail(t('groups form a cycle'));seen.add(at);at=groups.get(at)!.parent;if(seen.size>64)fail(t('groups nest too deep'));}
  }
 }
 if(a.views!==undefined){
  if(!Array.isArray(a.views)||a.views.length>ASSEMBLY_LIMITS.views)fail(t('too many exploded views'));
  const ids=new Set<string>();
  for(const v of a.views){
   if(!record(v)||!idOk(v.id)||ids.has(v.id)||!text(v.name)||!Array.isArray(v.steps)||v.steps.length>ASSEMBLY_LIMITS.steps)fail(t('bad exploded view'));ids.add(v.id);
   const stepIds=new Set<string>();
   for(const s of v.steps){
    if(!record(s)||!idOk(s.id)||stepIds.has(s.id)||!Array.isArray(s.direction)||s.direction.length!==3||!s.direction.every(x=>finite(x,1))||Math.abs(Math.hypot(...s.direction)-1)>1e-6||!finite(s.distance,100000))fail(t('bad explode step'));stepIds.add(s.id);
    if((s.group===undefined)===(s.bodies===undefined))fail(t('an explode step moves one group or a list of bodies'));
    if(s.group!==undefined&&!groups.has(s.group))fail(t('an explode step names a missing group'));
    if(s.bodies!==undefined)bodyList(s.bodies,t('explode step bodies'));
    for(const key of Object.keys(s))if(!['id','group','bodies','direction','distance'].includes(key))fail(t`unknown explode step field ${key}`);
   }
  }
 }
 const parameters=doc.parametric?.parameters??{};
 if(a.configurations!==undefined){
  if(!Array.isArray(a.configurations)||a.configurations.length>ASSEMBLY_LIMITS.configurations)fail(t('too many configurations'));
  const ids=new Set<string>(),names=new Set<string>();
  for(const c of a.configurations){
   if(!record(c)||!idOk(c.id)||ids.has(c.id)||!text(c.name)||names.has(c.name)||!record(c.parameters)||Object.keys(c.parameters).length>ASSEMBLY_LIMITS.parameters)fail(t('bad configuration'));ids.add(c.id);names.add(c.name);
   for(const [name,expression] of Object.entries(c.parameters))if(!Object.hasOwn(parameters,name)||!text(expression,512))fail(t`configuration ${c.name} sets an unknown parameter ${name}`);
   bodyList(c.suppressed,t('suppressed bodies'));
   for(const key of Object.keys(c))if(!['id','name','parameters','suppressed'].includes(key))fail(t`unknown configuration field ${key}`);
  }
 }
 if(a.active!==undefined&&!a.configurations?.some(c=>c.id===a.active))fail(t('the active configuration does not exist'));
 if(a.suppressed!==undefined)bodyList(a.suppressed,t('suppressed bodies'));
}

/** Drops references to bodies that are no longer top-level (deleted, combined), and groups and
 * steps that become empty. Returns a new block (the input may be frozen), or undefined when empty. */
export function prunedAssembly(doc:Pick<CadDocument,'roots'|'parametric'>&{assembly?:AssemblyDesign}):AssemblyDesign|undefined{
 const a=doc.assembly;if(!a)return undefined;
 const roots=new Set(doc.roots),params=doc.parametric?.parameters??{};
 const keep=(ids:readonly string[])=>ids.filter(id=>roots.has(id));
 let groups=(a.groups??[]).map(g=>({...g,members:keep(g.members)}));
 // A group with no bodies and no subgroups goes; repeat for parents emptied that way.
 for(;;){const parents=new Set(groups.flatMap(g=>g.parent?[g.parent]:[]));const next=groups.filter(g=>g.members.length||parents.has(g.id));if(next.length===groups.length)break;groups=next;}
 const ids=new Set(groups.map(g=>g.id));groups=groups.map(g=>g.parent&&!ids.has(g.parent)?(({parent:_p,...rest})=>rest)(g):g);
 const views=(a.views??[]).map(v=>({...v,steps:v.steps.flatMap(s=>s.group!==undefined?(ids.has(s.group)?[s]:[]):(()=>{const bodies=keep(s.bodies??[]);return bodies.length?[{...s,bodies}]:[];})())}));
 const configurations=(a.configurations??[]).map(c=>({...c,parameters:Object.fromEntries(Object.entries(c.parameters).filter(([name])=>Object.hasOwn(params,name))),suppressed:keep(c.suppressed)}));
 const suppressed=keep(a.suppressed??[]);
 const next:AssemblyDesign={version:1,...(groups.length?{groups}:{}),...(views.length?{views}:{}),...(configurations.length?{configurations}:{}),...(a.active&&configurations.some(c=>c.id===a.active)?{active:a.active}:{}),...(suppressed.length?{suppressed}:{})};
 return Object.keys(next).length>1?next:undefined;
}

/** Whether `a` and `b` hold the same assembly data (for cheap no-op detection). */
export const sameAssembly=(a:AssemblyDesign|undefined,b:AssemblyDesign|undefined)=>JSON.stringify(a??null)===JSON.stringify(b??null);

/** All bodies of a group, its subgroups included, in order. */
export function groupBodies(design:AssemblyDesign|undefined,groupId:string):string[]{
 const groups=design?.groups??[],out:string[]=[],seen=new Set<string>();
 const visit=(id:string)=>{if(seen.has(id))return;seen.add(id);const g=groups.find(x=>x.id===id);if(!g)return;out.push(...g.members);for(const child of groups)if(child.parent===id)visit(child.id);};
 visit(groupId);return out;
}
/** The group a body sits in directly, if any. */
export const groupOfBody=(design:AssemblyDesign|undefined,bodyId:string)=>design?.groups?.find(g=>g.members.includes(bodyId));
/** Top-level bodies left out now. */
export const suppressedBodies=(doc:CadDocument):ReadonlySet<string>=>new Set(doc.assembly?.suppressed??[]);
/** The bodies that are in the model now (top-level, not suppressed). */
export function activeRoots(doc:CadDocument):string[]{const off=suppressedBodies(doc);return off.size?doc.roots.filter(id=>!off.has(id)):doc.roots;}

/**
 * The document as the active configuration builds it: suppressed bodies, their joints, tracers and
 * the construction only they use are removed. Returns `doc` itself when nothing is suppressed.
 * For consumers that read `roots` directly (physics, exact export, drawings).
 */
export function configuredDocument(doc:CadDocument):CadDocument{
 const off=suppressedBodies(doc);if(!off.size)return doc;
 const next=structuredClone(doc) as CadDocument;
 next.roots=next.roots.filter(id=>!off.has(id));
 const keep=new Set<string>();const visit=(id:string)=>{if(keep.has(id))return;keep.add(id);const n=next.nodes[id];if(n?.kind==='boolean')n.inputs.forEach(visit);else if(n&&(n.kind==='mirror'||n.kind==='pattern'||n.kind==='exact-feature'))visit(n.source);};next.roots.forEach(visit);
 for(const id of Object.keys(next.nodes))if(!keep.has(id))delete next.nodes[id];
 if(next.joints)next.joints=next.joints.filter(j=>!off.has(j.bodyA)&&!off.has(j.bodyB)).map(j=>j.gearMesh&&!next.joints!.some(o=>o.id===j.gearMesh!.joint&&!off.has(o.bodyA)&&!off.has(o.bodyB))?(({gearMesh:_g,...rest})=>rest)(j):j);
 if(next.tracers)next.tracers=next.tracers.filter(trace=>!off.has(trace.bodyId));
 if(next.parametric)next.parametric={...next.parametric,bindings:next.parametric.bindings.filter(b=>keep.has(b.nodeId))};
 if(next.provenance)next.provenance={...next.provenance,records:next.provenance.records};
 delete next.drawings;
 if(next.assembly){const pruned=prunedAssembly(next);if(pruned){delete pruned.suppressed;next.assembly=pruned;}else delete next.assembly;}
 return next;
}

// --- Exploded views --------------------------------------------------------------------------

/** World offset of each moved body at `factor` (0 assembled … 1 fully exploded). Steps run in
 * order: with n steps, step i moves during factor i/n … (i+1)/n. A step on a group moves every
 * body in it and its subgroups; offsets of several steps add up. */
export function explodeOffsets(doc:Pick<CadDocument,'assembly'>,viewId:string,factor:number):Map<string,Vec3>{
 const view=doc.assembly?.views?.find(v=>v.id===viewId),out=new Map<string,Vec3>();
 if(!view||!view.steps.length)return out;
 const f=Math.min(1,Math.max(0,Number.isFinite(factor)?factor:0)),n=view.steps.length;
 view.steps.forEach((step,i)=>{
  const share=Math.min(1,Math.max(0,f*n-i));if(!share)return;
  const bodies=step.group!==undefined?groupBodies(doc.assembly,step.group):step.bodies??[];
  for(const id of bodies){const o=out.get(id)??[0,0,0];out.set(id,o.map((v,k)=>v+step.direction[k]*step.distance*share) as Vec3);}
 });
 return out;
}
export interface ExplodeBodyBounds {id:string;bounds:{min:readonly number[];max:readonly number[]}}
export interface AutoExplodeOptions {
 /** `axis` (default): items move along `axis`, stacked; `radial`: away from the centre. */
 mode?:'axis'|'radial';
 axis?:Vec3;
 /** Gap between neighbouring items in mm; default 1.2 × the largest item's extent along the axis. */
 spacing?:number;
 /** Explode the items inside this group (its subgroups and direct bodies); default: the top level. */
 group?:string;
 name?:string;
}
/** Plans an exploded view from body bounds: one step per item (a subgroup or an ungrouped body),
 * items ordered along the axis. A planning aid, not an assembly-path or collision check. */
export function planExplodedView(doc:CadDocument,bodies:readonly ExplodeBodyBounds[],options:AutoExplodeOptions={},newId:()=>string):ExplodedView{
 const mode=options.mode??'axis';
 const design=doc.assembly,groups=design?.groups??[],active=new Set(activeRoots(doc)),byId=new Map(bodies.map(b=>[b.id,b]));
 if(options.group!==undefined&&!groups.some(g=>g.id===options.group))throw new Error(t('Choose an existing group to explode'));
 const items:{group?:string;bodies?:string[];members:string[]}[]=[];
 const subgroups=groups.filter(g=>g.parent===options.group);
 for(const g of subgroups){const members=groupBodies(design,g.id).filter(id=>active.has(id));if(members.length)items.push({group:g.id,members});}
 const direct=options.group!==undefined?groups.find(g=>g.id===options.group)!.members:doc.roots.filter(id=>!groups.some(g=>g.members.includes(id)));
 for(const id of direct)if(active.has(id)&&!doc.nodes[id]?.reference)items.push({bodies:[id],members:[id]});
 const box=(ids:readonly string[])=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const id of ids){const b=byId.get(id);if(!b)continue;for(let k=0;k<3;k++){min[k]=Math.min(min[k],b.bounds.min[k]);max[k]=Math.max(max[k],b.bounds.max[k]);}}return {min,max,ok:min[0]<=max[0]};};
 const located=items.map(item=>({...item,box:box(item.members)})).filter(item=>item.box.ok);
 if(located.length<2)throw new Error(t('An exploded view needs at least two groups or bodies to move apart'));
 const axisRaw=options.axis??[0,0,1],length=Math.hypot(...axisRaw);if(!(length>1e-9))throw new Error(t('The explode axis must not be zero'));
 const axis=axisRaw.map(v=>v/length) as Vec3;
 const centre=(b:{min:number[];max:number[]})=>b.min.map((v,k)=>(v+b.max[k])/2) as Vec3;
 const extent=(b:{min:number[];max:number[]},d:Vec3)=>Math.abs((b.max[0]-b.min[0])*d[0])+Math.abs((b.max[1]-b.min[1])*d[1])+Math.abs((b.max[2]-b.min[2])*d[2]);
 const largest=Math.max(...located.map(item=>mode==='axis'?extent(item.box,axis):Math.max(...item.box.max.map((v,k)=>v-item.box.min[k]))));
 const spacing=options.spacing??Math.max(1,Math.round(1.2*largest*100)/100);
 if(!(spacing>0&&spacing<=100000))throw new Error(t('Explode spacing must be between 0 and 100000 mm'));
 const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
 const steps:ExplodeStep[]=[];
 if(mode==='axis'){
  const sorted=[...located].sort((a,b)=>dot(centre(a.box),axis)-dot(centre(b.box),axis));
  // The lowest item stays; each next one moves one gap further than the one below it.
  let travel=0;
  sorted.forEach((item,i)=>{if(i===0)return;travel+=spacing;steps.push({id:newId(),...(item.group?{group:item.group}:{bodies:item.bodies}),direction:axis,distance:Math.round(travel*1000)/1000});});
 }else{
  const all=box(located.flatMap(item=>item.members)),c=centre(all);
  for(const item of located){
   const d=centre(item.box).map((v,k)=>v-c[k]) as Vec3;
   const n=Math.hypot(...d);
   steps.push({id:newId(),...(item.group?{group:item.group}:{bodies:item.bodies}),direction:n>1e-9?d.map(v=>v/n) as Vec3:axis,distance:spacing});
  }
 }
 const names=new Set((design?.views??[]).map(v=>v.name));
 let name=options.name?.trim()||t('Exploded view');if(!options.name)for(let i=2;names.has(name);i++)name=`${t('Exploded view')} ${i}`;
 return {id:newId(),name,steps};
}

// --- Configurations ----------------------------------------------------------------------------

/** A configuration that captures the design as it is now: every parameter's expression and the
 * suppressed bodies. */
export function captureConfiguration(doc:CadDocument,name:string,id:string):AssemblyConfiguration{
 if(!text(name))throw new Error(t('Name the configuration (at most 160 characters)'));
 return {id,name:name.trim(),parameters:Object.fromEntries(Object.entries(doc.parametric?.parameters??{}).map(([key,p])=>[key,p.expression])),suppressed:[...(doc.assembly?.suppressed??[])]};
}
/** Writes a configuration's parameter expressions and suppression into a draft document (one
 * commit). Parameters the configuration does not name keep their values. */
export function applyConfiguration(d:CadDocument,config:AssemblyConfiguration){
 if(d.parametric&&Object.keys(config.parameters).length){
  const parameters={...d.parametric.parameters};
  for(const [name,expression] of Object.entries(config.parameters))if(parameters[name])parameters[name]={...parameters[name],expression};
  const design={...d.parametric,parameters};
  evaluateParameters(design);
  d.parametric=design;
 }
 const suppressed=config.suppressed.filter(id=>d.roots.includes(id));
 const next:AssemblyDesign={...(d.assembly??{version:1}),active:config.id};
 if(suppressed.length)next.suppressed=suppressed;else delete next.suppressed;
 d.assembly=next;
}

// --- Mechanism kinematics --------------------------------------------------------------------

/** A rigid motion as a row-major 3×4 matrix [r00 r01 r02 tx, r10 … , r20 … tz]. */
export type RigidMotion=readonly number[];
export const IDENTITY_MOTION:RigidMotion=Object.freeze([1,0,0,0,0,1,0,0,0,0,1,0]);
export function composeMotion(a:RigidMotion,b:RigidMotion):number[]{
 const out=new Array(12).fill(0);
 for(let r=0;r<3;r++){for(let c=0;c<3;c++)out[r*4+c]=a[r*4]*b[c]+a[r*4+1]*b[4+c]+a[r*4+2]*b[8+c];out[r*4+3]=a[r*4]*b[3]+a[r*4+1]*b[7]+a[r*4+2]*b[11]+a[r*4+3];}
 return out;
}
export function applyMotion(m:RigidMotion,p:readonly number[]):Vec3{return [m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]];}
/** Rotation by `angle` radians about the line through `point` along unit `axis`. */
export function rotationAbout(point:Vec3,axis:Vec3,angle:number):number[]{
 const [x,y,z]=axis,c=Math.cos(angle),s=Math.sin(angle),v=1-c;
 const r=[c+x*x*v,x*y*v-z*s,x*z*v+y*s,y*x*v+z*s,c+y*y*v,y*z*v-x*s,z*x*v-y*s,z*y*v+x*s,c+z*z*v];
 const t0=point[0]-(r[0]*point[0]+r[1]*point[1]+r[2]*point[2]),t1=point[1]-(r[3]*point[0]+r[4]*point[1]+r[5]*point[2]),t2=point[2]-(r[6]*point[0]+r[7]*point[1]+r[8]*point[2]);
 return [r[0],r[1],r[2],t0,r[3],r[4],r[5],t1,r[6],r[7],r[8],t2];
}
const translation=(d:Vec3,amount:number)=>[1,0,0,d[0]*amount,0,1,0,d[1]*amount,0,0,1,d[2]*amount];
/** A joint's frame in world coordinates (from body A's transform). */
export function jointWorldFrame(doc:CadDocument,joint:CadJoint):{anchor:Vec3;axis:Vec3}{
 const a:Transform=doc.nodes[joint.bodyA].transform;
 const anchor=localToWorldPoint(joint.anchorA,a),axis=rotatePoint(joint.axisA,a.rotation),n=Math.hypot(...axis);
 return {anchor,axis:axis.map(v=>v/n) as Vec3};
}
export interface MechanismPlan {
 joint:CadJoint;
 /** `deg` for a hinge, `mm` for a slider. */
 unit:'deg'|'mm';
 range:[number,number];
 /** Bodies the swept joint moves (body B's side). */
 moving:string[];
 /** Hinges turned through gear meshes, with their speed ratio to the swept joint and the bodies they turn. */
 coupled:{joint:CadJoint;ratio:number;moving:string[]}[];
}
/**
 * How a joint moves the assembly: the bodies on its body-B side (reached through the other joints,
 * except hinges driven by gear meshes, which turn their own body at their ratio). Refuses joints
 * that cannot be swept (fixed, pivot), closed loops and a slider without limits.
 */
export function planMechanism(doc:CadDocument,jointId:string,range?:[number,number]):MechanismPlan{
 const joints=doc.joints??[],joint=joints.find(j=>j.id===jointId);
 if(!joint)throw new Error(t`Unknown joint: ${jointId}`);
 if(joint.kind!=='hinge'&&joint.kind!=='slider')throw new Error(t('Only hinges and sliders can be swept; fixed joints and pivots have no single travel'));
 const off=suppressedBodies(doc);if(off.has(joint.bodyA)||off.has(joint.bodyB))throw new Error(t('The joint connects a suppressed body'));
 // Gear-coupled hinges, with their angle per unit angle of the swept joint.
 const ratios=new Map<string,number>([[joint.id,1]]),queue=[joint.id];
 if(joint.kind==='hinge')while(queue.length){const id=queue.shift()!,value=ratios.get(id)!,current=joints.find(j=>j.id===id)!;
  for(const other of joints){
   if(other.kind!=='hinge'||ratios.has(other.id))continue;
   // gearMesh on X: ω(X.gearMesh.joint) = ratio · ω(X).
   if(current.gearMesh?.joint===other.id){ratios.set(other.id,value*current.gearMesh.ratio);queue.push(other.id);}
   else if(other.gearMesh?.joint===current.id){ratios.set(other.id,value/other.gearMesh.ratio);queue.push(other.id);}
  }
 }
 const driven=new Set(ratios.keys());
 const side=(from:CadJoint)=>{
  const out=new Set<string>([from.bodyB]),stack=[from.bodyB];
  while(stack.length){const body=stack.pop()!;for(const j of joints){if(j.id===from.id||driven.has(j.id)&&j.id!==from.id)continue;if(off.has(j.bodyA)||off.has(j.bodyB))continue;
   const next=j.bodyA===body?j.bodyB:j.bodyB===body?j.bodyA:undefined;if(next===undefined||out.has(next))continue;
   if(next===from.bodyA)throw new Error(t`Joint ${from.id} closes a loop: its two sides are also joined elsewhere, so it cannot be swept alone`);
   out.add(next);stack.push(next);}}
  return [...out];
 };
 const unit=joint.kind==='hinge'?'deg':'mm';
 let span:[number,number];
 if(range)span=range;
 else if(joint.limits)span=joint.kind==='hinge'?[joint.limits[0]*180/Math.PI,joint.limits[1]*180/Math.PI]:[joint.limits[0],joint.limits[1]];
 else if(joint.kind==='hinge')span=[0,360];
 else throw new Error(t('This slider has no limits: give its travel, e.g. range -10 10'));
 if(!(span[0]<=span[1])||span.some(v=>!Number.isFinite(v)||Math.abs(v)>(unit==='deg'?3600:100000)))throw new Error(t('Bad sweep range'));
 return {joint,unit,range:span,moving:side(joint),coupled:[...ratios].filter(([id])=>id!==joint.id).map(([id,ratio])=>{const j=joints.find(x=>x.id===id)!;return {joint:j,ratio,moving:side(j)};})};
}
/** Each moved body's world motion with the swept joint at `value` (degrees or millimetres from
 * the modelled pose). Coupled gears turn first, then the swept joint carries its side. */
export function mechanismPose(doc:CadDocument,plan:MechanismPlan,value:number):Map<string,RigidMotion>{
 const out=new Map<string,RigidMotion>();
 for(const c of plan.coupled){const f=jointWorldFrame(doc,c.joint),m=rotationAbout(f.anchor,f.axis,value*c.ratio*Math.PI/180);for(const id of c.moving)out.set(id,composeMotion(m,out.get(id)??IDENTITY_MOTION));}
 const f=jointWorldFrame(doc,plan.joint),m=plan.unit==='deg'?rotationAbout(f.anchor,f.axis,value*Math.PI/180):translation(f.axis,value);
 for(const id of plan.moving)out.set(id,composeMotion(m,out.get(id)??IDENTITY_MOTION));
 return out;
}
/** Pairs of bodies a joint connects directly: they touch by design and are not collisions unless
 * the joint asks for connected collisions. */
export function jointedPairs(doc:CadDocument):Set<string>{
 const out=new Set<string>();for(const j of doc.joints??[])if(j.collideConnected!==true)out.add(pairKey(j.bodyA,j.bodyB));return out;
}
export const pairKey=(a:string,b:string)=>a<b?`${a}|${b}`:`${b}|${a}`;

/** What a mechanism check reports (computed in the geometry package with Manifold). */
export interface MechanismCollision {a:string;b:string;aName:string;bName:string;firstAt:number;lastAt:number;poses:number;maxVolumeMm3:number;atRest:boolean}
export interface MechanismReport {
 joint:string;jointName:string;unit:'deg'|'mm';range:[number,number];samples:number;
 moving:string[];coupled:{joint:string;ratio:number}[];
 collisions:MechanismCollision[];
 /** Pairs closer than the requested clearance (without overlap), at their closest sample. */
 near:{a:string;b:string;aName:string;bName:string;at:number;gapMm:number}[];
 /** Jointed pairs left out of the check. */
 skippedPairs:number;
 clear:boolean;
}
export interface MechanismSettings {joint:string;range?:[number,number];steps?:number;clearanceMm?:number;minVolumeMm3?:number}
export const MECHANISM_LIMITS={maxSteps:720,defaultSteps:36,maxBodies:64} as const;
export function sweepValues(range:[number,number],steps:number):number[]{
 const n=Math.max(1,Math.min(MECHANISM_LIMITS.maxSteps,Math.round(steps)));
 if(range[0]===range[1])return [range[0]];
 const values:number[]=[];for(let i=0;i<=n;i++)values.push(range[0]+(range[1]-range[0])*i/n);
 if(!values.some(v=>Math.abs(v)<1e-12)&&range[0]<0&&range[1]>0)values.push(0);
 return values.sort((a,b)=>a-b);
}
const unitText=(unit:'deg'|'mm',v:number)=>unit==='deg'?`${+v.toFixed(2)}°`:`${+v.toFixed(3)} mm`;
/** Terminal text for a mechanism report. */
export function formatMechanismReport(r:MechanismReport):string{
 const lines=[t`Mechanism check of ${r.jointName}: ${r.samples} poses from ${unitText(r.unit,r.range[0])} to ${unitText(r.unit,r.range[1])}; ${r.moving.length} moving bodies${r.coupled.length?t`, ${r.coupled.length} gears turned through meshes`:''}.`];
 if(r.clear)lines.push(t('No collisions at any sampled pose.'));
 for(const c of r.collisions)lines.push(t`Collision: ${c.aName} and ${c.bName}, ${c.atRest?t('already at rest, '):''}from ${unitText(r.unit,c.firstAt)} to ${unitText(r.unit,c.lastAt)} (${c.poses} poses), up to ${+c.maxVolumeMm3.toFixed(3)} mm³ overlap.`);
 for(const n of r.near)lines.push(t`Closer than the clearance: ${n.aName} and ${n.bName}, ${+n.gapMm.toFixed(3)} mm at ${unitText(r.unit,n.at)}.`);
 if(r.skippedPairs)lines.push(t`${r.skippedPairs} jointed pairs were not checked against each other.`);
 lines.push(t('Sampled poses only: clearance between samples is not proven.'));
 return lines.join('\n');
}

// --- STEP product structure ------------------------------------------------------------------

/** One level of a body's place in a STEP file's product structure (exact kernel 0.1.11). */
export interface StepImportOccurrence {product:string|null;instance:string|null}
/** Groups for imported STEP bodies, from each body's occurrence chain (top product first). Each
 * occurrence that holds more than one body, or other occurrences, becomes a group named after its
 * occurrence (else its product); a body alone in its occurrence joins the parent group and takes
 * the occurrence's name, so the three instances of one standoff are "standoff_0", "standoff_1" and
 * "standoff_2" rather than three of the same name. Returns the groups (parents first) and the
 * names to give the bodies, or no groups when the file has no assembly. */
export function stepImportGroups(occurrences:readonly (readonly StepImportOccurrence[]|null)[],names:readonly string[]):{groups:{name:string;members:number[];parent?:number;source:{kind:'step';product?:string;instance?:string}}[];names:string[]}{
 const renamed=[...names];
 if(!occurrences.length||occurrences.some(o=>!o?.length)||!occurrences.some(o=>o!.length>1))return {groups:[],names:renamed};
 interface Node {key:string;occurrence:StepImportOccurrence;children:Node[];bodies:number[];parent?:Node}
 const nodes=new Map<string,Node>(),roots:Node[]=[];
 occurrences.forEach((chain,body)=>{
  let parent:Node|undefined;
  chain!.forEach((occurrence,depth)=>{
   const key=JSON.stringify(chain!.slice(0,depth+1));
   let node=nodes.get(key);
   if(!node){node={key,occurrence,children:[],bodies:[],parent};nodes.set(key,node);(parent?parent.children:roots).push(node);}
   parent=node;
  });
  parent!.bodies.push(body);
 });
 const label=(o:StepImportOccurrence)=>(o.instance??o.product??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
 const groups:{name:string;members:number[];parent?:number;source:{kind:'step';product?:string;instance?:string}}[]=[];
 const visit=(node:Node,parent:number|undefined)=>{
  // A leaf occurrence with one body is that body, not a group (but never the top product).
  if(parent!==undefined&&!node.children.length&&node.bodies.length===1){
   groups[parent].members.push(node.bodies[0]);
   const name=label(node.occurrence);if(name)renamed[node.bodies[0]]=name;
   return;
  }
  const index=groups.length;
  groups.push({name:label(node.occurrence)||t('STEP assembly'),members:[...node.bodies],...(parent!==undefined?{parent}:{}),source:{kind:'step',...(node.occurrence.product?{product:node.occurrence.product.slice(0,1000)}:{}),...(node.occurrence.instance?{instance:node.occurrence.instance.slice(0,1000)}:{})}});
  for(const child of node.children)visit(child,index);
 };
 roots.forEach(root=>visit(root,undefined));
 return {groups,names:renamed};
}
