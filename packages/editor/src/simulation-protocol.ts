// SPDX-License-Identifier: BSD-3-Clause
import type {CadDocument} from '@brickwright/cad-core';
export interface SimulationPose {id:string;positionMm:number[];quaternion:number[]}
export interface SimulationFrame {time:number;poses:SimulationPose[];angles:Record<string,number>;speeds:Record<string,number>}
export type SimulationCommand =
 |{op:'start';document:CadDocument;wasmURL:string;fixBase:boolean;locale:string}
 |{op:'step';seconds:number}
 |{op:'motor';id:string;speedDps:number;torqueNm:number}
 |{op:'stop-motor';id:string;action:'brake'|'coast'}
 |{op:'stop-motors'};
