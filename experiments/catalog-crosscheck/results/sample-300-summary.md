# Catalog cross-check: 300 models, 9379 parts

| Model class | Count |
| --- | ---: |
| agree | 277 |
| kernel-failure | 13 |
| disagree | 6 |
| converter-failure | 3 |
| exact-unsupported | 1 |

| Part class | Count |
| --- | ---: |
| agree | 9273 |
| disagree | 62 |
| exact-failure | 35 |
| exact-unsupported | 9 |

| Disagreement (part) reason | Count |
| --- | ---: |
| bbox | 55 |
| area | 4 |
| volume | 3 |

| Disagreement (part) cause | Count |
| --- | ---: |
| exact bbox inside Manifold mesh bbox (SMLib tight bbox) | 55 |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≤ 1e-5: Manifold numerics or float32 polyhedron vertices at large coordinates) | 3 |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 3 |
| planar part, Manifold area too large with equal volume (faces of exactly touching operands kept inside the mesh) | 1 |

| Converter outcome | Count |
| --- | ---: |
| converted | 293 |
| partial | 4 |
| failed | 2 |
| unsupported | 1 |

| Converter error | Count |
| --- | ---: |
| Line N, column N: Unknown kernelCAD name … | 2 |
| Line N, column N: Unsupported kernelCAD feature … | 1 |

| Exact unsupported (part) | Count |
| --- | ---: |
| A polyhedron of N faces exceeds the exact faceted-solid budget (N); tessellated constructors (ellipsoid, ellipticFrustum, roundedCylinder, many-section loft) ha | 8 |
| Hull of N distinct vertices exceeds the exact hull budget (N). | 1 |

| Exact failure (part) | Count |
| --- | ---: |
| invalid-input: The polyhedron faces do not close around a valid solid. | 35 |

| Manifold failure (part) | Count |
| --- | ---: |

Parts built by both kernels: 9335; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 6783, max |ΔV|/V 8.8e-7.
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 282 models: 106 within 1e-6, 210 within 1e-3, 281 within 1e-2, 0 beyond 5e-2; median -8.0e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 10 s total (median part 0.58 ms); exact 103 s total (median part 3.64 ms, max 0.6 s).

Native (lab) volumes: not provided; see README "Native volumes".
