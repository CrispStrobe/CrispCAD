// SPDX-License-Identifier: BSD-3-Clause
import {transformWithEsbuild} from 'vite';
import type {Plugin} from 'vite';

export function preserveDwgClassNames():Plugin{
 return {
  name:'preserve-dwg-class-names',
  enforce:'pre',
  transform(code,id){
   // The codec resolves DXF schemas using constructor.name at runtime.
   if(!id.includes('/@node-projects/acad-ts/')||!id.endsWith('.js'))return;
   return transformWithEsbuild(code,id,{loader:'js',target:'esnext',keepNames:true});
  }
 };
}
