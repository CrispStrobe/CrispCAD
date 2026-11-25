// SPDX-License-Identifier: BSD-3-Clause
// The exact kernel this build pins, without loading it. Importing this module never fetches or
// compiles WebAssembly, so hosts can check recorded commands against it eagerly.
import type {KernelIdentity} from '@brickwright/cad-core';

/** `@crispcad/exact-kernel` as pinned in packages/exact/package.json (lab release tarball). */
export const EXACT_KERNEL_PACKAGE='@crispcad/exact-kernel';
export const EXACT_KERNEL_VERSION='0.1.2';
/** Stable kernel id used in recorded commands. */
export const EXACT_KERNEL_ID='smlib';
export const exactKernelIdentity:KernelIdentity=Object.freeze({id:EXACT_KERNEL_ID,package:EXACT_KERNEL_PACKAGE,version:EXACT_KERNEL_VERSION});
