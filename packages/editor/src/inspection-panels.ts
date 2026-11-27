// SPDX-License-Identifier: BSD-3-Clause
// Read-only inspections of Phase 6.5: Materials and mass (multi-material report for printing),
// Inspect surface blends (fillets, rounds, chamfers on the exact B-rep, each one markable in the 3D
// view) and STEP evidence (exact measures and topology of a STEP file, or a round trip of the
// model's bodies). Dialogs in the manufacturing check's style: touch-sized controls, no keyboard
// needed, nothing saved with the model and no history entry.
import {FILAMENT_DIAMETER_MM,surfaceBlendLabel,t} from '@brickwright/cad-core';
import type {CadDocument,ManufacturingMark,MaterialsReport,MaterialsRequest,StepEvidence,SurfaceBlend,SurfaceBlendReport,SurfaceBlendRequest} from '@brickwright/cad-core';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
const fmt=(value:number,digits=3)=>Number(value.toFixed(digits)).toLocaleString(undefined,{maximumFractionDigits:digits});
const sig=(value:number)=>Number(value.toPrecision(7)).toLocaleString(undefined,{maximumSignificantDigits:7});
function toggle(parent:HTMLElement,label:string,checked=false,title?:string){
 const wrap=el('label','manufacturing-toggle'),input=el('input');input.type='checkbox';input.checked=checked;
 wrap.append(input,document.createTextNode(' '+label));if(title)wrap.title=title;parent.append(wrap);return input;
}
/** The dialog frame shared by the three inspections: title, options, results, Close and Run. */
function frame(shell:HTMLElement,title:string,kind:string){
 const dialog=el('dialog',`export-dialog manufacturing-dialog inspection-dialog`);dialog.dataset.inspection=kind;dialog.setAttribute('aria-label',title);
 const options=el('div','manufacturing-settings'),results=el('div','manufacturing-results');results.setAttribute('aria-live','polite');
 const footer=el('footer'),close=el('button','',t('Close')),run=el('button','primary',t('Run'));
 close.type=run.type='button';footer.append(close,run);
 dialog.append(el('h2','',title),options,results,footer);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 shell.append(dialog);
 let controller:AbortController|undefined,sequence=0;
 /** Runs `work` once at a time; a newer run or Close cancels the older one. */
 async function execute(busy:string,work:(signal:AbortSignal)=>Promise<void>){
  const id=++sequence;controller?.abort();controller=new AbortController();
  run.disabled=true;results.replaceChildren(el('p','',busy));
  try{await work(controller.signal);}
  catch(error){if(id===sequence)results.replaceChildren(el('p','manufacturing-error',error instanceof Error?error.message:String(error)));}
  finally{if(id===sequence)run.disabled=false;}
 }
 const cancel=()=>{if(run.disabled){controller?.abort();sequence++;run.disabled=false;}};
 close.onclick=()=>{cancel();dialog.close();};
 dialog.addEventListener('cancel',cancel);
 return {dialog,options,results,run,execute,current:()=>sequence,dispose(){cancel();dialog.remove();}};
}
function table(head:readonly string[],rows:readonly (readonly (string|HTMLElement)[])[]){
 const tableElement=el('table','inspection-table'),thead=el('thead'),tr=el('tr');
 for(const h of head)tr.append(el('th','',h));thead.append(tr);
 const tbody=el('tbody');
 for(const row of rows){const r=el('tr');for(const cell of row){const td=el('td');td.append(cell);r.append(td);}tbody.append(r);}
 tableElement.append(thead,tbody);return tableElement;
}
const swatch=(color:string)=>{const span=el('span','inspection-swatch');span.style.background=color;span.setAttribute('aria-hidden','true');const wrap=el('span');wrap.append(span,document.createTextNode(' '+color));return wrap;};

