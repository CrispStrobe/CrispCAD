// SPDX-License-Identifier: BSD-3-Clause
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {precisionTracker} from './precision.js';
/** Original input adapter over Three's public control methods. */
export class PrecisionControls extends TransformControls {
 private pointerPrecision?:ReturnType<typeof precisionTracker>;
 private usedFine=false;
 isFine=()=>false;
 gridStep=1;
 private snaps(fine:boolean){this.setTranslationSnap(this.gridStep?(fine?this.gridStep/10:this.gridStep):null);this.setRotationSnap((fine?1:15)*Math.PI/180);this.setScaleSnap(fine?.01:.1);}
 override pointerDown(pointer:PointerEvent|null){this.usedFine=this.isFine();this.snaps(this.usedFine);if(pointer)this.pointerPrecision=precisionTracker([pointer.x,pointer.y]);super.pointerDown(pointer);}
 override pointerMove(pointer:PointerEvent|null){if(pointer&&this.dragging&&this.pointerPrecision){const fine=this.isFine();this.usedFine||=fine;this.snaps(this.usedFine);const [x,y]=this.pointerPrecision.sample([pointer.x,pointer.y],fine);super.pointerMove({...pointer,x,y});}else super.pointerMove(pointer);}
 override pointerUp(pointer:PointerEvent|null){super.pointerUp(pointer);this.pointerPrecision=undefined;this.usedFine=false;this.snaps(this.isFine());}
}
