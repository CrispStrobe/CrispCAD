# Catalog cross-check: 2402 models, 69367 parts

| Model class | Count |
| --- | ---: |
| agree | 2354 |
| converter-failure | 31 |
| disagree | 17 |

| Part class | Count |
| --- | ---: |
| agree | 69325 |
| disagree | 42 |

| Disagreement (part) reason | Count |
| --- | ---: |
| area | 29 |
| volume | 13 |

| Disagreement (part) cause | Count |
| --- | ---: |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 26 |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≤ 1e-5: Manifold numerics or float32 polyhedron vertices at large coordinates) | 13 |
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

| Exact failure (part) | Count |
| --- | ---: |

| Manifold failure (part) | Count |
| --- | ---: |

Parts built by both kernels: 69367; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 50722, max |ΔV|/V 9.7e-7.
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 2371 models: 1007 within 1e-6, 1848 within 1e-3, 2368 within 1e-2, 0 beyond 5e-2; median -2.6e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 111 s total (median part 1.00 ms); exact 1310 s total (median part 6.67 ms, max 5.2 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| all-agree | 2347 |
| converter-failed | 31 |
| converter-partial | 11 |
| native-failed | 8 |
| converter-error | 5 |

Exact vs native where the volumes agree (2347 models): area within 1e-6 for 2347, within 1e-3 for 2347; box within 1e-3 mm for 2347.
