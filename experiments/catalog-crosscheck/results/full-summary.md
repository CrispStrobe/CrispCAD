# Catalog cross-check: 2402 models, 63281 parts

| Model class | Count |
| --- | ---: |
| exact-unsupported | 1127 |
| agree | 989 |
| converter-failure | 153 |
| kernel-failure | 115 |
| disagree | 18 |

| Part class | Count |
| --- | ---: |
| agree | 52087 |
| exact-unsupported | 10662 |
| exact-failure | 437 |
| disagree | 92 |
| manifold-failure | 2 |
| both-failed | 1 |

| Disagreement (part) reason | Count |
| --- | ---: |
| bbox | 59 |
| area | 30 |
| volume | 3 |

| Disagreement (part) cause | Count |
| --- | ---: |
| exact bbox inside Manifold mesh bbox (SMLib tight bbox) | 59 |
| planar part, area off by < 1e-3 (float32 mesh positions far from the origin) | 25 |
| planar loft, exact area too large with equal volume (SMLib area of stitched polyhedron) | 5 |
| planar part, volume beyond the 1e-6 floor (\|dV\|/V ≈ 1e-6: Manifold numerics at large coordinates) | 3 |

| Converter outcome | Count |
| --- | ---: |
| converted | 2231 |
| unsupported | 104 |
| failed | 49 |
| partial | 18 |

| Converter error | Count |
| --- | ---: |
| Line N, column N: Unsupported kernelCAD feature … | 104 |
| Line N, column N: Invalid JavaScript syntax; strip TypeScript annotations first | 24 |
| Line N, column N: Expected positive kernelCAD box dimensions | 12 |
| Line N, column N: Unknown kernelCAD name … | 6 |
| Line N, column N: Expected a finite kernelCAD number | 6 |
| Line N, column N: Expected a bounded kernelCAD array | 1 |

| Exact unsupported (part) | Count |
| --- | ---: |
| cylinder with N segments is ambiguous for an exact kernel (a polygon or a circle?); use N+ segments for a true circle, or polygon2d/polyhedron for a polygonal s | 10300 |
| revolve with N segments is ambiguous for an exact kernel (a polygon or a circle?); use N+ segments for a true circle, or polygon2d/polyhedron for a polygonal sh | 308 |
| Hull of N distinct vertices exceeds the exact hull budget (N). | 30 |
| A polyhedron of N faces exceeds the exact faceted-solid budget (N); tessellated constructors (ellipsoid, ellipticFrustum, roundedCylinder, many-section loft) ha | 24 |

| Exact failure (part) | Count |
| --- | ---: |
| invalid-input: The polyhedron faces do not close around a valid solid. | 437 |
| invalid-input: The program produces no solid. | 1 |

| Manifold failure (part) | Count |
| --- | ---: |
| feature Na076aec-N-Nf0c-Nd-Nfaeedc64d: part: Code produces no printable solid | 1 |
| feature Nb1aa1f-N-N-b17c-Nf72c436b: part: Code produces no printable solid | 1 |
| feature N-Na87-N-a0ff-Nfc7a3b: part: Code produces no printable solid | 1 |

Parts built by both kernels: 52179; median |ΔV|/V of agreeing parts 0.00; planar agreeing parts 46863, max |ΔV|/V 9.7e-7.
Low-segment intent probe: 10608 parts (10608 agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = -0.06, min -0.59; 1123 exact-unsupported models are unsupported only for that reason.
Model totals, Manifold vs exact (kernelCAD intent for low segments), 2128 models: 838 within 1e-6, 1170 within 1e-3, 1679 within 1e-2, 115 beyond 5e-2; median -4.5e-4, 5th percentile -0.05, min -0.15.
CPU: Manifold 99 s total (median part 0.92 ms); exact 726 s total (median part 2.84 ms, max 1.4 s).

| Three-way class (with native volumes) | Count |
| --- | ---: |
| native built / ours exact-unsupported | 1126 |
| native built / ours agree | 988 |
| native built / ours converter-failure | 144 |
| native built / ours kernel-failure | 115 |
| native built / ours disagree | 18 |
| native failed / ours converter-failure | 9 |
| native failed / ours agree | 1 |
| native failed / ours exact-unsupported | 1 |
