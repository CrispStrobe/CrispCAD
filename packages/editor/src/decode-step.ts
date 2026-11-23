// SPDX-License-Identifier: BSD-3-Clause
export const maxStepBytes=16*1024*1024;
export type StepMesh={name:string;color:string;positions:Float64Array;indices:Uint32Array};

type StepWasm={
 memory:WebAssembly.Memory;
 step_alloc:(length:number)=>number;
 step_read:(address:number,length:number)=>number;
};

export async function decodeStep(moduleBytes:ArrayBuffer,input:Uint8Array):Promise<StepMesh[]>{
 if(!input.length||input.length>maxStepBytes)throw new Error('STEP input exceeds the file limit or is empty');
 const {instance}=await WebAssembly.instantiate(moduleBytes);
 const wasm=instance.exports as unknown as StepWasm;
 const address=wasm.step_alloc(input.length);
 if(!address)throw new Error('STEP reader could not allocate input');
 new Uint8Array(wasm.memory.buffer,address,input.length).set(input);
 const output=wasm.step_read(address,input.length);
 if(!output)throw new Error('STEP reader returned no result');
 const length=new DataView(wasm.memory.buffer,output,4).getUint32(0,true);
 const view=new DataView(wasm.memory.buffer,output,length);
 let offset=4;
 const number=()=>{const value=view.getUint32(offset,true);offset+=4;return value;};
 const string=(size:number)=>{
  const text=new TextDecoder().decode(new Uint8Array(view.buffer,output+offset,size));
  offset+=size;
  return text;
 };
 if(number()!==0)throw new Error(string(length-offset).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,280));
 const count=number();
 if(!count||count>256)throw new Error('STEP reader returned an invalid part count');
 const meshes:StepMesh[]=[];
 let vertices=0,triangles=0;
 for(let i=0;i<count;i++){
  const name=string(number());
  const color='#'+Array.from({length:3},(_,channel)=>view.getUint8(offset+channel).toString(16).padStart(2,'0')).join('');
  offset+=4;
  const points=number(),faces=number();
  vertices+=points;triangles+=faces;
  if(points<3||faces<1||vertices>250000||triangles>150000)throw new Error('STEP part exceeds the mesh limit or has no faces');
  const positions=Float64Array.from({length:points*3},()=>{
   const value=view.getFloat64(offset,true);offset+=8;
   if(!Number.isFinite(value)||Math.abs(value)>1e6)throw new Error('STEP coordinate is out of range');
   return value;
  });
  const indices=Uint32Array.from({length:faces*3},()=>{
   const index=number();
   if(index>=points)throw new Error('STEP triangle index is out of range');
   return index;
  });
  meshes.push({name,color,positions,indices});
 }
 if(offset!==length)throw new Error('STEP reader returned extra mesh data');
 return meshes;
}
