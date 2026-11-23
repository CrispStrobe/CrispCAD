// SPDX-License-Identifier: BSD-3-Clause
import {dxfRecords} from './dxf-layer-tables.js';
import type {DxfGroup} from './dxf-layer-tables.js';

/** Ignore metadata inside DXF application groups, including reactor owner handles. */
export function dxfEntityFields(groups:DxfGroup[]){
 let depth=0;
 return groups.filter(({code,value})=>{
  if(code===102){
   if(value.startsWith('{'))depth++;
   else if(value==='}'&&depth)depth--;
   return false;
  }
  return depth===0;
 });
}

export function dxfPaperSpaceOwners(tables:DxfGroup[]){
 const owners=new Set<string>();
 for(const [record,...groups] of dxfRecords(tables)){
  if(record.value!=='BLOCK_RECORD')continue;
  const fields=dxfEntityFields(groups);
  const name=fields.find(group=>group.code===2)?.value??'';
  const handle=fields.find(group=>group.code===5)?.value;
  if(handle&&/^\*Paper_Space\d*$/i.test(name))owners.add(handle.toUpperCase());
 }
 return owners;
}

export function isDxfPaperSpace(fields:DxfGroup[],owners:Set<string>){
 // Every positive paper-space marker excludes the entity. Some writers omit
 // group 67, so also check the layout name and the block-record owner.
 return fields.some(({code,value})=>
  code===67&&/^[+]?0*1$/.test(value)||
  code===410&&!!value&&value.toUpperCase()!=='MODEL'||
  code===330&&owners.has(value.toUpperCase()));
}
