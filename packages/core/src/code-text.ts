// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
export interface TextScalar{text:string;at:number}
export interface CodeTextAst{parts:(string|TextScalar)[];scad:boolean}
interface Parser{peek():string|undefined;take():{text:string;at:number};expect(value:string):unknown;scalar(stops:string[]):TextScalar;fail(message:string,at?:number):never;limited(message:string,at?:number):never}
export function parseCodeText(p:Parser):CodeTextAst{
 const token=p.peek(),formatted=token==='formatText'||token==='formatSCAD',parts:(string|TextScalar)[]=[];if(formatted){p.take();p.expect('(');if(p.peek()===')'){p.take();return {parts,scad:token==='formatSCAD'};}}
 do{if(p.peek()?.startsWith('"')){const token=p.take();let value:unknown;try{value=JSON.parse(token.text);}catch{p.fail(t('Expected a text literal'),token.at);}if(typeof value!=='string')p.fail(t('Expected a text literal'),token.at);parts.push(value as string);}else if(formatted)parts.push(p.scalar([',',')']));else p.fail(t('Expected a text literal'));if(parts.length>256)p.limited(t('Text construction budget exceeded'));if(!formatted||p.peek()!==',')break;p.expect(',');}while(p.peek()!==')');if(formatted)p.expect(')');return {parts,scad:token==='formatSCAD'};
}
export const resolveCodeText=(text:CodeTextAst,format:(s:TextScalar,scad?:boolean)=>string)=>text.parts.map(part=>typeof part==='string'?part:format(part,text.scad)).join('');
