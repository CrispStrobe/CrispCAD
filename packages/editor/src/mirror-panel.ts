// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,SketchPlane} from '@brickwright/cad-core';
import {mountBodyOperationPanel,operationField,operationScalar} from './body-operation-panel.js';

export function mountMirrorPanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<unknown>,afterApply:()=>Promise<unknown>){
 const panel=mountBodyOperationPanel(parent,session,evaluate,afterApply);
 function open(id:string,edit=false){
  const doc=session.state.document,node=doc.nodes[id];
  if(!node||(edit?node.kind!=='mirror':node.reference||!doc.roots.includes(id)))throw new Error(t('Select one top-level body to mirror'));
  const previous=edit&&node.kind==='mirror'?node:undefined;
  const fields=document.createElement('div');
  const plane=document.createElement('select');
  for(const [value,label] of [['YZ',t('YZ (X offset)')],['XZ',t('XZ (Y offset)')],['XY',t('XY (Z offset)')]]){
   const option=document.createElement('option');
   option.value=value;
   option.textContent=label;
   plane.append(option);
  }
  plane.value=previous?.plane??'YZ';
  const offset=document.createElement('input');
  offset.type='text';
  offset.value=String(previous?.offset??0);
  fields.append(operationField(t('Mirror plane'),plane).label,operationField(t('Plane offset (mm)'),offset).label);
  panel.open({
   title:t(previous?'Edit mirror':'Mirror body'),
   closeLabel:t('Close mirror'),
   applyLabel:t(previous?'Apply mirror changes':'Mirror body'),
   hint:t('The offset sets the plane’s position along its perpendicular axis. The source stays editable under Inputs.'),
   fields,
   read:()=>{
    const inputs={plane:plane.value as SketchPlane,offset:operationScalar(offset)};
    return target=>previous?target.editMirror(id,inputs):target.mirrorBody(id,inputs);
   }
  });
 }
 return {open,dispose:panel.dispose};
}
