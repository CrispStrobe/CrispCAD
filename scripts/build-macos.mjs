// SPDX-License-Identifier: BSD-3-Clause
import {mkdir, cp, rm} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('The native macOS build requires macOS and Xcode command line tools');
// The native menus come from the editor's menu definition (built by `npm run build`).
execFileSync(process.execPath,['scripts/generate-mac-menus.mjs'],{stdio:'inherit'});
const app=resolve('apps/macos/build/CrispCAD.app'),contents=join(app,'Contents');
await rm(app,{recursive:true,force:true});await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(join(contents,'Resources'),{recursive:true});
await cp('apps/macos/Info.plist',join(contents,'Info.plist'));
for(const language of ['en','de'])await cp(`apps/macos/${language}.lproj`,join(contents,'Resources',`${language}.lproj`),{recursive:true});
await cp('dist',join(contents,'Resources/web'),{recursive:true,filter:source=>!source.startsWith(resolve('dist/packages'))&&!source.endsWith('/packages')});
const build=process.env.BW_CAD_MAC_BUILD_NUMBER??'1';if(!/^\d+$/.test(build))throw Error('Invalid build number');
execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :CFBundleVersion ${build}`,join(contents,'Info.plist')]);
execFileSync('xcrun',['swiftc','-parse-as-library','-O','-swift-version','5','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos14.0`,'-framework','Cocoa','-framework','WebKit','-framework','Network','apps/macos/Main.swift','apps/macos/EditorMenu.generated.swift','-o',join(contents,'MacOS/CrispCAD')],{stdio:'inherit'});
const iconset=resolve('apps/macos/build/AppIcon.iconset');await mkdir(iconset,{recursive:true});
const icon='apps/ipad/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('sips',['-z',String(size*scale),String(size*scale),icon,'--out',join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
execFileSync('iconutil',['-c','icns',iconset,'-o',join(contents,'Resources/AppIcon.icns')]);
execFileSync('codesign',['--force','--sign','-',app],{stdio:'inherit'});
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
console.log(`Built ${app} (${process.arch}, locally signed)`);
