# Catalog cross-check: 300 models, 8410 parts

| Model class | Count |
| --- | ---: |
| exact-unsupported | 133 |
| agree | 127 |
| converter-failure | 23 |
| kernel-failure | 12 |
| disagree | 5 |

| Part class | Count |
| --- | ---: |
| agree | 6904 |
| exact-unsupported | 1411 |
| disagree | 61 |
| exact-failure | 34 |

| Disagreement (part) reason | Count |
| --- | ---: |
| bbox | 57 |
| area | 3 |
| volume | 1 |

| Disagreement (part) cause | Count |
| --- | ---: |
| exact bbox inside Manifold mesh bbox (SMLib tight bbox) | 57 |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 3 |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≈ 1e-6: Manifold numerics at large coordinates) | 1 |

| Converter outcome | Count |
| --- | ---: |
| converted | 273 |
| unsupported | 13 |
| failed | 10 |
| partial | 4 |

| Converter error | Count |
| --- | ---: |
| Line N, column N: Unsupported kernelCAD feature … | 13 |
| Line N, column N: Invalid JavaScript syntax; strip TypeScript annotations first | 6 |
| Line N, column N: Unknown kernelCAD name … | 2 |
| Line N, column N: Expected a bounded kernelCAD array | 1 |
| Line N, column N: Expected positive kernelCAD box dimensions | 1 |

| Exact unsupported (part) | Count |
| --- | ---: |
| cylinder with N segments is ambiguous for an exact kernel (a polygon or a circle?); use N+ segments for a true circle, or polygon2d/polyhedron for a polygonal s | 1298 |
| revolve with N segments is ambiguous for an exact kernel (a polygon or a circle?); use N+ segments for a true circle, or polygon2d/polyhedron for a polygonal sh | 105 |
| A polyhedron of N faces exceeds the exact faceted-solid budget (N); tessellated constructors (ellipsoid, ellipticFrustum, roundedCylinder, many-section loft) ha | 7 |
| Hull of N distinct vertices exceeds the exact hull budget (N). | 1 |

| Exact failure (part) | Count |
| --- | ---: |
| invalid-input: The polyhedron faces do not close around a valid solid. | 34 |

| Manifold failure (part) | Count |
| --- | ---: |

Parts built by both kernels: 6965; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 6096, max |ΔV|/V 8.8e-7.
Low-segment intent probe: 1403 parts (1403 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = -0.06, min -0.36; 132 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 264 models: 102 within 1e-6, 135 within 1e-3, 204 within 1e-2, 19 beyond 5e-2; median -8.2e-4, 5th percentile -0.06, min -0.10.
CPU: Manifold 15 s total (median part 1.02 ms); exact 105 s total (median part 2.91 ms, max 0.7 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| native built / ours exact-unsupported | 133 |
| native built / ours agree | 126 |
| native built / ours converter-failure | 21 |
| native built / ours kernel-failure | 12 |
| native built / ours disagree | 5 |
| native failed / ours converter-failure | 2 |
| native failed / ours agree | 1 |
