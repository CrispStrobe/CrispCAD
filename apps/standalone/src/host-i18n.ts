// SPDX-License-Identifier: BSD-3-Clause
import {getLocale,t} from '@brickwright/cad-core';
/** Translate static host markup while leaving controls, URLs and project data intact. */
export function localizeHost(){
 document.documentElement.lang=getLocale();
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 const nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
 for(const node of nodes){if(node.parentElement?.closest('script,style'))continue;const value=node.data.trim();if(value)node.data=node.data.replace(value,t(value));}
 document.querySelectorAll('[aria-label],[placeholder],[title]').forEach(node=>{for(const attr of ['aria-label','placeholder','title']){const value=node.getAttribute(attr);if(value)node.setAttribute(attr,t(value));}});
}
