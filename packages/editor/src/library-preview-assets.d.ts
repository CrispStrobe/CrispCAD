// SPDX-License-Identifier: BSD-3-Clause
declare module 'brickwright:adafruit-previews' {
  const data: {upstreamCommit: string; archiveCommit: string; previews: Record<string, string>};
  export default data;
}

declare module 'brickwright:cad-model-previews' {
  const data: {previews: Record<string, string>};
  export default data;
}
