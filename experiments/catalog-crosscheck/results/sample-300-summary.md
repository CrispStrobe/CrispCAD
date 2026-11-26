# Catalog cross-check: 300 models, 9384 parts

| Model class | Count |
| --- | ---: |
| agree | 294 |
| disagree | 3 |
| converter-failure | 3 |

| Part class | Count |
| --- | ---: |
| agree | 9379 |
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
| converted | 295 |
| partial | 2 |
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

Parts built by both kernels: 9384; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 6625, max |ΔV|/V 6.7e-7.
Loft parts (twisted ruled or smooth quads): 211, 8 with quads a Boolean operand can reach; median allowance 1.0e-6 of the volume (real |ΔV|/V 1.5e-8), 1.0e-5 of the area (real 2.6e-7).
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 297 models: 119 within 1e-6, 225 within 1e-3, 296 within 1e-2, 0 beyond 5e-2; median -5.4e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 10 s total (median part 0.58 ms); exact 110 s total (median part 4.02 ms, max 0.8 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| all-agree | 294 |
| converter-failed | 3 |
| converter-partial | 2 |
| converter-error | 1 |

Exact vs native where the volumes agree (294 models): area within 1e-6 for 294, within 1e-3 for 294; box within 1e-3 mm for 294.
