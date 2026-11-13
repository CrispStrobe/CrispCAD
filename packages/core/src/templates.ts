// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {createCadSession} from './session.js';
import {newId,identityTransform} from './document.js';
import type {ParametricDesign} from './parameters.js';
export type DesignTemplate='l-bracket'|'mounting-plate'|'spacer';
/** Original practical starting parts, retained as editable sketches/features. */
export function createDesignTemplate(kind:DesignTemplate){
 const s=createCadSession();const design:ParametricDesign={version:1,parameters:{},bindings:[]};
 const parameter=(name:string,value:number)=>design.parameters[name]={expression:String(value),unit:'mm'};
 parameter('width',kind==='mounting-plate'?60:40);parameter('depth',30);parameter('thickness',kind==='l-bracket'?4:5);
 if(kind==='spacer'){parameter('outerRadius',12);parameter('boreRadius',6);parameter('length',10);}
 if(kind==='mounting-plate')parameter('holeDiameter',6);
 if(kind==='l-bracket')parameter('height',30);
 s.setParametric(design);
 const rectangle=(name:string,width:string,depth:string,distance:string)=>s.addSketchExtrusion({kind:'rectangle',id:newId(),width,depth},{name,distance});
 const circle=(name:string,radius:string,distance:string)=>s.addSketchExtrusion({kind:'circle',id:newId(),radius,segments:64},{name,distance});
 let root:string;
 if(kind==='spacer'){
  const outer=circle('Outer profile','outerRadius','length'),bore=circle('Bore profile','boreRadius','length + 2 mm');const t=identityTransform();t.position[2]=-1;s.update(bore,{transform:t});root=s.combine('subtract',[outer,bore]);
 }else {
  const base=rectangle('Base profile','width','depth','thickness');
  if(kind==='l-bracket'){
   const upright=rectangle('Upright profile','width','thickness','height');design.bindings.push({nodeId:upright,property:'positionY',expression:'(depth - thickness) / 2'});s.setParametric(design);root=s.combine('union',[base,upright]);
  }else {
   const first=circle('Shared bore profile','holeDiameter / 2','thickness + 2 mm'),n=s.state.document.nodes[first];if(n.kind!=='extrusion')throw new Error(t('Expected extrusion'));const second=s.extrudeSketch(n.sketchId,{distance:'thickness + 2 mm'});
   for(const id of [first,second]){const t=identityTransform();t.position[2]=-1;s.update(id,{transform:t});}
   design.bindings.push({nodeId:first,property:'positionX',expression:'-width / 4'},{nodeId:second,property:'positionX',expression:'width / 4'});s.setParametric(design);root=s.combine('subtract',[base,first,second]);
  }
 }
 // Only publish the dimensions that actually drive this starting part.
 const current=structuredClone(s.state.document.parametric!);if(kind==='spacer')for(const name of ['width','depth','thickness'])delete current.parameters[name];s.setParametric(current);
 const name=kind==='l-bracket'?'L bracket':kind==='mounting-plate'?'Mounting plate':'Spacer';s.update(root,{name});s.rename(name);const doc=s.state.document;s.dispose();return doc;
}