export interface MaterialsPanelHost {
 document():CadDocument;
 selection():string[];
 inspect(document:CadDocument,request:MaterialsRequest,signal:AbortSignal):Promise<MaterialsReport>;
 /** Select bodies a finding names (a view action; the model is unchanged). */
 select(ids:readonly string[]):void;
}
/** Materials and mass: per body, per material, per colour (filament), and fused or overlapping materials. */
export function mountMaterialsPanel(shell:HTMLElement,host:MaterialsPanelHost){
 const f=frame(shell,t('Materials and mass'),'materials');
 const exact=toggle(f.options,t('Exact volumes from the B-rep (loads the exact kernel)'),false,t('Bodies without an exact B-rep keep their mesh volume, and the report says so.'));
 const selected=toggle(f.options,t('Selected bodies only'));
 let report:MaterialsReport|undefined;
 function render(value:MaterialsReport){
  const r=f.results;r.replaceChildren();
  r.append(el('p','inspection-total',t`${value.bodies.length} bodies · ${fmt(value.totalVolumeMm3)} mm³ · ${fmt(value.totalMassG,2)} g`));
  r.append(el('h3','',t('Bodies')),table([t('Body'),t('Material'),t('Colour'),t('Volume (mm³)'),t('Mass (g)'),t('Source')],value.bodies.map(b=>[b.name,b.materialName,swatch(b.color),fmt(b.volumeMm3),fmt(b.massG,2),(b.geometry==='exact'?t('exact'):t('mesh'))+(b.reason?' · '+b.reason:'')])));
  r.append(el('h3','',t('By material')),table([t('Material'),t('Bodies'),t('Volume (mm³)'),t('Mass (g)')],value.byMaterial.map(g=>[g.name,String(g.bodies.length),fmt(g.volumeMm3),fmt(g.massG,2)])));
  r.append(el('h3','',t`By colour (filament ${FILAMENT_DIAMETER_MM} mm)`),table([t('Colour'),t('Bodies'),t('Volume (mm³)'),t('Mass (g)'),t('Filament (m)')],value.byColor.map(g=>[swatch(g.key),String(g.bodies.length),fmt(g.volumeMm3),fmt(g.massG,2),fmt(g.filamentM??0,2)])));
  r.append(el('h3','',t('Findings')));
  if(!value.findings.length)r.append(el('p','',value.overlapsChecked?t('No fused or overlapping materials.'):t('No fused materials (overlaps not checked).')));
  else{
   const list=el('ul','manufacturing-findings');
   for(const finding of value.findings){const item=el('li'),b=el('button','manufacturing-finding',finding.text);b.type='button';b.dataset.kind=finding.kind;b.title=t('Select these bodies');b.onclick=()=>host.select(finding.bodies);item.append(b);list.append(item);}
   r.append(list);
  }
  r.append(el('p','manufacturing-note',value.disclaimer));
 }
 f.run.onclick=()=>void f.execute(exact.checked?t('Measuring on the exact kernel…'):t('Measuring…'),async signal=>{
  const id=f.current(),bodies=selected.checked?host.selection():[];
  if(selected.checked&&!bodies.length)throw new Error(t('Select the bodies to inspect, or turn off Selected bodies only.'));
  const value=await host.inspect(host.document(),{bodies,exact:exact.checked},signal);
  if(id!==f.current())return;
  report=value;render(value);
 });
 return {open(){f.dialog.showModal();if(!report)void f.run.click();},get report(){return report;},dispose:f.dispose};
}

