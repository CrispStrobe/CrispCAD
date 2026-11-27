import {messages as simlab} from './locales/de-simlab.js';
// SPDX-License-Identifier: BSD-3-Clause
import {messages as engineWorkflows} from './locales/de-engine-workflows.js';
import {messages as modelSource} from './locales/de-model-source.js';
import {messages as modelLibrary} from './locales/de-model-library.js';
import {messages as converters} from './locales/de-converters.js';
import {messages as additions} from './locales/de-about-precision.js';
import {messages as history} from './locales/de-history.js';
import {messages as workbench} from './locales/de-workbench.js';
import {messages as editor} from './locales/de-editor.js';
import {messages as diagnostics} from './locales/de-diagnostics.js';
import {messages as readout} from './locales/de-readout.js';
import {messages as terminal} from './locales/de-terminal.js';
import {messages as mcp} from './locales/de-mcp.js';
import {messages as host} from './locales/de-host.js';
import {messages as adafruit} from './locales/de-adafruit.js';
import {messages as simulation} from './locales/de-simulation.js';
import {messages as blocks} from './locales/de-blocks.js';
import {messages as printability} from './locales/de-printability.js';
import {messages as gears} from './locales/de-gears.js';
import {messages as kcad} from './locales/de-kcad.js';
import {messages as commands} from './locales/de-commands.js';
import {messages as exactKernel} from './locales/de-exact.js';
import {messages as exactFeatures} from './locales/de-exact-features.js';
import {messages as exactEdges} from './locales/de-exact-edges.js';
import {messages as stepImport} from './locales/de-step-import.js';
import {messages as exactDrawings} from './locales/de-exact-drawings.js';
import {messages as fastening} from './locales/de-fastening.js';
import {messages as editorMenu} from './locales/de-editor-menu.js';
export type Locale='en'|'de';
export const supportedLocales=Object.freeze([{code:'en' as const,name:'English'},{code:'de' as const,name:'Deutsch'}]);
let locale:Locale='en';
export const getLocale=():Locale=>locale;
export function setLocale(value:string):Locale {locale=value.toLowerCase().split(/[-_]/)[0]==='de'?'de':'en';return locale;}
/** English source keys; tagged templates preserve typed/user values verbatim. */
export function t(message:string):string;
export function t(parts:TemplateStringsArray,...values:unknown[]):string;
export function t(message:string|TemplateStringsArray,...values:unknown[]):string {
 const key=typeof message==='string'?message:message.reduce((s,part,i)=>s+(i?`{${i-1}}`:'')+part,'');
 const translated=locale==='de'?(blocks[key]??printability[key]??gears[key]??kcad[key]??simlab[key]??adafruit[key]??simulation[key]??engineWorkflows[key]??modelSource[key]??converters[key]??modelLibrary[key]??additions[key]??editor[key]??diagnostics[key]??host[key]??readout[key]??terminal[key]??commands[key]??mcp[key]??workbench[key]??history[key]??exactKernel[key]??exactFeatures[key]??exactEdges[key]??stepImport[key]??exactDrawings[key]??editorMenu[key]??fastening[key]??key):key;
 return typeof message==='string'?translated:translated.replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)]));
}
/** Locale-specific display only. Saved model values and source use canonical syntax. */
export const formatNumber=(value:number,options?:Intl.NumberFormatOptions)=>new Intl.NumberFormat(locale,options).format(value);
