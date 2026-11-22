// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {findPaletteCommands} from '../packages/editor/src/command-palette.js';

it('matches words across labels and aliases, preserving rank and ignoring accents and case',()=>{
 const entries=[
  {label:'Edit pattern',alias:'bolt circle'},
  {label:'Pattern body',alias:'circular bolt circle'},
  {label:'Pattern'},
  {label:'Fläche spiegeln',alias:'mirror surface'}
 ];
 const labels=(query:string)=>findPaletteCommands(entries,query).map(entry=>entry.label);
 expect(labels('pattern')).toEqual(['Pattern','Pattern body','Edit pattern']);
 expect(labels('CiRcLe edit')).toEqual(['Edit pattern']);
 expect(labels('flache MIRROR')).toEqual(['Fläche spiegeln']);
 expect(labels('circle missing')).toEqual([]);
 expect(labels('  ')).toEqual(entries.map(entry=>entry.label));
});
