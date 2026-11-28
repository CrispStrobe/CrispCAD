// SPDX-License-Identifier: BSD-3-Clause
// "Check for manufacturing" (Phase 6.3): a dialog that checks the bodies for FDM printing, 3-axis
// CNC milling, a laser-cut sheet or injection moulding, with edge-radius rules, and lists what it found. Each finding
// is a button: it sets the dialog aside and marks the faces or edges in the 3D view, with a bar to
// step through the findings and come back; everything is tappable, so it works on an iPad without
// a keyboard. Settings are this editor's view preference: nothing is saved with the model, and the
// check adds no history entry.
import {APPROACH_AXES,DEFAULT_MANUFACTURING_SETTINGS,processLabel,t} from '@brickwright/cad-core';
import type {ApproachAxis,CadDocument,EdgeBreakRule,ManufacturingCheck,ManufacturingFinding,ManufacturingMark,ManufacturingProcess,ManufacturingReport,ManufacturingSettings} from '@brickwright/cad-core';

export interface ManufacturingPanelHost {
 document():CadDocument;
 /** Top-level bodies selected now (checked instead of all bodies when "Selected bodies" is on). */
 selection():string[];
 check(document:CadDocument,request:{bodies:string[];settings:ManufacturingSettings},signal:AbortSignal):Promise<ManufacturingReport>;
 /** Mark a finding in the 3D view (null clears). */
 show(mark:ManufacturingMark|null):void;
}

const STATUS:Record<ManufacturingCheck['status'],string>={pass:'Pass',warn:'Warning',fail:'Fail',info:'Info','not-checked':'Not checked'};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};

function numberField(parent:HTMLElement,label:string,value:number|undefined,step:number,placeholder=''):HTMLInputElement{
 const wrap=el('label','',t(label)),input=el('input');
 input.type='number';input.min='0';input.step=String(step);input.inputMode='decimal';
 if(value!==undefined)input.value=String(value);
 if(placeholder)input.placeholder=placeholder;
 input.setAttribute('aria-label',t(label));wrap.append(input);parent.append(wrap);return input;
}
const optional=(input:HTMLInputElement)=>input.value.trim()===''?undefined:Number(input.value);

