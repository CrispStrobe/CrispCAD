// SPDX-License-Identifier: BSD-3-Clause
// The measures the multi-material inspection needs from the evaluated meshes (Phase 6.5; the
// report itself is core's `inspectMaterials`): each printable body's volume, and the volume shared
// by pairs of bodies (Manifold intersections, bounding-box prefiltered; up to 64 bodies).
import type {MaterialOverlap,MaterialVolume} from '@brickwright/cad-core';
import type {BodyMesh,GeometryKernel} from '../kernel.js';

/** Overlaps are measured for at most this many bodies (as the interference check). */
export const MAX_OVERLAP_BODIES=64;
export function materialMeasures(kernel:Pick<GeometryKernel,'interference'>,meshes:readonly BodyMesh[]):{volumes:MaterialVolume[];overlaps?:MaterialOverlap[]}{
 const solids=meshes.filter(b=>!b.reference&&!b.hole&&b.indices.length);
 const volumes=solids.map(b=>({id:b.id,volumeMm3:b.volume,geometry:'mesh' as const}));
 if(solids.length>MAX_OVERLAP_BODIES)return {volumes};
 return {volumes,overlaps:kernel.interference(solids).interfering.map(({a,b,volumeMm3})=>({a,b,volumeMm3}))};
}
