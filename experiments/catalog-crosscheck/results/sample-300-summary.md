# Catalog cross-check: 300 models, 9379 parts

| Model class | Count |
| --- | ---: |
| agree | 293 |
| disagree | 4 |
| converter-failure | 3 |

| Part class | Count |
| --- | ---: |
| agree | 9372 |
| disagree | 7 |

| Disagreement (part) reason | Count |
| --- | ---: |
| area | 4 |
| volume | 3 |

| Disagreement (part) cause | Count |
| --- | ---: |
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

| Exact failure (part) | Count |
| --- | ---: |

| Manifold failure (part) | Count |
| --- | ---: |

Parts built by both kernels: 9379; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 6827, max |ΔV|/V 8.8e-7.
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 297 models: 119 within 1e-6, 225 within 1e-3, 296 within 1e-2, 0 beyond 5e-2; median -5.4e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 6 s total (median part 0.38 ms); exact 267 s total (median part 3.18 ms, max 139.5 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| all-agree | 278 |
| converter-error | 15 |
| converter-partial | 4 |
| converter-failed | 3 |

Exact vs native where the volumes agree (278 models): area within 1e-6 for 273, within 1e-3 for 277; box within 1e-3 mm for 278.
