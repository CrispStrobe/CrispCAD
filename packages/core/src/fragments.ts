// SPDX-License-Identifier: BSD-3-Clause
import {validateDocument} from './document.js';
import type {CadDocument} from './document.js';
import {evaluateExpression,evaluateParameters} from './parameters.js';

export function uniqueObjectName(base:string,used:ReadonlySet<string>,limit=160):string {
  const stem=base.slice(0,limit-8);if(!used.has(base)&&base.length<=limit)return base;
  for(let index=2;index<10000;index++){const name=`${stem} ${index}`;if(!used.has(name))return name;}
  throw new Error('Too many objects with the same name');
}
export function offsetPositionExpression(expression:string,design:NonNullable<CadDocument['parametric']>,offset:number){const values=evaluateParameters(design),q=evaluateExpression(expression,name=>values[name]);return `(${expression})${q.length===0&&q.angle===0?' * 1 mm':''} + ${offset} mm`;}
/** A complete, independently valid selection, with only referenced parameters. */
export function selectionFragment(input:CadDocument,selection:readonly string[]):CadDocument {
 const doc=validateDocument(input),chosen=new Set(selection);doc.roots=doc.roots.filter(id=>chosen.has(id));
 if(!doc.roots.length)throw new Error('Select an object to copy');
 const keep=new Set<string>();const visit=(id:string)=>{if(keep.has(id))return;keep.add(id);const node=doc.nodes[id];if(node.kind==='boolean')node.inputs.forEach(visit);};doc.roots.forEach(visit);
 for(const id of Object.keys(doc.nodes))if(!keep.has(id))delete doc.nodes[id];
 if(doc.joints)doc.joints=doc.joints.filter(j=>doc.roots.includes(j.bodyA)&&doc.roots.includes(j.bodyB));
 if(doc.parametric){
  const original=doc.parametric,values=evaluateParameters(original);original.bindings=original.bindings.filter(binding=>keep.has(binding.nodeId));
  const required=new Set<string>();const references=(expression:string)=>evaluateExpression(expression,name=>{required.add(name);return values[name];});
  original.bindings.forEach(binding=>references(binding.expression));const scanned=new Set<string>();
  while([...required].some(name=>!scanned.has(name)))for(const name of [...required])if(!scanned.has(name)){scanned.add(name);references(original.parameters[name].expression);}
  original.parameters=Object.fromEntries(Object.entries(original.parameters).filter(([name])=>required.has(name)));
  if(!original.bindings.length)delete doc.parametric;
 }
 return validateDocument(doc);
}
/** Keep formulas on paste; collisions get a separate parameter namespace. */
export function mergeFragmentParameters(target:CadDocument,source:CadDocument,ids:ReadonlyMap<string,string>,offset:[number,number,number]) {
 if(!source.parametric?.bindings.length)return;
 target.version=2;target.parametric??={version:1,parameters:{},bindings:[]};
 const used=new Set(Object.keys(target.parametric.parameters)),names=new Map<string,string>(),values=evaluateParameters(source.parametric);
 for(const name of Object.keys(source.parametric.parameters)){let next=name;for(let index=2;used.has(next);index++)next=`${name.slice(0,30)}_${index}`;names.set(name,next);used.add(next);}
 const rewrite=(expression:string)=>expression.replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g,name=>names.get(name)??name);
 for(const [name,p] of Object.entries(source.parametric.parameters))target.parametric.parameters[names.get(name)!]={...p,expression:rewrite(p.expression)};
 for(const binding of source.parametric.bindings){let expression=rewrite(binding.expression);const axis=['positionX','positionY','positionZ'].indexOf(binding.property);
  if(source.roots.includes(binding.nodeId)&&axis>=0&&offset[axis]){const q=evaluateExpression(binding.expression,name=>values[name]);expression=`(${expression})${q.length===0&&q.angle===0?' * 1 mm':''} + ${offset[axis]} mm`;}
  target.parametric.bindings.push({...binding,nodeId:ids.get(binding.nodeId)!,expression});
 }
}
