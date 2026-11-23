// SPDX-License-Identifier: BSD-3-Clause
import {cameraPointerIntent,cameraTrackpadWheel} from './vendor/camera-pointer.js';
export type NavigationPreset='tinkercad'|'fusion';
export interface CameraGestures {
 trackpadSlide:'pan'|'orbit'|'zoom';
 secondaryDrag:'pan'|'orbit';
}
export interface CameraWheel {deltaX:number;deltaY:number;deltaMode:number;ctrlKey:boolean;shiftKey:boolean;altKey:boolean;precise?:boolean}
export function cameraWheelAction(event:CameraWheel,preset:NavigationPreset,height:number,gestures?:CameraGestures){
 if(gestures){
  const action=cameraTrackpadWheel(event,gestures.trackpadSlide,height);
  if(!action)return undefined;
  return {kind:action.kind,dx:-action.dx,dy:-action.dy,factor:Math.exp(-action.dy*(event.ctrlKey?.01:.002))} as const;
 }
 const unit=event.deltaMode===1?16:event.deltaMode===2?height:1;
 const dx=Math.max(-1000,Math.min(1000,event.deltaX*unit)),dy=Math.max(-1000,Math.min(1000,event.deltaY*unit));
 if(!Number.isFinite(dx)||!Number.isFinite(dy))return undefined;
 const precise=event.precise??(event.deltaMode===0&&(dx!==0||Math.abs(dy)<50||!Number.isInteger(dy)));
 const kind=event.ctrlKey?'zoom':event.altKey?'orbit':preset==='fusion'&&precise?(event.shiftKey?'orbit':'pan'):event.shiftKey?'pan':'zoom';
 return {kind,dx,dy,factor:Math.exp(-dy*(event.ctrlKey?.01:.002))} as const;
}
export function cameraPointerAction(button:number,shift:boolean,alt:boolean,ctrl:boolean,space:boolean,preset:NavigationPreset,gestures?:CameraGestures){
 return cameraPointerIntent({button,shiftKey:shift,altKey:alt,ctrlKey:ctrl},preset,space,gestures?.secondaryDrag);
}
