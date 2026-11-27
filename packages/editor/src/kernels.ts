// SPDX-License-Identifier: BSD-3-Clause
// Kernels the editor runs, for hosts that create the editor's session themselves. A session's
// kernels are what replay checks recorded commands against (`context.kernel`), so declaring one
// claims that this host really runs it. The editor's geometry worker bundles the pinned exact
// kernel (lazily: identity only here, no WebAssembly is fetched until an exact command runs).
import {createCadSession,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,CadSessionOptions,ExactCommandHost,KernelIdentity} from '@brickwright/cad-core';
import {exactKernelIdentity} from '@brickwright/cad-exact/identity';
export {exactKernelIdentity};

/** Kernels the editor's default geometry worker provides (the pinned exact kernel). */
export const editorKernels:readonly KernelIdentity[]=Object.freeze([exactKernelIdentity]);

/** Whether `kernels` declare exactly this kernel (id, package and version). */
export function providesKernel(kernels:readonly KernelIdentity[],kernel:KernelIdentity){
 return kernels.some(entry=>entry.id===kernel.id&&entry.package===kernel.package&&entry.version===kernel.version);
}

/**
 * A session for `mountCadEditor(host, {session})` that declares the editor's kernels, so exact
 * fillet, chamfer and shell can be created, recomputed and replayed. Pass `kernels` to declare a
 * different set instead (`[]` declares none; `[...editorKernels, other]` adds to them).
 */
export function createEditorSession(document?:CadDocument,options:CadSessionOptions={}):CadSession{
 return createCadSession(document,{...options,kernels:options.kernels??editorKernels});
}

/**
 * `host` for the editor's exact edits: a session that does not declare the exact kernel cannot
 * commit its output, so `feature-display` (fillet, chamfer, shell, recompute) is refused before
 * the kernel loads and runs instead of after. STEP export and exact measures commit nothing and
 * pass through.
 */
export function exactEditHost(session:Pick<CadSession,'kernels'>,host:ExactCommandHost):ExactCommandHost{
 return {run(request,signal){
  if((request.operation==='feature-display'||request.operation==='import-step')&&!providesKernel(session.kernels,exactKernelIdentity))
   return Promise.reject(new Error(t('This editor session does not declare the exact kernel. The host must create it with createEditorSession() (or kernels: [exactKernelIdentity]).')));
  return host.run(request,signal);
 }};
}
