// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,PatternSettings} from '@brickwright/cad-core';
import {mountBodyOperationPanel,operationField,operationScalar} from './body-operation-panel.js';

export function mountPatternPanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<unknown>,afterApply:()=>Promise<unknown>){
 const panel=mountBodyOperationPanel(parent,session,evaluate,afterApply);
 function open(id:string,edit=false){
  const doc=session.state.document,node=doc.nodes[id];
  if(!node||(edit?node.kind!=='pattern':node.reference||!doc.roots.includes(id)))throw new Error(t('Select one top-level body to pattern'));
  const previous=edit&&node.kind==='pattern'?node.pattern:undefined;
  const fields=document.createElement('div');
  function choice(label:string,options:[string,string][],value:string){
   const select=document.createElement('select');
   for(const [key,text] of options)select.add(new Option(text,key));
   select.value=value;
   fields.append(operationField(label,select).label);
   return select;
  }
  function field(label:string,value:string|number){
   const input=document.createElement('input');
   input.type='text';
   input.value=String(value);
   const entry=operationField(label,input);
   fields.append(entry.label);
   return entry;
  }
  const mode=choice(t('Pattern type'),[['linear',t('Linear')],['circular',t('Circular')]],previous?.mode??'linear');
  const axisOptions:[string,string][]=[['X','X'],['Y','Y'],['Z','Z']];
  const linearAxis=choice(t('Pattern axis'),axisOptions,previous?.mode==='linear'?previous.axis:'X');
  const circularAxis=choice(t('Pattern axis'),axisOptions,previous?.mode==='circular'?previous.axis:'Z');
  const count=field(t('Total instances'),previous?.count??4);
  const spacing=field(t('Spacing (mm)'),previous?.mode==='linear'?previous.spacing:20);
  const sweep=field(t('Sweep angle (deg)'),previous?.mode==='circular'?previous.sweep:360);
  const axes=['X','Y','Z'];
  const centerAxes=()=>axes.filter(name=>name!==circularAxis.value);
  const center=new Map(axes.map(name=>{
   const index=centerAxes().indexOf(name);
   return [name,field(t`Center ${name} (mm)`,previous?.mode==='circular'&&index>=0?previous.center[index]:0)] as const;
  }));
  function refresh(){
   const circular=mode.value==='circular';
   linearAxis.parentElement!.hidden=circular;
   circularAxis.parentElement!.hidden=!circular;
   spacing.label.hidden=circular;
   sweep.label.hidden=!circular;
   for(const [name,entry] of center)entry.label.hidden=!circular||name===circularAxis.value;
  }
  mode.onchange=circularAxis.onchange=refresh;
  refresh();
  panel.open({
   title:t(previous?'Edit pattern':'Pattern body'),
   closeLabel:t('Close pattern'),
   applyLabel:t(previous?'Apply pattern changes':'Create pattern'),
   hint:t('The total includes the source body. For a bolt circle, place the source away from the axis. A partial sweep ends at the last instance.'),
   fields,
   read:()=>{
    const countValue=operationScalar(count.input);
    const [first,second]=centerAxes();
    const settings:PatternSettings=mode.value==='linear'
     ?{axis:linearAxis.value as PatternSettings['axis'],count:countValue,mode:'linear',spacing:operationScalar(spacing.input)}
     :{axis:circularAxis.value as PatternSettings['axis'],count:countValue,mode:'circular',sweep:operationScalar(sweep.input),
        center:[operationScalar(center.get(first)!.input),operationScalar(center.get(second)!.input)]};
    return target=>previous?target.editPattern(id,settings):target.patternBody(id,settings);
   }
  });
 }
 return {open,dispose:panel.dispose};
}
