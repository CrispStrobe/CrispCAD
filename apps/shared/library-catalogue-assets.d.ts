// SPDX-License-Identifier: BSD-3-Clause
declare module 'brickwright:cad-catalogue-manifests' {
  import type {ModelLibraryAsset} from '@brickwright/cad-core';

  export default function readManifests(): {assets: ModelLibraryAsset[]}[];
}
