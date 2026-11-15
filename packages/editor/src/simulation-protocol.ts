// SPDX-License-Identifier: BSD-3-Clause
import type {CadDocument} from '@brickwright/cad-core';
export interface SimulationPose {id:string;positionMm:number[];quaternion:number[];previewRadiusMm?:number;previewShape?:'sphere'|'box'}
export interface SimulationFrame {time:number;poses:SimulationPose[];angles:Record<string,number>;speeds:Record<string,number>;linearPositions:Record<string,number>;linearSpeeds:Record<string,number>}
export type SimulationCommand =
 |{op:'start';document:CadDocument;wasmURL:string;fixBase:boolean;locale:string;rigidPreview?:boolean}
 |{op:'step';seconds:number}
 |{op:'motor';id:string;speedDps:number;torqueNm:number}
 |{op:'stop-motor';id:string;action:'brake'|'coast'}
 |{op:'slider';id:string;speedMmS:number;forceN:number}
 |{op:'stop-slider';id:string;action:'brake'|'coast'}
 |{op:'velocity';id:string;velocityMmS:[number,number,number]}
 |{op:'impulse';id:string;impulseNs:[number,number,number];pointMm?:[number,number,number]}
 |{op:'ball';shape?:'sphere'|'box';id:string;positionMm:[number,number,number];velocityMmS:[number,number,number];radiusMm:number}
 |{op:'grab';id:string;pointMm:[number,number,number];targetMm:[number,number,number]}
 |{op:'release-grab'}
 |{op:'stop-motors'};
