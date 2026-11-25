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

it('finds commands by their registry aliases without changing labels or order',async()=>{
 const {paletteCommands}=await import('../packages/editor/src/command-palette.js');
 const find=(query:string)=>findPaletteCommands(paletteCommands,query).map(entry=>entry.command);
 expect(paletteCommands.find(entry=>entry.command==='delete')).toMatchObject({label:'Delete',aliases:['erase','del']});
 expect(find('erase')).toEqual(['delete']);
 expect(find('del')[0]).toBe('delete');
 expect(find('dup')).toEqual(['duplicate']);
 expect(find('zoom')).toEqual(['fit']);
 expect(find('join')[0]).toBe('union');
 expect(find('sel')).toContain('select');
 // An alias that is the whole query ranks like a label prefix; aliases need a prefix match.
 expect(findPaletteCommands([{label:'Remove things',aliases:['rm']},{label:'Armchair'}],'rm').map(entry=>entry.label)).toEqual(['Remove things','Armchair']);
 expect(findPaletteCommands([{label:'Undo',aliases:['u']}],'ndo').map(entry=>entry.label)).toEqual(['Undo']);
 expect(findPaletteCommands([{label:'Fit',aliases:['zoom']}],'oom')).toEqual([]);
 expect(paletteCommands.map(entry=>entry.label).slice(0,3)).toEqual(['Find a shape','Model library','Sketch & extrude']);
});
