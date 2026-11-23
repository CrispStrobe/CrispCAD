// SPDX-License-Identifier: BSD-3-Clause
import {ACadVersion,CadDocument,Circle,Color,DwgWriter,Layer,LineType,LineTypeSegment,LwPolyline,LwPolylineVertex,NotificationType,UnitsType,XY,XYZ} from '@node-projects/acad-ts';
import {constantDxfWidth} from '@brickwright/cad-core';
import type {SketchExchange} from './sketch-exchange.js';
import {maxSketchExchangeBytes} from './sketch-exchange-limits.js';

export function encodeSketchDwg({layers,entities}:SketchExchange):ArrayBuffer{
 const doc=new CadDocument();
 const {header,modelSpace,layers:layerTable,lineTypes:linetypeTable}=doc;
 if(!header||!modelSpace||!layerTable||!linetypeTable)throw new Error('DWG drawing tables are missing');
 header.version=ACadVersion.AC1032;
 header.insUnits=UnitsType.Millimeters;
 const byName=new Map<string,Layer>();
 const linetypes=new Map<string,LineType>();
 for(const {name,style} of layers){
  const layer=name==='0'?layerTable.get('0'):new Layer(name);
  if(style){
   layer.color=style.trueColor===undefined?new Color(Math.abs(style.color??7)):Color.fromTrueColor(style.trueColor);
   layer.isOn=(style.color??7)>0;
   if(style.flags!==undefined)layer.layerFlags=style.flags;
   if(style.plot!==undefined)layer.plotFlag=style.plot;
   if(style.lineweight!==undefined)layer.lineWeight=style.lineweight;
   if(style.linetype){
    const key=style.linetype.name.toUpperCase();
    let type=linetypes.get(key);
    if(!type){
     type=new LineType(style.linetype.name);
     for(const length of style.linetype.pattern){
      const segment=new LineTypeSegment();
      segment.length=length;
      type.addSegment(segment);
     }
     linetypeTable.add(type);
     linetypes.set(key,type);
    }
    layer.lineType=type;
   }
  }
  if(name!=='0')layerTable.add(layer);
  byName.set(name,layer);
 }
 for(const shape of entities){
  const layer=byName.get(shape.layer)!;
  if(shape.kind==='circle'){
   const circle=new Circle();
   circle.center=new XYZ(...shape.center,0);
   circle.radius=shape.radius;
   circle.layer=layer;
   modelSpace.entities.add(circle);
   continue;
  }
  const constant=shape.widths?constantDxfWidth(shape.widths,shape.closed):undefined;
  const polyline=new LwPolyline(shape.points.map(([x,y],index)=>{
   const point=new LwPolylineVertex(new XY(x,y));
   point.bulge=shape.bulges?.[index]??0;
   if(shape.widths&&!constant)[point.startWidth,point.endWidth]=shape.widths[index];
   return point;
  }));
  polyline.isClosed=shape.closed;
  if(constant)polyline.constantWidth=constant;
  polyline.layer=layer;
  modelSpace.entities.add(polyline);
 }
 const bytes=DwgWriter.writeToBuffer(doc,null,(_sender,event)=>{
  if(event.notificationType===NotificationType.Error||event.notificationType===NotificationType.NotSupported||
     event.notificationType===NotificationType.NotImplemented)throw new Error(event.message);
 });
 if(bytes.byteLength>maxSketchExchangeBytes)throw new Error('DWG exceeds the sketch exchange limit');
 return new Uint8Array(bytes).buffer;
}
