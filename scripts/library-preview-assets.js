// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const urls = {
  'brickwright:cad-model-previews': new URL('../library/previews.json', import.meta.url),
  'brickwright:adafruit-previews': new URL('../packages/editor/src/adafruit-preview-data.json', import.meta.url)
};
const base = '/__brickwright-previews/';

export function libraryPreviewAssets() {
  let build = false;
  const devImages = new Map();
  const emitted = new Map();
  return {
    name: 'brickwright-library-previews',
    configResolved(config) { build = config.command === 'build'; },
    buildStart() { emitted.clear(); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const bytes = devImages.get(req.url?.split('?')[0]);
        if (!bytes) return next();
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(bytes);
      });
    },
    resolveId(id) { return Object.hasOwn(urls, id) ? '\0' + id : null; },
    load(id) {
      const file = urls[id.slice(1)];
      if (!id.startsWith('\0') || !file) return null;
      this.addWatchFile(fileURLToPath(file));
      const {previews, ...metadata} = JSON.parse(readFileSync(file, 'utf8'));
      const entries = Object.entries(previews).map(([key, value]) => {
        const png = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value)?.[1];
        if (!png) throw new Error(`Invalid PNG preview: ${key}`);
        const source = Buffer.from(png, 'base64');
        const name = createHash('sha256').update(source).digest('hex') + '.png';
        let expression;
        if (build) {
          let ref = emitted.get(name);
          if (!ref) {
            ref = this.emitFile({type: 'asset', fileName: 'previews/' + name, source});
            emitted.set(name, ref);
          }
          expression = `import.meta.ROLLUP_FILE_URL_${ref}`;
        } else {
          devImages.set(base + name, source);
          expression = JSON.stringify(base + name);
        }
        return `[${JSON.stringify(key)}]:${expression}`;
      });
      return `export default {...${JSON.stringify(metadata)},previews:{${entries.join(',')}}};`;
    }
  };
}
