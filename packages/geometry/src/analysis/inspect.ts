// SPDX-License-Identifier: BSD-3-Clause
import type { BodyMesh } from '../kernel.js';
import { checkMeshTopology, type MeshTopologyCheck } from './printability.js';

export interface BodyInspection {
  id: string; name: string; color: string; triangles: number;
  volumeMm3: number; surfaceAreaMm2: number;
  boundsMm: { min: number[]; max: number[] }; sizeMm: number[];
  /** Volume centroid of the closed mesh (uniform density). */
  centroidMm: number[];
  topology: MeshTopologyCheck;
}

/** Exact mesh measurements of evaluated bodies (signed tetrahedra about the origin). */
export function inspectBodies(bodies: readonly BodyMesh[]): BodyInspection[] {
  return bodies.filter(b => !b.reference && !b.hole).map(body => {
    const P = body.positions, I = body.indices;
    let volume = 0, area = 0; const moment = [0, 0, 0];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
      const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      volume += v; moment[0] += v * (ax + bx + cx) / 4; moment[1] += v * (ay + by + cy) / 4; moment[2] += v * (az + bz + cz) / 4;
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    }
    const topology = checkMeshTopology({ vertices: P, triangles: I });
    return {
      id: body.id, name: body.name, color: body.color, triangles: I.length / 3,
      volumeMm3: volume, surfaceAreaMm2: area, boundsMm: { min: [...body.bounds.min], max: [...body.bounds.max] },
      sizeMm: body.bounds.max.map((v, i) => v - body.bounds.min[i]),
      centroidMm: Math.abs(volume) > 1e-12 ? moment.map(m => m / volume) : body.bounds.min.map((v, i) => (v + body.bounds.max[i]) / 2),
      topology,
    };
  });
}
