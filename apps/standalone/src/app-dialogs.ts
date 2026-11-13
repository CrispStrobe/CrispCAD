// SPDX-License-Identifier: BSD-3-Clause
import {getLibrarySettings,chooseLibraryFolder} from './library.js';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function dialog(label:string){const d=el('dialog');d.setAttribute('aria-label',label);const header=el('header');header.append(el('h1',label));const close=el('button','Close');close.onclick=()=>d.close();header.append(close);d.append(header);document.body.append(d);return d;}
function link(label:string,url:string){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener';return a;}
export function mountAppDialogs(preferences:{getReadout:()=>boolean;setReadout:(visible:boolean)=>void}){
 const about=dialog('About Brickwright CAD');about.className='about-dialog';
 const native=window.brickwrightDesktopInfo;const intro=el('section');intro.append(el('div','◇'),el('h2','Brickwright CAD'),el('p',`Version ${native?`${native.version} (build ${native.build})`:'0.1.0'} · early preview`),el('p','© 2026 Christian Ströbele · BSD-3-Clause'));
 const links=el('nav');links.append(link('Source repository','https://github.com/CrispStrobe/brickwright-cad'),link('Brickwright-lite','https://github.com/CrispStrobe/brickwright-lite'));intro.append(links);about.append(intro);
 const credits=el('section');credits.append(el('h3','Built with'));
 for(const [name,license,role,url] of [
  ['Three.js','MIT','3D rendering and geometry utilities','https://threejs.org/'],
  ['Manifold','Apache-2.0','Mesh-solid booleans','https://github.com/elalish/manifold'],
  ['Brickwright Jolt fork','MIT','Rigid-body simulation','https://github.com/CrispStrobe/JoltPhysics.js'],
  ['Brickwright-lite','BSD-3-Clause','Touch and transform arithmetic provenance','https://github.com/CrispStrobe/brickwright-lite'],
  ['fflate / qrcode-generator / noble-hashes','MIT','Archives, QR encoding and secure hashes','https://github.com/CrispStrobe/brickwright-cad/blob/main/THIRD-PARTY-NOTICES.md']
 ]){const row=el('p');row.append(link(name,url),document.createTextNode(` · ${license} — ${role}`));credits.append(row);}about.append(credits);
 const notices=el('details'),summary=el('summary','Full license notices'),text=el('pre','');notices.append(summary,text);notices.ontoggle=()=>{if(notices.open&&!text.textContent)void fetch(new URL('../cad-assets/notices.txt',import.meta.url)).then(r=>{if(!r.ok)throw Error('Notices unavailable');return r.text();}).then(value=>text.textContent=value).catch(error=>text.textContent=String(error));};about.append(notices);
 const settings=dialog('Settings');settings.className='settings-dialog';settings.append(el('h2','Project library'));
 const path=el('p');path.className='library-path';const explanation=el('p','Projects and every saved iteration are kept together. On macOS, .bcad files are automatically written to this folder. Keep a backup of the folder.');
 const choose=el('button','Choose library folder…');choose.setAttribute('aria-label','Choose library folder');const status=el('p');status.setAttribute('role','status');
 async function refresh(){const current=await getLibrarySettings();path.textContent=current.path;choose.disabled=!current.native;if(!current.native)explanation.textContent='This host keeps the library in device storage. File → Save project exports an editable .bcad file with every saved iteration. Choosing a filesystem library folder is available in the macOS app.';}
 choose.onclick=()=>{choose.disabled=true;void chooseLibraryFolder().then(async result=>{await refresh();status.textContent=result.canceled?'Folder unchanged.':'Library folder updated. Existing projects and histories were copied.';}).catch(error=>status.textContent=String(error)).finally(()=>{choose.disabled=false;});};settings.append(path,explanation,choose,status);
 const viewTitle=el('h2','Modeling view'),readoutLabel=el('label','Show transform values beside selection'),readout=el('input');readout.type='checkbox';readout.setAttribute('aria-label','Show transform values beside selection');readoutLabel.prepend(readout);readout.onchange=()=>preferences.setReadout(readout.checked);settings.append(viewTitle,readoutLabel);
 document.querySelector('#about')!.addEventListener('click',()=>about.showModal());
 document.querySelector('#settings')!.addEventListener('click',()=>{readout.checked=preferences.getReadout();settings.showModal();void refresh().catch(error=>status.textContent=String(error));});
 document.querySelector('#host-actions')!.addEventListener('click',event=>{if((event.target as HTMLElement).closest('.command-popup button')){const menu=(event.target as HTMLElement).closest('details');if(menu)menu.open=false;}});
}
