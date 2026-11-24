import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
const keychain = process.env.BW_CAD_SIGNING_KEYCHAIN ?? resolve(homedir(), 'Library/Keychains/brickwright-build.keychain-db');
if (!existsSync(keychain)) throw new Error('Brickwright signing keychain is missing');
const run = (command, args, capture = false) => {
  const r = spawnSync(command, args, { env: { ...process.env, PATH: `/usr/bin:${process.env.PATH ?? ''}` }, ...(capture ? { encoding: 'utf8' } : { stdio: 'inherit' }) });
  if (r.error) throw r.error; if (r.status !== 0) throw new Error(`${command} failed (${r.status}): ${r.stderr ?? ''}`); return r.stdout ?? '';
};
const original = [...run('security', ['list-keychains', '-d', 'user'], true).matchAll(/"([^"]+)"/g)].map(m => m[1]);
const added = !original.includes(keychain); const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
try {
  if (added) run('security', ['list-keychains', '-d', 'user', '-s', ...original, keychain]);
  run('xcodebuild', ['-project', 'apps/ipad/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-derivedDataPath', 'apps/ipad/build/device', '-archivePath', 'apps/ipad/build/CrispCAD.xcarchive', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${process.env.BW_CAD_BUILD_NUMBER ?? '1'}`, 'archive']);
  run('xcodebuild', ['-exportArchive', '-archivePath', 'apps/ipad/build/CrispCAD.xcarchive', '-exportPath', 'apps/ipad/build/adhoc', '-exportOptionsPlist', 'apps/ipad/ExportOptions.plist']);
} finally { if (added) run('security', ['list-keychains', '-d', 'user', '-s', ...original]); }
