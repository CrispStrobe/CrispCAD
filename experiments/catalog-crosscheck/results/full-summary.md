# Catalog cross-check: 2402 models, 69389 parts

| Model class | Count |
| --- | ---: |
| agree | 2353 |
| converter-failure | 31 |
| disagree | 18 |

| Part class | Count |
| --- | ---: |
| agree | 69340 |
| disagree | 49 |

| Disagreement (part) reason | Count |
| --- | ---: |
| area | 28 |
| volume | 21 |

| Disagreement (part) cause | Count |
| --- | ---: |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 25 |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≤ 1e-5: Manifold numerics or float32 polyhedron vertices at large coordinates) | 21 |
| planar part, Manifold area too large with equal volume (faces of exactly touching operands kept inside the mesh) | 3 |

| Converter outcome | Count |
| --- | ---: |
| converted | 2360 |
| unsupported | 25 |
| partial | 11 |
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

Parts built by both kernels: 69389; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 49614, max |ΔV|/V 9.7e-7.
Loft parts (twisted ruled or smooth quads): 1873, 69 with quads a Boolean operand can reach; median allowance 1.0e-6 of the volume (real |ΔV|/V 1.3e-8), 1.0e-5 of the area (real 2.6e-7).
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 2371 models: 1007 within 1e-6, 1848 within 1e-3, 2368 within 1e-2, 0 beyond 5e-2; median -2.6e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 68 s total (median part 0.56 ms); exact 720 s total (median part 3.86 ms, max 3.0 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| all-agree | 2358 |
| converter-failed | 31 |
| converter-partial | 11 |
| converter-error | 2 |

Exact vs native where the volumes agree (2358 models): area within 1e-6 for 2358, within 1e-3 for 2358; box within 1e-3 mm for 2358.
