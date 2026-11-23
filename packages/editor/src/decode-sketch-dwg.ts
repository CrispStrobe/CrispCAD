// SPDX-License-Identifier: BSD-3-Clause
import {ACadVersion,DwgReader,DwgReaderConfiguration,DxfWriter,DxfWriterConfiguration,NotificationType} from '@node-projects/acad-ts';
import {maxSketchExchangeBytes} from './sketch-exchange-limits.js';

export function decodeSketchDwg(buffer:ArrayBuffer):string{
 if(buffer.byteLength>maxSketchExchangeBytes||
    !/^AC10[0-9]{2}$/.test(new TextDecoder().decode(buffer.slice(0,6)))){
  throw new Error('Invalid DWG header or file size');
 }
 const requireSupported=(event:{notificationType:NotificationType;message:string})=>{
  if(event.notificationType===NotificationType.Error||
     event.notificationType===NotificationType.NotSupported||
     event.notificationType===NotificationType.NotImplemented||
     /read as an UnknownEntity$|not found in classes dictionary\.$/.test(event.message))throw new Error(event.message);
 };
 const config=new DwgReaderConfiguration();
 config.failsafe=false;
 config.readSummaryInfo=false;
 const document=DwgReader.readFromStreamWithConfig(buffer,config,(_sender,event)=>requireSupported(event));
 // Normalize the container for the shared text DXF sketch parser. Model
 // coordinates, insertion units and model/paper ownership stay in the document.
 if(!document.header)throw new Error('DWG header is missing');
 document.header.version=ACadVersion.AC1032;
 const output:string[]=[];
 let length=0;
 const writer=new DxfWriterConfiguration();
 writer.updateDimensionsInBlocks=false;
 writer.updateDimensionsInModel=false;
 DxfWriter.writeToStream({write(chunk:string){
  length+=chunk.length;
  if(length>maxSketchExchangeBytes)throw new Error('Decoded DWG exceeds sketch exchange limit');
  output.push(chunk);
 }},document,false,writer,(_sender,event)=>{
  // The DXF writer reports presentation objects such as VisualStyle in
  // OBJECTS. They do not contribute to the supported sketch entities.
  if(event.notificationType===NotificationType.NotImplemented&&event.message.startsWith('Object not implemented : '))return;
  requireSupported(event);
 });
 return output.join('');
}
