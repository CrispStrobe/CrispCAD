# Local verification; GitHub Actions paused

Owner decision, 2026-11-13: no GitHub Actions runs (taken while the repository was
private, to save the Free-tier CI allowance). The repository became public on
2026-11-24, and Actions is still disabled in repository settings. There are no
active workflow files under `.github/workflows` and no automatic push/PR runs.
The former configuration is retained at
[ci/github-check.yml.disabled](ci/github-check.yml.disabled) for a deliberate future
change. Do not enable Actions unless the owner asks.

Run verification locally:

```sh
npm ci
npm run build
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run verify:physics
npm run verify:packages
```

On macOS, build and verify the native host locally:

```sh
BW_CAD_MAC_BUILD_NUMBER=7 npm run mac:build
npm run mac:verify
npm run mac:install
```

`mac:verify` uses isolated WebKit storage, a temporary library folder and a private
clipboard. `mac:install` retains the user's project library and closes the running
app normally before replacing it. Local output is in `dist`, `test-results`,
`artifacts` and `apps/macos/build`; generated output is not committed.

Heavy real-kernel/Jolt fixtures have explicit resource/time budgets; run the
qualification suite without competing native compilation or browser workloads
when measuring performance. A timeout is not a passed qualification.

If the owner later elects to restore CI or make the repository public, review the
runner/minute budget, restore the archived workflow intentionally, and re-enable
Actions in repository settings. Until then, a push is source publication only,
not a request to start cloud builds.
