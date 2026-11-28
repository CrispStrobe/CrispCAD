# Preserving an externally clocked mechanical world

The editor package and browser SDK export `createSimulationController` for hosts
that supply their own UI. It uses the same physics worker as the mounted editor;
the host supplies a CAD session, the Manifold WASM URL, a geometry-ready callback
(which may return no geometry and let the worker evaluate it), a state-change
callback and a frame-display callback. Browser document/visibility and Worker
interfaces are required, even when no editor UI is mounted.

`createSimulationController(...).acquireExternalClock()` now returns an opt-in
`releasePaused(rays = []): Promise<void>` method. It is intended for finite CrispBASIC
programs and other external clocks that need to resume an existing physical
world after a program finishes or is stopped.

```js
const lease = await simulation.acquireExternalClock();
await lease.step([{id: 'drive-a', impulse: 0.0001}]);
await lease.releasePaused();
const next = await simulation.acquireExternalClock();
// next.snapshot() retains the live world's time, poses and joint velocities.
```

The old lease loses ownership synchronously. The returned promise waits for an
operation already sent to the worker, disables persistent hinge/slider/servo
drives by coasting, releases a pointer grab, and obtains a full snapshot. None of
those cleanup commands advances physics time, brakes a shaft, destroys the Jolt
world, or edits the authored document/history. A new acquisition waits for this
barrier, so compact telemetry and a Stop during an in-flight step cannot leave
the next owner with a stale full snapshot.

Pass the connected `SimulationRay[]` batch when final distance readings are
required. The method copies that batch before returning and samples it at the
preserved world time, without an extra physics step. The default empty batch
clears distance readings, as the ordinary `sense([])` operation does.

A step already sent before release can finish. Its old caller is rejected as a
stale owner; the controller's final full snapshot includes its physical result.
Consumers must stop their electrical updates immediately and await
`releasePaused()` outside any synchronous interpreter cleanup callback before
reporting that the complete coupled simulation has settled. The method does not
roll physics back to the last frame displayed before the stop.

The paused viewport retains the last complete world, and subsequent manual or
external execution continues from it. An explicit Stop, Reset, document edit,
new document or controller disposal still invalidates that state. Such a reset
also supersedes an in-progress paused release; its late replies cannot revive
the old world. Worker failure rejects both the paused release and acquisitions
already waiting for it, then discards the unusable world.

`release()` keeps its established behavior: return the viewport to the editable
design, park the worker (destroying the live world), retain replay records, and
start a fresh world for the next acquisition. Existing callers need not change.

The worker's `stop-motors` command accepts optional `action: 'coast'`; omitted or
`'brake'` retains its old braking behavior. Coasting clears persistent drives
without changing poses or velocities. It does not apply an implicit time step.

Focused verification:

```sh
npx vitest run tests/simulation-telemetry-controller.test.ts tests/simulation-telemetry-worker.test.ts
npm run build:brickwright-sdk
```

Repository instructions require local checks and keep GitHub Actions disabled.

Local qualification on 2026-11-28: all 36 focused controller/worker tests passed,
including pause during full, compact and sensor requests, stale-owner release,
reset/disposal/failure races, successor acquisition, and competing manual start.
The 24 existing simulation-base, replay, panel, actuator-impulse, motor-model and
motor-port tests also passed. `npm run build:packages` completed successfully.
The worker protocol tests use a deterministic test world; the separate
actuator-impulse and motor-model tests execute the real Jolt physics engine.

## Recovery integration qualification

The saved clock feature was merged with CAD main `422e5675` on 2026-11-28,
retaining main's active-configuration filtering and all three feature commits.
The merged source passed the package build and all 63 tests in these nine
suites:

```sh
npm run build:packages
npx vitest run tests/simulation-telemetry-controller.test.ts tests/simulation-telemetry-worker.test.ts tests/simulation-base.test.ts tests/simulation-replay.test.ts tests/simulation-panel.test.ts tests/actuator-impulse.test.ts tests/motor-models.test.ts tests/motor-ports.test.ts tests/simulation-client.test.ts
npm run build:brickwright-sdk
```

The production SDK build also passed its ES2020 host-chunk and separate,
lazily loaded WebAssembly checks. Its manifest records the producing commit
and SHA-256 of every asset. Brickwright must synchronize this complete SDK
before using `releasePaused`; copying only the controller source leaves the
shipped worker protocol unchanged. No GitHub Actions were run.
