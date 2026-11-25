# Catalog cross-check: 2402 models, 69367 parts

| Model class | Count |
| --- | ---: |
| agree | 2350 |
| converter-failure | 31 |
| disagree | 20 |
| kernel-failure | 1 |

| Part class | Count |
| --- | ---: |
| agree | 69307 |
| disagree | 56 |
| exact-failure | 4 |

| Disagreement (part) reason | Count |
| --- | ---: |
| volume | 28 |
| area | 28 |

| Disagreement (part) cause | Count |
| --- | ---: |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≤ 1e-5: Manifold numerics or float32 polyhedron vertices at large coordinates) | 28 |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 25 |
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
| invalid-input: The polyhedron faces do not close around a valid solid. | 4 |

| Manifold failure (part) | Count |
| --- | ---: |

Parts built by both kernels: 69363; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 51429, max |ΔV|/V 9.7e-7.
Low-segment intent probe: 0 parts (0 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = 0.00, min –; 0 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 2370 models: 1009 within 1e-6, 1847 within 1e-3, 2367 within 1e-2, 0 beyond 5e-2; median -2.6e-5, 5th percentile -2.9e-3, min -0.01.
CPU: Manifold 83 s total (median part 0.74 ms); exact 1753 s total (median part 5.24 ms, max 187.0 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| all-agree | 2215 |
| converter-error | 137 |
| converter-failed | 31 |
| converter-partial | 18 |
| exact-failed, manifold ≠ native | 1 |

Exact vs native where the volumes agree (2215 models): area within 1e-6 for 2198, within 1e-3 for 2210; box within 1e-3 mm for 2214.
