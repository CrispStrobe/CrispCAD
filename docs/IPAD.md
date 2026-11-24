# Standalone iPad host

The native app wraps the same standalone production host. The reusable editor
packages have no Capacitor dependency. The app host supplies the native share
sheet for .bcad, STL and 3MF files; its Open picker is the native document picker.
Web assets and WASM are bundled, so the native app does not use a service worker.

```sh
npm ci
npm run ipad:sync
npm run ipad:open
```

For a signed device build on the existing Brickwright build Mac:

```sh
BW_CAD_BUILD_NUMBER=1 npm run ipad:archive
```

This follows the shared appstore.md method: archive unsigned, then export with
manual signing against the existing shared Distribution identity in
`~/Library/Keychains/brickwright-build.keychain-db`. It never creates/revokes a
certificate and restores the original keychain search list if it added the
keychain. `BW_CAD_SIGNING_KEYCHAIN` overrides its location.

- Bundle ID: com.crispstrobe.brickwrightcad
- Team: N9XSJ4M3GT
- Ad hoc profile: Brickwright CAD iPad AdHoc
- Archive: apps/ipad/build/CrispCAD.xcarchive
- Signed IPA: apps/ipad/build/adhoc/App.ipa

The profile must already be installed on the build Mac and include the target
iPad. It is issued against canonical certificate L9PHHNLY9Y; do not create a new
certificate. Ad hoc signing needs no App Store app record, and the archive script
does not upload to Apple. It is not an unrestricted sideloading IPA: only listed
devices may install it, until the profile expires.

```sh
xcrun devicectl list devices
npm run ipad:install -- '<paired device identifier>'
```

The install script extracts to a fresh temporary directory, verifies the sealed
resources, installs and launches, then removes only that temporary extraction.
Never extract a new IPA over an older app directory: obsolete hashed assets
would remain and invalidate the signature.

Projects autosave in this app's local WebKit storage, separately from Layerling
and Brickwright. Export .bcad files for portable editable projects and backups.
Removing the app or clearing its data removes local projects. Export buffers
are base64-encoded for the native bridge, so large-file behavior needs testing
on the physical iPad. Native safe-area constraints keep the editor clear of the
status bar/home indicator; ordinary viewport resizing handles orientation.
