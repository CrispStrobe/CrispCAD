// SPDX-License-Identifier: BSD-3-Clause
import {drivenProperties, evaluateParameters, designGraph} from '@brickwright/cad-core';
import type {CadSession, DrivenProperty, NamedParameter, ParameterUnit, ParametricDesign} from '@brickwright/cad-core';

export const propertyLabels: Record<DrivenProperty,string> = {
  width:'Width (mm)',depth:'Depth (mm)',height:'Height (mm)',radius:'Radius (mm)',
  positionX:'Position X',positionY:'Position Y',positionZ:'Position Z',
  rotationX:'Rotation X',rotationY:'Rotation Y',rotationZ:'Rotation Z',
  scaleX:'Scale X',scaleY:'Scale Y',scaleZ:'Scale Z',
};
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;
};
function input(label:string,value:string){const field=element('input');field.type='text';field.value=value;field.setAttribute('aria-label',label);return field;}
function button(label:string, action:()=>void){const b=element('button',label);b.type='button';b.onclick=action;return b;}

/** Scoped optional modeling layer; applying a draft is one atomic undoable edit. */
export function mountParametersPanel(parent:HTMLElement, session:CadSession) {
  const dialog=element('dialog');dialog.className='parameters-dialog';dialog.setAttribute('aria-label','Model parameters');
  parent.append(dialog);let expectedRevision=0;
  function open() {
    expectedRevision=session.state.revision;
    dialog.replaceChildren();
    const doc=session.state.document, design=doc.parametric;
    const heading=element('header');heading.append(element('h2','Model parameters'),button('Close parameters',()=>dialog.close()));
    const help=element('p','Optional: name dimensions, derive values with + − × / and parentheses, then drive object properties. Use explicit units in sums, e.g. width + 5 mm. cm, m, in, deg and rad are supported.');
    const parameterList=element('div');parameterList.className='parameter-list';
    const bindingList=element('div');bindingList.className='binding-list';
    const status=element('p');status.className='parameter-status';status.setAttribute('role','status');status.setAttribute('aria-label','Parameter status');
    status.textContent='Edits take effect together when you choose Apply parameters. Existing numeric modeling stays available.';
    function addParameter(name='',p:NamedParameter={expression:'40',unit:'mm'}){
      const row=element('div');row.className='parameter-row';
      const nameInput=input('Parameter name',name),expression=input('Parameter expression',p.expression),unit=element('select');unit.setAttribute('aria-label','Parameter unit');
      for(const value of ['mm','deg','scalar']){const option=element('option',value);option.value=value;unit.append(option);}unit.value=p.unit;
      const value=element('output');value.setAttribute('aria-label','Evaluated parameter');
      if(name&&design){try{value.textContent=`${evaluateParameters(design)[name].value.toLocaleString(undefined,{maximumFractionDigits:5})} ${p.unit==='scalar'?'':p.unit}`;}catch{}}
      row.append(nameInput,expression,unit,value,button('Remove parameter',()=>row.remove()));parameterList.append(row);
    }
    function addBinding(nodeId=session.state.selection[0]??doc.roots[0],property:DrivenProperty='width',expression=''){
      const row=element('div');row.className='binding-row';
      const object=element('select');object.setAttribute('aria-label','Driven object');
      for(const node of Object.values(doc.nodes)){const option=element('option',`${node.name}${doc.roots.includes(node.id)?'':' · operand'}`);option.value=node.id;object.append(option);}
      if(nodeId&&doc.nodes[nodeId])object.value=nodeId;
      const field=element('select');field.setAttribute('aria-label','Driven property');
      const updateFields=()=>{field.replaceChildren();const node=doc.nodes[object.value];if(!node)return;for(const key of drivenProperties(node)){const option=element('option',propertyLabels[key]);option.value=key;field.append(option);}};
      object.onchange=updateFields;updateFields();if(Array.from(field.options).some(o=>o.value===property))field.value=property;
      const source=input('Driving expression',expression);source.placeholder='e.g. width / 2';
      row.append(object,field,source,button('Remove binding',()=>row.remove()));bindingList.append(row);
    }
    for(const [name,p] of Object.entries(design?.parameters??{}))addParameter(name,p);
    for(const b of design?.bindings??[])addBinding(b.nodeId,b.property,b.expression);
    const addBindingButton=button('Drive a property',()=>addBinding());addBindingButton.disabled=!doc.roots.length;
    const actions=element('footer');const apply=button('Apply parameters',()=>{
      try {
        if(session.state.revision!==expectedRevision)throw new Error('The model changed while this panel was open. Close and reopen it before applying.');
        const next:ParametricDesign={version:1,parameters:Object.create(null),bindings:[]};
        for(const row of parameterList.children){
          const fields=row.querySelectorAll('input'),unit=row.querySelector('select')!;
          const name=fields[0].value.trim();
          if(Object.hasOwn(next.parameters,name))throw new Error(`Duplicate parameter “${name}”`);
          next.parameters[name]={expression:fields[1].value.trim(),unit:unit.value as ParameterUnit};
        }
        for(const row of bindingList.children){const fields=row.querySelectorAll('select');next.bindings.push({nodeId:fields[0].value,property:fields[1].value as DrivenProperty,expression:row.querySelector('input')!.value.trim()});}
        session.setParametric(next);expectedRevision=session.state.revision;
        status.textContent='Parameters applied. Geometry is recomputing; this edit is saved in model history.';
        updateGraph();const values=evaluateParameters(next);
        for(const row of parameterList.children){const name=row.querySelector('input')!.value.trim(),unit=next.parameters[name].unit;row.querySelector('output')!.textContent=`${values[name].value.toLocaleString(undefined,{maximumFractionDigits:5})} ${unit==='scalar'?'':unit}`;}
      } catch(error) {status.textContent=error instanceof Error?error.message:String(error);}
    });apply.className='primary';actions.append(button('Cancel',()=>dialog.close()),apply);
    const graph=element('details');graph.className='design-dependencies';
    function updateGraph(){graph.replaceChildren(element('summary','Feature dependencies'));const dependencies=designGraph(session.state.document);for(const entry of dependencies){const row=element('p',`${entry.kind}: ${entry.label}${entry.dependencies.length?' ← '+entry.dependencies.map(key=>dependencies.find(e=>e.key===key)?.label??key).join(', '):''}`);row.title=entry.key;graph.append(row);}}
    updateGraph();
    dialog.append(heading,help,graph,element('h3','Named dimensions and values'),parameterList,button('Add parameter',()=>addParameter()),element('h3','Driving expressions'),bindingList,addBindingButton,status,actions);
    dialog.showModal();
  }
  // Keep editor shortcuts from acting on the model behind this modal.
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  return {open,dispose(){dialog.close();dialog.remove();}};
}
