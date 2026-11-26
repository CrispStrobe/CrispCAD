# Catalog cross-check: 300 models, 9379 parts

| Model class | Count |
| --- | ---: |
| agree | 294 |
| disagree | 3 |
| converter-failure | 3 |

| Part class | Count |
| --- | ---: |
| agree | 9374 |
| disagree | 5 |

| Disagreement (part) reason | Count |
| --- | ---: |
| area | 4 |
| volume | 1 |

| Disagreement (part) cause | Count |
| --- | ---: |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 3 |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≤ 1e-5: Manifold numerics or float32 polyhedron vertices at large coordinates) | 1 |
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

| Exact failure (part) | Count |
| --- | ---: |

| Manifold failure (part) | Count |
| --- | ---: |

Parts built by both kernels: 9379; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 6725, max |ΔV|/V 8.8e-7.
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 297 models: 119 within 1e-6, 225 within 1e-3, 296 within 1e-2, 0 beyond 5e-2; median -5.4e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 15 s total (median part 0.92 ms); exact 180 s total (median part 6.15 ms, max 1.3 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| all-agree | 292 |
| converter-failed | 3 |
| converter-partial | 2 |
| native-failed | 2 |
| converter-error | 1 |

Exact vs native where the volumes agree (292 models): area within 1e-6 for 292, within 1e-3 for 292; box within 1e-3 mm for 292.
