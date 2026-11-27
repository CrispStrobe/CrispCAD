// SPDX-License-Identifier: BSD-3-Clause
// Split body (Phase 6.5): cut a selected body at a plane into its two sides (document version 48).
// Touch first: the plane is a direction from a list (or typed X,Y,Z) and an offset, or one tap on
// the model ("Pick the plane on a face") puts it through the tapped point, along the tapped face's
// normal. Every control is a select, a field or a 44 px button; no keyboard is needed.
import {formatSplitNormal,parseSplitNormal,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,SplitSide,Vec3} from '@brickwright/cad-core';
import {mountBodyOperationPanel,operationField,operationScalar} from './body-operation-panel.js';

export interface SplitPanelHost {
 evaluate(doc:CadDocument):Promise<unknown>;
 afterApply():Promise<unknown>;
 /** The viewport's one-tap point pick; resolves null when cancelled. */
 pickPoint(done:(point:{bodyId:string;point:Vec3;normal:Vec3}|null)=>void):()=>void;
}

const directions:Record<string,Vec3>={z:[0,0,1],'-z':[0,0,-1],x:[1,0,0],'-x':[-1,0,0],y:[0,1,0],'-y':[0,-1,0]};
const directionLabel=(key:string)=>({z:t('+Z (horizontal plane)'),'-z':t('−Z (horizontal plane)'),x:t('+X (plane across X)'),'-x':t('−X (plane across X)'),y:t('+Y (plane across Y)'),'-y':t('−Y (plane across Y)'),custom:t('Other direction (X,Y,Z)')} as Record<string,string>)[key];
const round=(v:number)=>Number(v.toFixed(6))+0;

export function mountSplitPanel(parent:HTMLElement,session:CadSession,host:SplitPanelHost){
 const panel=mountBodyOperationPanel(parent,session,doc=>host.evaluate(doc),()=>host.afterApply());
 // The shared body-operation dialog, sized for touch while this panel uses it.
 const dialog=parent.lastElementChild instanceof HTMLDialogElement?parent.lastElementChild:null;
 dialog?.classList.add('split-dialog');
 /** Split `id`, or with `edit` move the plane of the split body `id` (and its other side). */
 function open(id:string,edit=false,preset?:{direction:string;custom:string;offset:string;keep:string}){
  const doc=session.state.document,node=doc.nodes[id];
  if(!node||(edit?node.kind!=='split':node.reference||node.role==='hole'||!doc.roots.includes(id)))throw new Error(edit?t('Select a split body'):t('Select one top-level body to split'));
  const previous=edit&&node.kind==='split'?node:undefined;
  const fields=document.createElement('div');
  const direction=document.createElement('select');
  for(const key of [...Object.keys(directions),'custom']){const option=document.createElement('option');option.value=key;option.textContent=directionLabel(key);direction.append(option);}
  const custom=document.createElement('input');custom.type='text';custom.inputMode='decimal';custom.placeholder='0,0,1';
  const offset=document.createElement('input');offset.type='text';offset.inputMode='decimal';offset.value=String(previous?.offset??0);
  const keep=document.createElement('select');
  for(const [value,label] of [['both',t('Both sides, as two bodies')],['positive',t('Only the + side')],['negative',t('Only the − side')]]){const option=document.createElement('option');option.value=value;option.textContent=label;keep.append(option);}
  const initial=previous?formatSplitNormal(previous.normal):'z';
  if(Object.hasOwn(directions,initial))direction.value=initial;else{direction.value='custom';custom.value=previous!.normal.join(',');}
  if(preset){direction.value=preset.direction;custom.value=preset.custom;offset.value=preset.offset;keep.value=preset.keep;}
  const customField=operationField(t('Normal X,Y,Z'),custom).label;
  const showCustom=()=>{customField.hidden=direction.value!=='custom';};
  direction.addEventListener('change',showCustom);showCustom();
  const pick=document.createElement('button');pick.type='button';pick.className='fastening-pick';pick.textContent=t('Pick the plane on a face');
  pick.dataset.testid='split-pick';
  // Picking closes the dialog (a closed dialog cannot apply), so it reopens with the picked plane.
  pick.onclick=()=>{
   const values={direction:direction.value,custom:custom.value,offset:offset.value,keep:keep.value};
   parent.querySelector<HTMLDialogElement>('dialog.body-operation-dialog[open]')?.close();
   host.pickPoint(point=>{
    if(point){
     // The plane through the tapped point, perpendicular to the tapped face's normal.
     const n=point.normal,length=Math.hypot(...n),unit=n.map(v=>v/length) as Vec3,axis=formatSplitNormal(unit);
     if(Object.hasOwn(directions,axis))values.direction=axis;else{values.direction='custom';values.custom=unit.map(round).join(',');}
     values.offset=String(round(unit.reduce((sum,v,i)=>sum+v*point.point[i],0)));
    }
    open(id,edit,values);
   });
  };
  fields.append(pick,operationField(t('Plane normal'),direction).label,customField,operationField(t('Offset along the normal (mm)'),offset).label,...(previous?[]:[operationField(t('Keep'),keep).label]));
  panel.open({
   title:previous?t('Edit split'):t('Split body'),
   closeLabel:t('Close split'),
   applyLabel:previous?t('Apply split changes'):t('Split body'),
   hint:t('The plane is every point whose distance along the normal is the offset; the + side is where the normal points. Both sides follow later edits of the source, which stays editable under Inputs.'),
   fields,
   read:()=>{
    const normal=direction.value==='custom'?parseSplitNormal(custom.value):directions[direction.value];
    const inputs={normal,offset:operationScalar(offset)};
    return target=>previous?target.editSplit(id,inputs):target.splitBody(id,{...inputs,keep:keep.value as 'both'|SplitSide});
   },
  });
 }
 return {open,dispose:panel.dispose};
}
