// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
export function createSimulationVideo(canvas:HTMLCanvasElement,deliver:(file:{name:string;bytes:Uint8Array;mime:string})=>unknown,changed:()=>void,fail:(error:unknown)=>void){
 let recorder:MediaRecorder|undefined,stream:MediaStream|undefined,timer:ReturnType<typeof setTimeout>|undefined,disposed=false,chunks:Blob[]=[],bytes=0,overflow=false,stopping=false;
 const mime=typeof MediaRecorder==='undefined'?undefined:['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
 let surface:HTMLCanvasElement|undefined;
 const capture=()=>{if(surface){surface.getContext('2d')?.drawImage(canvas,0,0,surface.width,surface.height);const track=stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack|undefined;track?.requestFrame?.();}};
 const stopTracks=()=>{canvas.removeEventListener('brickwright-simulation-frame',capture);surface=undefined;delete canvas.dataset.simulationRecording;clearTimeout(timer);timer=undefined;for(const track of stream?.getTracks()??[])track.stop();stream=undefined;};
 return {
  get available(){return !!mime&&typeof canvas.captureStream==='function';},get recording(){return !!recorder&&(recorder.state!=='inactive'||stopping);},
  start(){if(disposed||!mime||typeof canvas.captureStream!=='function')throw new Error(t('Video recording is unavailable on this device'));if(recorder&&(recorder.state!=='inactive'||stopping))return;
   chunks=[];bytes=0;overflow=false;stopping=false;canvas.dataset.simulationRecording='true';surface=document.createElement('canvas');const scale=Math.min(1,1920/canvas.width,1080/canvas.height);surface.width=Math.max(1,Math.round(canvas.width*scale));surface.height=Math.max(1,Math.round(canvas.height*scale));canvas.addEventListener('brickwright-simulation-frame',capture);canvas.dispatchEvent(new Event('brickwright-simulation-capture'));stream=surface.captureStream(0);const current=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});recorder=current;
   current.ondataavailable=event=>{if(disposed||!event.data.size)return;bytes+=event.data.size;if(bytes>64*1024*1024){overflow=true;if(current.state!=='inactive')current.stop();return;}chunks.push(event.data);};
   current.onerror=()=>{stopTracks();if(!disposed)fail(new Error(t('Video recording failed')));};
   current.onstop=()=>{stopping=false;stopTracks();if(disposed){chunks=[];return;}changed();if(overflow){chunks=[];fail(new Error(t('Video exceeds 64 MiB; record a shorter run')));return;}const parts=chunks;chunks=[];if(!parts.length)return;const actual=current.mimeType||mime;void new Blob(parts,{type:actual}).arrayBuffer().then(data=>{if(!disposed)return deliver({name:actual.startsWith('video/mp4')?'simulation.mp4':'simulation.webm',bytes:new Uint8Array(data),mime:actual});}).catch(fail);};
   current.start(500);canvas.dispatchEvent(new Event('brickwright-simulation-capture'));timer=setTimeout(()=>{if(current.state!=='inactive')current.stop();},30000);changed();
  },
  stop(){if(recorder&&recorder.state!=='inactive'){stopping=true;recorder.stop();}},
  dispose(){disposed=true;clearTimeout(timer);if(recorder&&recorder.state!=='inactive')recorder.stop();stopTracks();chunks=[];}
 };
}
