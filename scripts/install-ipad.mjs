import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const device = process.argv[2] ?? process.env.BW_CAD_DEVICE;
if (!device) throw new Error('Usage: npm run ipad:install -- <paired device identifier>');
const staging = await mkdtemp(join(tmpdir(), 'brickwright-cad-install-'));
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
try {
  // An overlay extraction retains obsolete hashed assets and invalidates the signature.
  run('ditto', ['-x', '-k', resolve('apps/ipad/build/adhoc/App.ipa'), staging]);
  const app = join(staging, 'Payload/App.app');
  run('codesign', ['--verify', '--deep', '--strict', app]);
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device, app, '--timeout', '120']);
  run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', device, 'com.crispstrobe.brickwrightcad', '--timeout', '60']);
} finally { await rm(staging, { recursive: true, force: true }); }
