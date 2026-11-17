
`compact-collision-candidates.json` contains simplified, convex collision
candidates derived from these same MIT source meshes. Reproduce it with
`npm run build:packages && node scripts/generate-compact-motor-collisions.mjs --check`.
The generator tries simplification tolerances in a fixed order and accepts each
result only after full-resolution CSG comparison under the existing 2% volume
and 0.2 mm bounds budgets. Runtime independently repeats that qualification;
saved certificates are informational. Full visual meshes, provenance and source
mass properties are unchanged. Rejected coarse candidates are not shipped.
