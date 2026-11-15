# Shared simulation release and follow-up boundary

Mac build 37 is installed and running from clean main `0032418`, including PRs
53, 54 and 55. Its source tree equals Lite's `89b379b` pin in draft PR 1791.
All ten reproduced SDK file hashes match the actual Lite files. Engine release
and archive integrity match too. Main's native smoke checks pass; existing
projects and histories were retained. No new Lite native/iPad installation was
made here.

This branch retains additional work beyond that delivered release. Do not treat
its recording changes as completely validated. The touch handoff regression
passes, and the catalogue test's common lift preserves assembly frames. The
video oracle now decodes pixels rather than relying on file size. Its first-frame
check still fails under software Chromium, despite fresh-render and prefilled
surface experiments; WebKit passes after those changes. Inspect later decoded
frames and capture timestamps before concluding an entire recording is blank.

The expanded simulation controls covered the iPad drag target. Minimizing them
through the real UI fixes that test; both drag variants pass. The broad UI run
passes the other library, theme, closing, mechanism, replay, connector and motor
workflows. Exact checkpoints, scopes and log hashes are in
[evidence](evidence/shared-simulation-native-2026-11-15.json).
