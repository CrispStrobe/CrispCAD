// SPDX-License-Identifier: BSD-3-Clause
// Shows that smlibwasm models and writes STEP without its only OFL-1.1 item: the bundled Lato
// font (dist/_fonts.js) is replaced by an empty string through a module hook, the same as a
// bundler alias would do in a product build. Only Text() without an explicit font then fails,
// cleanly, with a FontError. Run: node check-no-font.mjs (prints one JSON line).
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/@classcad/smlibwasm/dist/_fonts.js')) return { format: 'module', source: 'export const LATO_REGULAR = ``;', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const sm = await import('@classcad/smlibwasm');
const rounded = sm.fillet(sm.Box(40, 30, 20).edges(), 3);
const part = sm.shell(rounded, -2, rounded.faces().sortBy(sm.Axis.Z).last);
const step = sm.toStep(part), back = sm.fromStep(step);
let text;
try { sm.Text('A', 10); text = 'built'; } catch (error) { text = `${error.constructor.name}: ${error.message}`; }
console.log(JSON.stringify({ volume: part.volume, stepBytes: step.length, roundTripVolume: back.volume, defaultFontBytes: sm.DEFAULT_FONT?.length ?? null, text }));
