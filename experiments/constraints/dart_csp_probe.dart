// SPDX-License-Identifier: BSD-3-Clause
// Standalone review experiment; see README.md. Not an app dependency.
import 'dart:convert';
import 'package:dart_csp/dart_csp.dart';

void main() {
  final report = <String, Object?>{};
  final clock = Stopwatch()..start();
  final model = ContinuousModel();
  final x = model.addVar('x', 0, 10), y = model.addVar('y', 0, 10);
  (x * x + y * y).eq(25);
  (x + y).eq(7);
  final solved = model.solve(epsilon: 1e-7, rounding: IntervalRounding.outward);
  if (solved == null) throw StateError('Circle/line probe did not converge');
  final p = solved.midpoint;
  final distanceResidual = (p['x']! * p['x']! + p['y']! * p['y']! - 25).abs();
  final sumResidual = (p['x']! + p['y']! - 7).abs();
  if (distanceResidual > 1e-4 || sumResidual > 1e-5)
    throw StateError('Independent point residual check failed');
  report['circleLine'] = {
    'point': p,
    'squaredDistanceResidual': distanceResidual,
    'lineResidual': sumResidual,
    'elapsedMicroseconds': clock.elapsedMicroseconds
  };
  final free = ContinuousModel();
  final a = free.addVar('x', 0, 10), b = free.addVar('y', 0, 10);
  (a + b).eq(10);
  // (5,5) is already valid. There is no previous-pose/nearest-solution input.
  final nearest = free.solve(rounding: IntervalRounding.outward)!.midpoint;
  report['underconstrained'] = {
    'validPreviousPose': {'x': 5, 'y': 5},
    'returnedPoint': nearest,
    'movementFromValidPreviousPose':
        ((nearest['x']! - 5).abs() + (nearest['y']! - 5).abs())
  };
  final exhausted =
      free.solve(maxSplits: 0, rounding: IntervalRounding.outward);
  final impossible = ContinuousModel();
  final c = impossible.addVar('x', 0, 1);
  c.eq(2);
  final infeasible = impossible.solve(rounding: IntervalRounding.outward);
  if (exhausted != null || infeasible != null)
    throw StateError('Unexpected status probe');
  report['statusAmbiguity'] = {
    'feasibleButBudgetExhausted': exhausted,
    'contradictory': infeasible,
    'note': 'Both return null. CAD must not interpret this as proven conflict.'
  };
  print(const JsonEncoder.withIndent('  ').convert(report));
}