export function mountManufacturingPanel(shell:HTMLElement,viewHost:HTMLElement,host:ManufacturingPanelHost){
 const dialog=el('dialog','export-dialog manufacturing-dialog');dialog.setAttribute('aria-label',t('Check for manufacturing'));
 const heading=el('h2','',t('Check for manufacturing'));
 const form=el('div','manufacturing-settings');
 const processWrap=el('label','',t('Process')),process=el('select');process.setAttribute('aria-label',t('Process'));
 for(const value of ['fdm','cnc','laser','molding'] as const){const option=el('option','',processLabel(value));option.value=value;process.append(option);}
 process.value=DEFAULT_MANUFACTURING_SETTINGS.process;processWrap.append(process);form.append(processWrap);
 const exactWrap=el('label','manufacturing-toggle'),exact=el('input');exact.type='checkbox';exact.checked=true;
 exactWrap.append(exact,document.createTextNode(' '+t('Exact B-rep where available (loads the exact kernel)')));
 exactWrap.title=t('Measure fillet radii, edges, holes and walls on the exact B-rep. Bodies without one are checked on their mesh, and the report says so.');
 const selectedWrap=el('label','manufacturing-toggle'),selected=el('input');selected.type='checkbox';
 selectedWrap.append(selected,document.createTextNode(' '+t('Selected bodies only')));
 form.append(exactWrap,selectedWrap);
 const d=DEFAULT_MANUFACTURING_SETTINGS;
 const fdm=el('fieldset','manufacturing-process');fdm.dataset.process='fdm';fdm.append(el('legend','',processLabel('fdm')));
 const nozzle=numberField(fdm,'Nozzle (mm)',d.nozzleMm,.05),fdmWall=numberField(fdm,'Minimum wall (mm)',undefined,.1,t('2 × nozzle')),minHole=numberField(fdm,'Minimum hole (mm)',d.minHoleMm,.1);
 const cnc=el('fieldset','manufacturing-process');cnc.dataset.process='cnc';cnc.append(el('legend','',processLabel('cnc')));
 const tool=numberField(cnc,'End mill diameter (mm)',d.toolDiameterMm,.5),cncWall=numberField(cnc,'Minimum wall (mm)',.8,.1);
 const axesWrap=el('div','manufacturing-axes');axesWrap.setAttribute('role','group');axesWrap.setAttribute('aria-label',t('Tool approach directions (setups)'));
 axesWrap.append(el('span','',t('Tool approach directions (setups)')));
 const axes=new Map<ApproachAxis,HTMLInputElement>();
 for(const axis of APPROACH_AXES){const wrap=el('label'),input=el('input');input.type='checkbox';input.checked=d.approachAxes.includes(axis);input.setAttribute('aria-label',t`Tool from ${axis}`);wrap.append(input,document.createTextNode(' '+axis));axesWrap.append(wrap);axes.set(axis,input);}
 cnc.append(axesWrap);
 const depthRatio=numberField(cnc,'Deepest pocket (× tool diameter)',d.maxPocketDepthRatio,.5);
 const dogboneWrap=el('label','manufacturing-toggle'),dogbones=el('input');dogbones.type='checkbox';dogbones.checked=d.dogbones;
 dogbones.setAttribute('aria-label',t('Suggest dogbones'));
 dogboneWrap.append(dogbones,document.createTextNode(' '+t('Suggest dogbones')));
 dogboneWrap.title=t('For each internal corner a square-cornered part must fit into, show where a tool-diameter relief hole goes.');
 cnc.append(dogboneWrap);
 const laser=el('fieldset','manufacturing-process');laser.dataset.process='laser';laser.append(el('legend','',processLabel('laser')));
 const web=numberField(laser,'Minimum web (mm)',undefined,.1,t('sheet thickness'));
 const molding=el('fieldset','manufacturing-process');molding.dataset.process='molding';molding.append(el('legend','',processLabel('molding')));
 const pullWrap=el('label','',t('Mould opens along')),pull=el('select');pull.setAttribute('aria-label',t('Mould opens along'));
 for(const axis of APPROACH_AXES){const option=el('option','',axis);option.value=axis;pull.append(option);}
 pull.value=d.pullAxis;pullWrap.append(pull);molding.append(pullWrap);
 const draft=numberField(molding,'Minimum draft (°)',d.minDraftDeg,.5),moldWall=numberField(molding,'Minimum wall (mm)',.8,.1),moldMaxWall=numberField(molding,'Maximum wall (mm)',4,.5);
 const variation=numberField(molding,'Wall variation (%)',100*d.wallVariation,5);
 const edges=el('fieldset','manufacturing-edges');edges.append(el('legend','',t('Edge radius')));
 const minRadius=numberField(edges,'Minimum fillet radius (mm)',undefined,.1,t('none')),maxRadius=numberField(edges,'Maximum fillet radius (mm)',undefined,.1,t('none'));
 const breakWrap=el('label','',t('Sharp edges not allowed')),edgeBreak=el('select');edgeBreak.setAttribute('aria-label',t('Sharp edges not allowed'));
 for(const [value,label] of [['none','None'],['external','External (convex)'],['internal','Internal (concave)'],['all','All']] as const){const option=el('option','',t(label));option.value=value;edgeBreak.append(option);}
 breakWrap.append(edgeBreak);edges.append(breakWrap);
 form.append(fdm,cnc,laser,molding,edges);
 const showProcess=()=>{for(const set of [fdm,cnc,laser,molding])set.hidden=set.dataset.process!==process.value;};
 process.addEventListener('change',()=>{showProcess();results.replaceChildren();});showProcess();
 const results=el('div','manufacturing-results');results.setAttribute('aria-live','polite');
 const footer=el('footer'),close=el('button','',t('Close')),run=el('button','primary',t('Run check'));
 close.type=run.type='button';footer.append(close,run);
 dialog.append(heading,form,results,footer);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 shell.append(dialog);

 // The bar shown while a finding is marked in the 3D view.
 const bar=el('div','manufacturing-finding-bar');bar.hidden=true;bar.setAttribute('role','toolbar');bar.setAttribute('aria-label',t('Manufacturing finding'));
 const barText=el('span','manufacturing-finding-text');barText.setAttribute('aria-live','polite');
 const previous=el('button','',t('Previous')),next=el('button','',t('Next')),back=el('button','',t('Back to report')),done=el('button','primary',t('Done'));
 for(const b of [previous,next,back,done])b.type='button';
 bar.append(barText,previous,next,back,done);viewHost.append(bar);

 let controller:AbortController|undefined,sequence=0,report:ManufacturingReport|undefined;
 let listed:{finding:ManufacturingFinding;check:ManufacturingCheck;body:string}[]=[],current=-1;

 const settingsNow=():ManufacturingSettings=>({
  ...DEFAULT_MANUFACTURING_SETTINGS,
  process:process.value as ManufacturingProcess,exact:exact.checked,
  nozzleMm:Number(nozzle.value),minHoleMm:Number(minHole.value),toolDiameterMm:Number(tool.value),
  approachAxes:APPROACH_AXES.filter(axis=>axes.get(axis)!.checked),
  maxPocketDepthRatio:Number(depthRatio.value),dogbones:dogbones.checked,
  pullAxis:pull.value as ApproachAxis,minDraftDeg:Number(draft.value),wallVariation:Number(variation.value)/100,
  ...(process.value==='molding'&&optional(moldWall)!==undefined?{minWallMm:optional(moldWall)}:{}),
  ...(process.value==='molding'&&optional(moldMaxWall)!==undefined?{maxWallMm:optional(moldMaxWall)}:{}),
  ...(process.value==='fdm'&&optional(fdmWall)!==undefined?{minWallMm:optional(fdmWall)}:{}),
  ...(process.value==='cnc'&&optional(cncWall)!==undefined?{minWallMm:optional(cncWall)}:{}),
  ...(process.value==='laser'&&optional(web)!==undefined?{minWallMm:optional(web)}:{}),
  ...(optional(minRadius)!==undefined?{minRadiusMm:optional(minRadius)}:{}),
  ...(optional(maxRadius)!==undefined?{maxRadiusMm:optional(maxRadius)}:{}),
  edgeBreak:edgeBreak.value as EdgeBreakRule,
 });

 function render(value:ManufacturingReport){
  results.replaceChildren();listed=[];
  if(!value.bodies.length){results.textContent=t('The design has no solid bodies to check');return;}
  for(const body of value.bodies){
   const section=el('section','manufacturing-body');section.dataset.body=body.id;
   const title=el('h3','',body.name),source=el('span','manufacturing-source',body.geometry==='exact'?t('exact B-rep'):t('mesh'));
   source.dataset.geometry=body.geometry;title.append(' ',source);section.append(title);
   if(body.reason)section.append(el('p','manufacturing-reason',body.reason));
   const list=el('dl');
   for(const check of body.checks){
    const term=el('dt','',check.label);term.append(' ',el('span','manufacturing-source',check.geometry==='exact'?t('exact'):t('mesh')));
    const detail=el('dd');detail.dataset.status=check.status;detail.dataset.check=check.id;
    detail.append(el('strong','',t(STATUS[check.status])+': '),document.createTextNode(check.summary));
    if(check.findings.length){
     const items=el('ul','manufacturing-findings');
     for(const finding of check.findings){
      const index=listed.length;listed.push({finding,check,body:body.name});
      const item=el('li'),open=el('button','manufacturing-finding',finding.text);open.type='button';
      open.title=t('Show in the 3D view');open.dataset.finding=String(index);
      open.onclick=()=>showFinding(index);
      item.append(open);items.append(item);
     }
     if(check.more)items.append(el('li','',t`… and ${check.more} more`));
     detail.append(items);
    }
    list.append(term,detail);
   }
   section.append(list);results.append(section);
  }
  results.append(el('p','manufacturing-note',(value.kernel?t`Exact checks: ${value.kernel}. `:'')+value.disclaimer));
 }

 async function execute(){
  const id=++sequence;controller?.abort();controller=new AbortController();
  run.disabled=true;results.replaceChildren(el('p','',exact.checked?t('Checking on the exact kernel…'):t('Checking…')));
  try{
   const settings=settingsNow(),doc=host.document();
   const bodies=selected.checked?host.selection():[];
   if(selected.checked&&!bodies.length)throw new Error(t('Select the bodies to check, or turn off Selected bodies only.'));
   const value=await host.check(doc,{bodies,settings},controller.signal);
   if(id!==sequence)return;
   report=value;render(value);
  }catch(error){if(id===sequence)results.replaceChildren(el('p','manufacturing-error',error instanceof Error?error.message:String(error)));}
  finally{if(id===sequence)run.disabled=false;}
 }

 function showFinding(index:number){
  const entry=listed[index];if(!entry)return;
  current=index;dialog.close();bar.hidden=false;
  barText.textContent=`${index+1}/${listed.length} · ${entry.body} · ${entry.check.label}: ${entry.finding.text}`;
  previous.disabled=index===0;next.disabled=index===listed.length-1;
  host.show(entry.finding.mark);
 }
 function endFindings(reopen:boolean){
  bar.hidden=true;current=-1;host.show(null);
  if(reopen&&!dialog.open)dialog.showModal();
 }
 previous.onclick=()=>showFinding(current-1);
 next.onclick=()=>showFinding(current+1);
 back.onclick=()=>endFindings(true);
 done.onclick=()=>endFindings(false);
 run.onclick=()=>void execute();
 close.onclick=()=>{if(run.disabled){controller?.abort();sequence++;run.disabled=false;}dialog.close();};
 dialog.addEventListener('cancel',()=>{if(run.disabled){controller?.abort();sequence++;run.disabled=false;}});

 return {
  open(){endFindings(false);dialog.showModal();if(!report)results.replaceChildren(el('p','',t('Choose the process and run the check. It reads the model and changes nothing.')));},
  get report(){return report;},
  get showing(){return current>=0;},
  dispose(){sequence++;controller?.abort();host.show(null);dialog.remove();bar.remove();},
 };
}
