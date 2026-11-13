// SPDX-License-Identifier: BSD-3-Clause
import {messages as additions} from './locales/de-about-precision.js';
import {messages as history} from './locales/de-history.js';
import {messages as workbench} from './locales/de-workbench.js';
import {messages as editor} from './locales/de-editor.js';
import {messages as diagnostics} from './locales/de-diagnostics.js';
import {messages as readout} from './locales/de-readout.js';
import {messages as mcp} from './locales/de-mcp.js';
import {messages as host} from './locales/de-host.js';
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
 const translated=locale==='de'?(additions[key]??editor[key]??diagnostics[key]??host[key]??readout[key]??mcp[key]??workbench[key]??history[key]??key):key;
 return typeof message==='string'?translated:translated.replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)]));
}
/** Locale-specific display only. Saved model values and source use canonical syntax. */
export const formatNumber=(value:number,options?:Intl.NumberFormatOptions)=>new Intl.NumberFormat(locale,options).format(value);
