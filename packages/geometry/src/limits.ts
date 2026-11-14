// SPDX-License-Identifier: BSD-3-Clause
/** Distinct from unsupported syntax and invalid meshes in every host/report. */
export class GeometryResourceLimitError extends Error {
 readonly code='resource-limit';
 constructor(message:string){super(message);this.name='GeometryResourceLimitError';}
}
