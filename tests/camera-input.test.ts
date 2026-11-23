// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {cameraPointerAction,cameraWheelAction} from '../packages/editor/src/camera-input.js';
const wheel={deltaX:0,deltaY:12,deltaMode:0,ctrlKey:false,shiftKey:false,altKey:false};
it('maps native and browser pinch, scroll, trackpad, pan and orbit without double application',()=>{
 expect(cameraWheelAction(wheel,'tinkercad',800)?.kind).toBe('zoom');expect(cameraWheelAction({...wheel,shiftKey:true},'tinkercad',800)?.kind).toBe('pan');expect(cameraWheelAction({...wheel,altKey:true},'tinkercad',800)?.kind).toBe('orbit');expect(cameraWheelAction(wheel,'fusion',800)?.kind).toBe('pan');expect(cameraWheelAction({...wheel,shiftKey:true},'fusion',800)?.kind).toBe('orbit');expect(cameraWheelAction({...wheel,ctrlKey:true},'fusion',800)?.kind).toBe('zoom');expect(cameraWheelAction({...wheel,precise:false},'fusion',800)?.kind).toBe('zoom');expect(cameraWheelAction({...wheel,deltaMode:1,deltaY:1},'tinkercad',800)?.dy).toBe(16);
 expect(cameraWheelAction({...wheel,deltaY:NaN},'tinkercad',800)).toBeUndefined();
});
it('keeps plain object selection separate from camera pointer combinations',()=>{
 expect(cameraPointerAction(0,false,false,false,false,'tinkercad')).toBeUndefined();expect(cameraPointerAction(0,false,false,false,true,'tinkercad')).toBe('pan');expect(cameraPointerAction(0,false,true,false,false,'tinkercad')).toBe('orbit');expect(cameraPointerAction(2,false,false,false,false,'tinkercad')).toBe('orbit');expect(cameraPointerAction(2,true,false,false,false,'tinkercad')).toBe('pan');expect(cameraPointerAction(1,true,false,false,false,'fusion')).toBe('orbit');
});

it('uses the embedded host mapping for the two-finger slide and secondary drag',()=>{
 const gestures={trackpadSlide:'pan',secondaryDrag:'orbit'} as const;
 expect(cameraWheelAction(wheel,'tinkercad',800,gestures)).toMatchObject({kind:'pan',dy:-12});
 expect(cameraWheelAction({...wheel,precise:false},'fusion',800,gestures)?.kind).toBe('zoom');
 expect(cameraWheelAction({...wheel,deltaY:75,precise:true,shiftKey:true},'fusion',800,gestures)?.kind).toBe('orbit');
 expect(cameraWheelAction({...wheel,ctrlKey:true},'fusion',800,{...gestures,trackpadSlide:'orbit'})?.factor).toBeLessThan(1);
 expect(cameraWheelAction(wheel,'fusion',800,{...gestures,trackpadSlide:'zoom'})?.kind).toBe('zoom');
 expect(cameraPointerAction(2,false,false,false,false,'tinkercad',{...gestures,secondaryDrag:'pan'})).toBe('pan');
 expect(cameraPointerAction(2,true,false,false,false,'tinkercad',{...gestures,secondaryDrag:'pan'})).toBe('orbit');
});
