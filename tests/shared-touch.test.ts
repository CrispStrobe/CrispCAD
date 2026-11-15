// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {createTouchTracker} from '../packages/editor/src/vendor/touch-gestures.js';
it('replacing a pinch finger resets the baseline without a camera jump',()=>{
 const tracker=createTouchTracker();
 tracker.down({id:1,x:0,y:0,t:0});tracker.down({id:2,x:10,y:0,t:1});tracker.down({id:3,x:110,y:0,t:2});
 tracker.up({id:1,t:3});
 expect(tracker.move({id:2,x:10,y:0,t:4})).toMatchObject({type:'pinch',scale:1,pan:[0,0]});
 expect(tracker.move({id:3,x:120,y:0,t:5})).toMatchObject({type:'pinch',scale:1.1,pan:[5,0]});
 tracker.up({id:3,t:6});tracker.up({id:2,t:7});expect(tracker.kind).toBe('idle');
});