export interface SurfaceBlendPanelHost {
 document():CadDocument;
 selection():string[];
 inspect(document:CadDocument,request:SurfaceBlendRequest,signal:AbortSignal):Promise<SurfaceBlendReport>;
 /** Mark a blend in the 3D view (null clears). */
 show(mark:ManufacturingMark|null):void;
}
/** Inspect surface blends: the blends of each body on its exact B-rep; each one can be marked in the 3D view. */
export function mountSurfaceBlendPanel(shell:HTMLElement,viewHost:HTMLElement,host:SurfaceBlendPanelHost){
 const f=frame(shell,t('Inspect surface blends'),'blends');
 f.options.append(el('p','',t('Reads the exact B-rep (loads the exact kernel): fillet and round radii, chamfer setbacks and how tangent each blend is to its neighbours.')));
 const selected=toggle(f.options,t('Selected bodies only'));
 const bar=el('div','manufacturing-finding-bar');bar.hidden=true;bar.setAttribute('role','toolbar');bar.setAttribute('aria-label',t('Surface blend'));
 const barText=el('span','manufacturing-finding-text');barText.setAttribute('aria-live','polite');
 const previous=el('button','',t('Previous')),next=el('button','',t('Next')),back=el('button','',t('Back to report')),done=el('button','primary',t('Done'));
 for(const b of [previous,next,back,done])b.type='button';
 bar.append(barText,previous,next,back,done);viewHost.append(bar);
 let report:SurfaceBlendReport|undefined,listed:{blend:SurfaceBlend;body:string}[]=[],current=-1;
 const describe=(b:SurfaceBlend)=>{
  const continuity=b.continuity==='G1'?t`G1 (${b.tangentEdges} of ${b.boundaryEdges} edges tangent, ≤ ${fmt(b.maxTangentDeviationDeg??0,4)}°)`:b.continuity==='partly'?t`${b.tangentEdges} of ${b.boundaryEdges} edges tangent`:t('meets its neighbours at an angle');
  return `${surfaceBlendLabel(b)} · ${b.surface} · ${fmt(b.areaMm2,2)} mm² · ${continuity}${b.anglesDeg?.length?' · '+b.anglesDeg.map(a=>fmt(a,2)+'°').join('/'):''}`;
 };
 function render(value:SurfaceBlendReport){
  const r=f.results;r.replaceChildren();listed=[];
  for(const body of value.bodies){
   const section=el('section','manufacturing-body');section.dataset.body=body.id;
   section.append(el('h3','',t`${body.name}: ${body.blends.length} blends on ${body.faces} faces`));
   if(!body.blends.length)section.append(el('p','',t('No fillets, rounds, chamfers or freeform blends.')));
   const list=el('ul','manufacturing-findings');
   for(const blend of body.blends){
    const index=listed.length;listed.push({blend,body:body.name});
    const item=el('li'),b=el('button','manufacturing-finding',describe(blend));b.type='button';b.dataset.blend=String(index);b.dataset.kind=blend.kind;
    b.title=t('Show in the 3D view');b.onclick=()=>showBlend(index);item.append(b);list.append(item);
   }
   section.append(list);
   for(const a of body.authored)section.append(el('p','inspection-authored',a.operation==='fillet'?t`Modelled fillet ${a.name} R${fmt(a.sizeMm,4)}: ${a.matched} matching blends`:t`Modelled chamfer ${a.name} ${fmt(a.sizeMm,4)} mm: ${a.matched} matching chamfers`));
   r.append(section);
  }
  for(const failure of value.failures)r.append(el('p','manufacturing-reason',t`${failure.name}: not inspected (${failure.message})`));
  if(!value.bodies.length&&!value.failures.length)r.append(el('p','',t('No bodies to inspect.')));
  if(value.kernel)r.append(el('p','manufacturing-note',t`Exact B-rep: ${value.kernel}. Tangent means the exact surface normals agree within ${value.tangentDeg}°.`));
 }
 function showBlend(index:number){
  const entry=listed[index];if(!entry)return;
  current=index;f.dialog.close();bar.hidden=false;
  barText.textContent=`${index+1}/${listed.length} · ${entry.body} · ${describe(entry.blend)}`;
  previous.disabled=index===0;next.disabled=index===listed.length-1;
  host.show(entry.blend.mark??null);
 }
 function endBlends(reopen:boolean){bar.hidden=true;current=-1;host.show(null);if(reopen&&!f.dialog.open)f.dialog.showModal();}
 previous.onclick=()=>showBlend(current-1);next.onclick=()=>showBlend(current+1);
 back.onclick=()=>endBlends(true);done.onclick=()=>endBlends(false);
 f.run.onclick=()=>void f.execute(t('Reading the exact B-rep…'),async signal=>{
  const id=f.current(),bodies=selected.checked?host.selection():[];
  if(selected.checked&&!bodies.length)throw new Error(t('Select the bodies to inspect, or turn off Selected bodies only.'));
  const value=await host.inspect(host.document(),{bodies},signal);
  if(id!==f.current())return;
  report=value;render(value);
 });
 return {open(){endBlends(false);f.dialog.showModal();if(!report)void f.run.click();},get report(){return report;},get showing(){return current>=0;},dispose(){endBlends(false);bar.remove();f.dispose();}};
}

