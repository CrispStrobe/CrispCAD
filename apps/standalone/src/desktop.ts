// SPDX-License-Identifier: BSD-3-Clause
import type {CadEditor,CadCommand,CadCommandState} from '@brickwright/cad-editor';
const commands=new Set<CadCommand>(['new','open','save','import','export','undo','redo','cut','copy','paste','duplicate','delete','select-all','deselect','select','move','rotate','scale','home','fit','top','front','right','back','left','bottom','projection','workplane','objects','properties','drop','parameters','shapes','union','subtract','intersect']);
export function mountDesktopHost(getEditor:()=>CadEditor|undefined,actions:Record<string,()=>void>){
 const handler=window.brickwrightDesktop?window.webkit?.messageHandlers.cadHost:undefined;
 const send=async<T>(action:string,data?:string,mode?:string)=>{if(!handler)throw new Error('Native host unavailable');return await handler.postMessage({action,...(data===undefined?{}:{data}),...(mode===undefined?{}:{mode})}) as T;};
 let lastState:CadCommandState|undefined;
 function context(){let active:Element|null=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;const editingText=active instanceof HTMLTextAreaElement||active instanceof HTMLInputElement&&!['checkbox','color','file','button','range'].includes(active.type)||(active instanceof HTMLElement&&active.isContentEditable)||!!window.getSelection()?.toString();const modalOpen=!!document.querySelector('dialog[open]')||!!document.querySelector('#cad-root')?.shadowRoot?.querySelector('dialog[open]');return {editingText,modalOpen};}
 function publish(state?:CadCommandState){if(state)lastState=state;if(handler&&lastState)void send('state',JSON.stringify({...lastState,...context()})).catch(()=>{});}
 if(handler){
  window.brickwrightExecuteCommand=async command=>{
   const editor=getEditor();if(!editor)throw new Error('The editor is still opening');
   try{if(Object.hasOwn(actions,command)){actions[command]();return;}if(!commands.has(command as CadCommand))throw new Error('Unknown app command');if(context().modalOpen)throw new Error('Close the current dialog to use this command');
    let active:Element|null=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;if(active instanceof HTMLElement)active.blur();
    await editor.executeCommand(command as CadCommand);
   }catch(error){editor.setStatus(error instanceof Error?error.message:String(error));throw error;}finally{publish(editor.commandState);}
  };
  window.brickwrightReceiveFile=async(name,data)=>{const editor=getEditor();if(!editor)throw new Error('The editor is still opening');await editor.openFile(name,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));publish(editor.commandState);};
  document.addEventListener('focusin',()=>publish(),true);document.addEventListener('focusout',()=>queueMicrotask(()=>publish()),true);
 }
 return {
  available:!!handler,publish,
  async open(mode:'project'|'geometry'){const file=await send<{name:string;data:string}|null>('open',undefined,mode);return file?{name:file.name,bytes:Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))}:null;},
  readClipboard:()=>send<string|null>('clipboard-read'),
  async writeClipboard(text:string){await send('clipboard-write',text);},
 };
}
