// SPDX-License-Identifier: BSD-3-Clause
// Original headless software renderer for agent review: orthographic projection,
// z-buffer, flat Lambert shading in each body's colour, PNG output.
import { zlibSync } from 'fflate';
import type { BodyMesh } from '../kernel.js';

export type RenderView = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom';
export const RENDER_VIEWS: readonly RenderView[] = ['iso', 'top', 'front', 'right', 'back', 'left', 'bottom'];
/** Camera direction (towards the viewer) and screen-up vector, Z-up world. */
const VIEWS: Record<RenderView, { eye: number[]; up: number[] }> = {
  iso: { eye: [1, -1, 0.8], up: [0, 0, 1] }, top: { eye: [0, 0, 1], up: [0, 1, 0] }, bottom: { eye: [0, 0, -1], up: [0, -1, 0] },
  front: { eye: [0, -1, 0], up: [0, 0, 1] }, back: { eye: [0, 1, 0], up: [0, 0, 1] }, right: { eye: [1, 0, 0], up: [0, 0, 1] }, left: { eye: [-1, 0, 0], up: [0, 0, 1] },
};
const norm = (v: number[]) => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rgb(hex: string): number[] { const m = /^#?([0-9a-f]{6})$/i.exec(hex); const n = m ? parseInt(m[1], 16) : 0x9aa7b4; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number { crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function encodePNG(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1); }
  const chunk = (type: string, data: Uint8Array) => { const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer); view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8); view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out; };
  const header = new Uint8Array(13), hv = new DataView(header.buffer); hv.setUint32(0, width); hv.setUint32(4, height); header.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { png.set(p, o); o += p.length; } return png;
}

/** Render solid bodies (references drawn translucent-free in grey) to a PNG. */
export function renderBodies(bodies: readonly BodyMesh[], view: RenderView = 'iso', size = 512): Uint8Array {
  if (!RENDER_VIEWS.includes(view)) throw new RangeError('Unknown render view');
  if (!Number.isInteger(size) || size < 64 || size > 1024) throw new RangeError('Render size must be an integer from 64 to 1024');
  const { eye, up } = VIEWS[view], d = norm(eye), right = norm(cross(up, d)), screenUp = cross(d, right), light = norm([0.4, -0.6, 1]);
  const drawn = bodies.filter(b => !b.hole && b.indices.length);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const b of drawn) for (let i = 0; i < b.positions.length; i += 3) { const p = [b.positions[i], b.positions[i + 1], b.positions[i + 2]], u = dot(p, right), v = dot(p, screenUp); minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
  const rgba = new Uint8Array(size * size * 4), depth = new Float64Array(size * size).fill(-Infinity);
  for (let i = 0; i < size * size; i++) rgba.set([238, 242, 247, 255], i * 4);
  if (!drawn.length) return encodePNG(size, size, rgba);
  const span = Math.max(maxU - minU, maxV - minV, 1e-9), scale = size * 0.9 / span, cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  for (const b of drawn) {
    const base = b.reference ? [150, 150, 150] : rgb(b.color), P = b.positions, I = b.indices;
    for (let t = 0; t < I.length; t += 3) {
      const tri = [I[t], I[t + 1], I[t + 2]].map(k => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
      const n = norm(cross(tri[1].map((x, i) => x - tri[0][i]), tri[2].map((x, i) => x - tri[0][i])));
      if (!n.every(Number.isFinite) || dot(n, d) <= 0) continue; // back face
      const shade = 0.35 + 0.65 * Math.max(0, dot(n, light)), colour = base.map(c => Math.min(255, Math.round(c * shade)));
      const s = tri.map(p => [size / 2 + (dot(p, right) - cu) * scale, size / 2 - (dot(p, screenUp) - cv) * scale, dot(p, d)]);
      const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
      if (Math.abs(area) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area, w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area, w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const z = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2], k = y * size + x;
        if (z <= depth[k]) continue;
        depth[k] = z; rgba.set([colour[0], colour[1], colour[2], 255], k * 4);
      }
    }
  }
  return encodePNG(size, size, rgba);
}