export interface StepEvidencePanelHost {
 document():CadDocument;
 selection():string[];
 /** Evidence of a chosen file, or (no file) a round trip of the model's bodies. */
 evidence(request:{file?:{name:string;bytes:Uint8Array};bodies:string[]},signal:AbortSignal):Promise<StepEvidence>;
 /** Let the user choose a .step/.stp file (undefined: cancelled). */
 chooseFile():Promise<{name:string;bytes:Uint8Array}|undefined>;
}
/** STEP evidence: what the exact kernel reads in a STEP file, or a round trip of the model's bodies. */
export function mountStepEvidencePanel(shell:HTMLElement,host:StepEvidencePanelHost){
 const f=frame(shell,t('STEP evidence'),'step-evidence');
 f.options.append(el('p','',t('Exact measures and a topology summary as the exact kernel reads them (loads the exact kernel). Nothing is imported.')));
 const choose=el('button','',t('Choose a STEP file…'));choose.type='button';choose.dataset.testid='step-evidence-file';
 f.options.append(choose);
 const selected=toggle(f.options,t('Round trip: selected bodies only'));
 f.run.textContent=t('Round trip of the model');
 let evidence:StepEvidence|undefined;
 function render(e:StepEvidence){
  const r=f.results;r.replaceChildren();const h=e.file.header;
  const summary=el('dl','inspection-summary');
  const row=(term:string,value:string)=>summary.append(el('dt','',term),el('dd','',value));
  row(t('File'),`${e.file.name} · ${e.file.bytes.toLocaleString()} ${t('bytes')}`);
  row('SHA-256',e.file.sha256);
  row(t('Schema'),h.schema.join(', ')||t('none given'));
  if(h.originatingSystem||h.preprocessor)row(t('Written by'),[h.originatingSystem,h.preprocessor].filter(Boolean).join(' · '));
  if(h.timestamp)row(t('Time stamp'),h.timestamp);
  row(t('Totals'),t`${e.bodies.length} bodies · ${sig(e.totals.volumeMm3)} mm³ · ${sig(e.totals.areaMm2)} mm² · ${e.totals.faces} faces · ${e.totals.edges} edges`);
  r.append(summary);
  if(e.roundTrip){
   r.append(el('h3','',e.roundTrip.pass?t`Round trip: every body reads back within ${e.roundTrip.tolerance}`:t`Round trip: some bodies differ by more than ${e.roundTrip.tolerance}`));
   r.append(table([t('Body'),t('Volume (mm³)'),t('Read back'),t('Area (mm²)'),t('Read back'),t('Result')],e.roundTrip.bodies.map(b=>[b.name,sig(b.volumeMm3),`${sig(b.readVolumeMm3)} (${b.volumeDeviation.toExponential(1)})`,sig(b.areaMm2),`${sig(b.readAreaMm2)} (${b.areaDeviation.toExponential(1)})`,b.pass?t('Pass'):t('Fail')])));
  }
  for(const b of e.bodies){
   const section=el('section','manufacturing-body');
   section.append(el('h3','',`${b.name}${b.color?' · '+b.color:''} · ${b.valid?t('valid solid'):t('NOT a valid solid')}`));
   const dl=el('dl','inspection-summary'),line=(term:string,value:string)=>dl.append(el('dt','',term),el('dd','',value));
   line(t('Volume'),`${sig(b.volumeMm3)} mm³`);line(t('Area'),`${sig(b.areaMm2)} mm²`);
   line(t('Box'),`[${b.bounds.min.map(sig).join(', ')}] – [${b.bounds.max.map(sig).join(', ')}]`);
   line(t('Centroid'),`[${b.centroid.map(sig).join(', ')}]`);
   line(t('Faces'),`${b.faces.total}: `+Object.entries(b.faces.bySurface).map(([kind,v])=>`${kind} ${v.count}`).join(', ')+` · ${t('smallest')} ${sig(b.faces.smallestMm2)} mm²`);
   line(t('Edges'),`${b.edges.total}: `+Object.entries(b.edges.byCurve).map(([kind,v])=>`${kind} ${v.count}`).join(', ')+` · ${t('closed')} ${b.edges.closed} · ${t('free')} ${b.edges.free} · ${t('shortest')} ${sig(b.edges.shortestMm)} mm`);
   section.append(dl);r.append(section);
  }
  for(const note of e.notes)r.append(el('p','manufacturing-reason',t`Reader note: ${note}`));
  r.append(el('p','manufacturing-note',e.disclaimer));
 }
 const work=(file?:{name:string;bytes:Uint8Array})=>f.execute(t('Reading on the exact kernel…'),async signal=>{
  const id=f.current(),bodies=!file&&selected.checked?host.selection():[];
  if(!file&&selected.checked&&!bodies.length)throw new Error(t('Select the bodies to inspect, or turn off Selected bodies only.'));
  const value=await host.evidence({...(file?{file}:{}),bodies},signal);
  if(id!==f.current())return;
  evidence=value;render(value);
 });
 choose.onclick=async()=>{try{const file=await host.chooseFile();if(file)await work(file);}catch(error){f.results.replaceChildren(el('p','manufacturing-error',error instanceof Error?error.message:String(error)));}};
 f.run.onclick=()=>void work();
 return {open(){f.dialog.showModal();if(!evidence)f.results.replaceChildren(el('p','',t('Choose a STEP file, or run a round trip of the model: its bodies are written as STEP and read back.')));},
  /** Evidence of a file given by the host (e.g. a file dropped on the dialog). */
  inspectFile(file:{name:string;bytes:Uint8Array}){f.dialog.showModal();return work(file);},
  get evidence(){return evidence;},dispose:f.dispose};
}
