// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {precisionTracker} from '../packages/editor/src/precision.js';
it('integrates precision transitions without jumping or changing prior travel',()=>{
 const tracker=precisionTracker([0,0]);expect(tracker.sample([10,-20],false)).toEqual([10,-20]);expect(tracker.sample([20,-30],true)).toEqual([11,-21]);expect(tracker.sample([20,-30],false)).toEqual([11,-21]);expect(tracker.sample([25,-25],false)).toEqual([16,-16]);expect(tracker.sample([15,-15],true)).toEqual([15,-15]);
});
