// SPDX-License-Identifier: BSD-3-Clause
import {isDxfLinetype,isDxfLineweight,isSketchDxfLayer} from '@brickwright/cad-core';
import type {SketchDxfLayerStyle,SketchDxfLinetype} from '@brickwright/cad-core';

export type DxfGroup={code:number;value:string};

function tableRecordFields(groups:readonly DxfGroup[]){
 const records:DxfGroup[][]=[];
 for(const group of groups){
  if(group.code===0)records.push([group]);
  else records.at(-1)?.push(group);
 }
 return records;
}

function dxfNumber(value:string|undefined){
 return value&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)?Number(value):NaN;
}

export function readDxfLayerStyles(groups:readonly DxfGroup[],scale:number){
 const styles=new Map<string,SketchDxfLayerStyle>(),types=new Map<string,SketchDxfLinetype>();
 const records=tableRecordFields(groups);
 for(const [record,...fields] of records){
  if(record.value!=='LTYPE')continue;
  const name=fields.find(group=>group.code===2)?.value;
  if(!name||fields.some(group=>group.code===74&&dxfNumber(group.value)!==0))continue;
  const pattern=fields.filter(group=>group.code===49).map(group=>dxfNumber(group.value)*scale);
  if(dxfNumber(fields.find(group=>group.code===73)?.value)!==pattern.length)continue;
  const type={name,pattern};
  if(isDxfLinetype(type)&&!types.has(name.toUpperCase()))types.set(name.toUpperCase(),type);
 }
 for(const [record,...fields] of records){
  if(record.value!=='LAYER')continue;
  const value=(code:number)=>fields.find(group=>group.code===code)?.value;
  const name=value(2);
  if(!isSketchDxfLayer(name)||styles.has(name.toUpperCase()))continue;
  const style:SketchDxfLayerStyle={};
  const color=dxfNumber(value(62)),rgb=dxfNumber(value(420)),flags=dxfNumber(value(70)),lineweight=dxfNumber(value(370));
  if(Number.isInteger(color)&&Math.abs(color)<=255&&color!==0&&color!==7)style.color=color;
  if(Number.isInteger(rgb)&&rgb>=0&&rgb<=0xffffff)style.trueColor=rgb;
  if(Number.isInteger(flags)&&flags>=0&&flags<=65535&&(flags&7))style.flags=flags&7;
  if(dxfNumber(value(290))===0)style.plot=false;
  if(isDxfLineweight(lineweight)&&lineweight!==-3)style.lineweight=lineweight;
  const type=types.get(value(6)?.toUpperCase()??'');
  if(type)style.linetype=type;
  if(Object.keys(style).length)styles.set(name.toUpperCase(),style);
 }
 return styles;
}
