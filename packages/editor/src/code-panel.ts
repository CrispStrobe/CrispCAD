// SPDX-License-Identifier: BSD-3-Clause
import {compileCode,createCadSession,defaultCodeProgram,CadCodeError,pruneDocument} from '@brickwright/cad-core';
import type {CadSession,CodeProgram,CadDocument} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {evaluatedPreview} from './shapes.js';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function mountCodePanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<GeometryResult>,after:()=>Promise<unknown>){
 const dialog=el('dialog');dialog.className='code-dialog';dialog.setAttribute('aria-label','Code object');parent.append(dialog);let disposed=false;
 function open(id?:string){
  const expected=session.state.revision,document=session.state.document,node=id?document.nodes[id]:undefined;if(id&&node?.kind!=='code')throw new Error('Select a code object');
  const original=node?.kind==='code'?node.program:defaultCodeProgram();let overrides=structuredClone(original.parameters),busy=false;
  dialog.replaceChildren();const header=el('header'),heading=el('h2',id?'Edit code object':'Code an object'),close=el('button','Close code');close.onclick=()=>dialog.close();header.append(heading,close);
  const layout=el('div');layout.className='code-layout';const left=el('div'),right=el('div');left.className='code-source-pane';right.className='code-preview-pane';
  const name=el('input');name.value=node?.name??'Coded plate';name.setAttribute('aria-label','Code object name');name.disabled=!!id;
  const source=el('textarea');source.setAttribute('aria-label','CAD code source');source.spellcheck=false;source.wrap='off';source.value=original.source;
  const help=el('details');help.append(el('summary','Language reference'),el('pre','param width: mm = 40;\nlet base = box(width, 30, 5);\nreturn subtract(base, cylinder(3, 20));\n\nUnits: mm, deg, scalar. Arithmetic: + - * / ( ).\nShapes: box(w,d,h), cylinder(r,h[,segments]), sphere(r[,segments]).\nBooleans: union(a,b,...), subtract(base,cut,...), intersect(a,b,...).\nTransforms: move([x,y,z],shape), rotate([x,y,z],shape), scale([x,y,z],shape).\nPattern: repeat(count,[dx,dy,dz],shape). Nest transforms in operation order.\nNamed shapes use let; one final return produces one rigid body.\n// starts a comment. This is CAD Script, not JavaScript or .scad.'));
  const fields=el('div');fields.className='code-parameters';const image=el('img');image.alt='Preview of the coded solid';image.hidden=true;const measures=el('p','Preview the code to check the solid.');
  const status=el('p');status.setAttribute('role','status');status.setAttribute('aria-label','Code status');
  const preview=el('button','Preview code'),apply=el('button',id?'Apply code changes':'Create code object');apply.className='primary';const reset=el('button','Use source defaults');reset.onclick=()=>{overrides={};fields.replaceChildren();status.textContent='Overrides cleared. Preview to reload parameter controls.';};
  const program=():CodeProgram=>({version:1,language:'brickwright-cad-script',source:source.value,parameters:structuredClone(overrides)});
  function parameterFields(){const compiled=compileCode(program());fields.replaceChildren(el('h3','Parameters'));
   for(const [key,p] of Object.entries(compiled.parameters)){const label=el('label',`${key} (${p.unit})`),input=el('input'),output=el('small',`= ${Number(compiled.values[key].value.toFixed(5))} ${p.unit==='scalar'?'':p.unit}`);input.type='text';input.value=overrides[key]??'';input.placeholder=`Default: ${p.expression}`;input.setAttribute('aria-label',`Code parameter ${key}`);input.oninput=()=>{if(input.value.trim())overrides[key]=input.value.trim();else delete overrides[key];status.textContent='Parameter changed. Preview or apply to rebuild.';};label.append(input,output);fields.append(label);}
  }
  function trial(p:CodeProgram){const draft=createCadSession(document);let target=id;if(target)draft.updateCode(target,p);else target=draft.addCode(p,name.value.trim());return {draft,target};}
  async function build(commit:boolean){if(busy)return;busy=true;preview.disabled=apply.disabled=true;status.textContent='Building coded solid…';
   try{if(session.state.revision!==expected)throw new Error('The model changed. Close and reopen this editor before applying.');const submitted=program(),submittedName=name.value;const {draft,target}=trial(submitted);const result=await evaluate(draft.state.document);if(disposed||!dialog.open)return;if(session.state.revision!==expected)throw new Error('The model changed while building. Reopen the code editor.');
    if(JSON.stringify(program())!==JSON.stringify(submitted)||name.value!==submittedName)throw new Error('Code changed during the build. Preview again.');let body=result.bodies.find(b=>b.id===target);if(!body){const isolated=structuredClone(draft.state.document);isolated.roots=[target];delete isolated.joints;pruneDocument(isolated);body=(await evaluate(isolated)).bodies[0];if(disposed||!dialog.open)return;if(session.state.revision!==expected||JSON.stringify(program())!==JSON.stringify(submitted))throw new Error('The code or model changed during preview. Build again.');}if(!body)throw new Error('The coded output is unavailable');if(body.indices.length<=90000){image.src=evaluatedPreview([body]);image.hidden=false;}else image.hidden=true;measures.textContent=`${body.volume.toLocaleString(undefined,{maximumFractionDigits:2})} mm³ · ${body.indices.length/3} triangles`;parameterFields();status.textContent=commit?'Code accepted.':'Preview ready. The model and its history are unchanged.';
    if(commit){if(id)session.updateCode(id,submitted);else session.addCode(submitted,submittedName.trim());dialog.close();await after();}
   }catch(error){if(!disposed){status.textContent=error instanceof Error?error.message:String(error);if(error instanceof CadCodeError){source.focus();source.setSelectionRange(error.offset,error.offset+1);}}}finally{busy=false;preview.disabled=apply.disabled=false;}
  }
  preview.onclick=()=>void build(false);apply.onclick=()=>void build(true);source.oninput=()=>{status.textContent='Source changed. Preview or apply to rebuild.';};
  source.onkeydown=event=>{if(event.key==='Tab'){event.preventDefault();source.setRangeText('  ',source.selectionStart,source.selectionEnd,'end');source.dispatchEvent(new Event('input'));}if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void build(false);}};
  left.append(name,source,help);right.append(image,measures,fields,reset);layout.append(left,right);const footer=el('footer');footer.append(status,preview,apply);dialog.append(header,layout,footer);try{parameterFields();}catch(error){status.textContent=String(error);}dialog.showModal();source.focus();
 }
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 return {open,dispose(){disposed=true;dialog.close();dialog.remove();}};
}
