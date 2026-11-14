// SPDX-License-Identifier: BSD-3-Clause
/** Stable identifiers are evidence categories, not certification of source fidelity. */
export interface ConversionNotice{id:string;message:string}
export const conversionGapIds=Object.freeze([
 'scad.animation.default-time','scad.text.font','scad.text.number-format','scad.random.sequence','scad.arguments.ignored','scad.module.arguments-ignored','scad.parameters.strings','scad.appearance.colours','scad.preview.highlight','scad.console.echo','scad.polygon.empty-input','scad.assert.message',
 'jscad.parameters.snapshot','jscad.extrusion.tessellation','jscad.outputs.combined','jscad.appearance.face-colours'
] as const);

export function getCodeImportNotices(program:{source:string}):ConversionNotice[]{const result:ConversionNotice[]=[];for(const line of program.source.split('\n'))if(line.startsWith('// Import notice: ')){try{const value=JSON.parse(line.slice(18));if(value&&typeof value.id==='string'&&/^[a-z][a-z0-9.-]{0,95}$/.test(value.id)&&typeof value.message==='string'&&value.message.length<=8192)result.push({id:value.id,message:value.message});}catch{}}return result;}
