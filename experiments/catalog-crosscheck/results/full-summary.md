# Catalog cross-check: 2402 models, 69295 parts

| Model class | Count |
| --- | ---: |
| agree | 2223 |
| kernel-failure | 119 |
| converter-failure | 31 |
| disagree | 24 |
| exact-unsupported | 5 |

| Part class | Count |
| --- | ---: |
| agree | 68666 |
| exact-failure | 445 |
| disagree | 116 |
| exact-unsupported | 68 |

| Disagreement (part) reason | Count |
| --- | ---: |
| bbox | 57 |
| area | 33 |
| volume | 26 |

| Disagreement (part) cause | Count |
| --- | ---: |
| exact bbox inside Manifold mesh bbox (SMLib tight bbox) | 57 |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≤ 1e-5: Manifold numerics or float32 polyhedron vertices at large coordinates) | 26 |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 25 |
| planar loft, exact area too large with equal volume (SMLib area of stitched polyhedron) | 5 |
| planar part, Manifold area too large with equal volume (faces of exactly touching operands kept inside the mesh) | 3 |

| Converter outcome | Count |
| --- | ---: |
| converted | 2352 |
| unsupported | 25 |
| partial | 19 |
| failed | 6 |

| Converter error | Count |
| --- | ---: |
| Line N, column N: Unsupported kernelCAD feature … | 25 |
| Line N, column N: Unknown kernelCAD name … | 6 |

| Exact unsupported (part) | Count |
| --- | ---: |
| A polyhedron of N faces exceeds the exact faceted-solid budget (N); tessellated constructors (ellipsoid, ellipticFrustum, roundedCylinder, many-section loft) ha | 38 |
| Hull of N distinct vertices exceeds the exact hull budget (N). | 30 |

| Exact failure (part) | Count |
| --- | ---: |
| invalid-input: The polyhedron faces do not close around a valid solid. | 445 |

| Manifold failure (part) | Count |
| --- | ---: |

Parts built by both kernels: 68782; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 50860, max |ΔV|/V 9.7e-7.
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 2240 models: 903 within 1e-6, 1720 within 1e-3, 2237 within 1e-2, 0 beyond 5e-2; median -3.8e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 87 s total (median part 0.75 ms); exact 806 s total (median part 4.08 ms, max 0.7 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| native built / ours agree | 2220 |
| native built / ours kernel-failure | 119 |
| native built / ours disagree | 24 |
| native built / ours converter-failure | 23 |
| native failed / ours converter-failure | 8 |
| native built / ours exact-unsupported | 5 |
| native failed / ours agree | 3 |
