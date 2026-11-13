// SPDX-License-Identifier: BSD-3-Clause
import 'dart:math' as math;
import 'package:dart_csp/dart_csp.dart';

Map<String, Object?> benchmark(String kind, int size, int samples) {
  final buildTimes = <double>[], solveTimes = <double>[];
  double worstResidual = 0;
  int validatedSolutions = 0;
  String status = 'satisfied';
  void run(bool record) {
    final watch = Stopwatch()..start();
    final m = ContinuousModel();
    if (kind == 'linear-chain') {
      final xs = <FloatVar>[], ys = <FloatVar>[];
      for (var i = 0; i < size; i++) {
        xs.add(m.addVar('x$i', -10000, 10000));
        ys.add(m.addVar('y$i', -10000, 10000));
        if (i == 0) {
          xs[i].eq(0);
          ys[i].eq(0);
        } else {
          (xs[i] - xs[i - 1]).eq(10);
          (ys[i] - ys[i - 1]).eq(0);
        }
      }
    } else if (kind == 'circle-line') {
      for (var i = 0; i < size; i++) {
        final x = m.addVar('x$i', 0, 10), y = m.addVar('y$i', 0, 10);
        (x * x + y * y).eq(25);
        (x + y).eq(7);
      }
    } else if (kind == 'free-chain') {
      for (var i = 0; i < size; i++) {
        final x = m.addVar('x$i', 0, 10), y = m.addVar('y$i', 0, 10);
        (x + y).eq(10);
      }
    } else {
      throw ArgumentError('Unknown benchmark');
    }
    final built = watch.elapsedMicroseconds / 1000;
    final solved = m.solve(
        epsilon: 1e-6, maxSplits: 4096, rounding: IntervalRounding.outward);
    final elapsed = watch.elapsedMicroseconds / 1000 - built;
    if (record) {
      buildTimes.add(built);
      solveTimes.add(elapsed);
    }
    if (solved == null) {
      status = 'unknown: null may mean exhausted or infeasible';
      return;
    }
    validatedSolutions++;
    final p = solved.midpoint;
    for (var i = 0; i < size; i++) {
      final x = p['x$i']!, y = p['y$i']!;
      final residual = kind == 'linear-chain'
          ? math.max((x - i * 10).abs(), y.abs())
          : kind == 'circle-line'
              ? math.max((x * x + y * y - 25).abs(), (x + y - 7).abs())
              : (x + y - 10).abs();
      worstResidual = math.max(worstResidual, residual);
    }
    if (worstResidual > 1e-4)
      throw StateError('Independent residual check failed: $worstResidual');
  }

  run(false);
  run(false);
  for (var i = 0; i < samples; i++) {
    run(true);
  }
  Map<String, double> stats(List<double> values) {
    values.sort();
    return {
      'medianMs': values[values.length ~/ 2],
      'p95Ms': values[(values.length * .95).ceil() - 1],
      'maxMs': values.last
    };
  }

  return {
    'kind': kind,
    'size': size,
    'decisionVariables': size * 2,
    'samples': samples,
    'warmups': 2,
    'build': stats(buildTimes),
    'solve': stats(solveTimes),
    'worstResidual': validatedSolutions == 0 ? null : worstResidual,
    'validatedSolutions': validatedSolutions,
    'status': status,
    'epsilon': 1e-6,
    'maxSplits': 4096
  };
}
