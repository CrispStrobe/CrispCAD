// SPDX-License-Identifier: BSD-3-Clause
import type {Vec3} from '@brickwright/cad-core';
import type {CadCommand} from './index.js';
import {paletteCommands} from './command-palette.js';
import type {PaletteContext} from './command-palette.js';

type Entry={name:string;command?:CadCommand;requires?:keyof PaletteContext;aliases?:readonly string[]};
const extra:Entry[]=[
  {name:'help',aliases:['?']},{name:'clear',aliases:['cls']},{name:'list',aliases:['ls']},
  {name:'box',aliases:['b']},{name:'move',aliases:['m','translate']},{name:'apply-edit'},
  {name:'new',command:'new'},{name:'open',command:'open'},{name:'save',command:'save'},
  {name:'import',command:'import'},{name:'printability',command:'printability'},
  {name:'robot-projects',command:'robot-projects'},{name:'command-palette',command:'command-palette'}
];
const aliases:Partial<Record<CadCommand,string[]>>={
  undo:['u'],redo:['re'],delete:['erase','del'],duplicate:['dup'],sketch:['extrude'],
  'sketch-path':['path'],deselect:['none'],'select-all':['all'],code:['script'],'model-source':['source'],
  fit:['zoom-fit'],union:['join']
};
export const terminalCommands:readonly Entry[]=[
  ...extra,...paletteCommands.map(entry=>({name:entry.command==='move'?'move-tool':entry.command,command:entry.command,requires:entry.requires,aliases:aliases[entry.command]}))
];
export function splitTerminalInput(input:string){
  const match=/^(\S+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  return {name:match?.[1].toLowerCase()??'',args:match?.[2]?.trim()??''};
}
export function resolveTerminalCommand(name:string){
  const key=name.toLowerCase();
  return terminalCommands.find(entry=>entry.name===key||entry.aliases?.includes(key));
}
export function terminalCompletions(prefix:string,context?:PaletteContext){
  const key=prefix.toLowerCase();
  return terminalCommands.filter(entry=>!context||!entry.requires||context[entry.requires])
    .filter(entry=>entry.name.startsWith(key)||entry.aliases?.some(alias=>alias.startsWith(key)))
    .map(entry=>entry.name);
}
const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const number=(text:string)=>{
  const value=text.trim();
  if(!decimal.test(value)||!Number.isFinite(Number(value)))throw new Error('Enter finite decimal coordinates in millimetres.');
  return Number(value);
};
export function parseTerminalBox(text:string):Vec3{
  const values=text.split(',').map(number);
  if(values.length!==3||values.some(v=>v<.01||v>100000))throw new Error('Box dimensions must be width,depth,height (0.01–100000 mm).');
  return values as Vec3;
}
/** Coordinates are in the model's world XY/Z system, not camera space.
 * An omitted Z preserves the reference height; relative inputs use that reference. */
export function parseTerminalPoint(text:string,reference:Vec3):Vec3{
  const trimmed=text.trim(),relative=trimmed.startsWith('@'),body=relative?trimmed.slice(1):trimmed;
  let coords:number[];
  if(body.includes('<')){
    const parts=body.split('<');
    if(parts.length!==2)throw new Error('Enter polar coordinates as distance<angle in degrees.');
    const distance=number(parts[0]),angle=number(parts[1])*Math.PI/180;
    if(distance<0)throw new Error('Polar distance must be nonnegative.');
    coords=[distance*Math.cos(angle),distance*Math.sin(angle)];
  }else coords=body.split(',').map(number);
  if(coords.length!==2&&coords.length!==3)throw new Error('Enter X,Y or X,Y,Z.');
  const result:Vec3=[coords[0]+(relative?reference[0]:0),coords[1]+(relative?reference[1]:0),coords.length===3?coords[2]+(relative?reference[2]:0):reference[2]];
  if(result.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))throw new Error('Point is outside the model coordinate range.');
  return result;
}
