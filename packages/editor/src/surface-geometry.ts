// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
/** Display normals only. The kernel mesh used for export/collision stays intact. */
export function surfaceGeometry(positions:Float32Array,indices:Uint32Array){const source=new T.BufferGeometry();source.setAttribute('position',new T.BufferAttribute(positions,3));source.setIndex(new T.BufferAttribute(indices,1));const display=toCreasedNormals(source,Math.PI/6);if(display!==source)source.dispose();return display;}
