// SPDX-License-Identifier: BSD-3-Clause
// The ladder fixture (fixture.json) on dart_csp's geometric session.
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:dart_csp/geometry.dart';

double width(int i) => 10.0 + (i % 3);
const height = 8.0;
double jitter(int k) => 1.5 * math.sin(k * 12.9898 + 78.233);
List<double> expected(int n, double first) { final xs = [0.0]; for (var i = 0; i < n; i++) xs.add(xs[i] + (i == 0 ? first : width(i))); return xs; }

void main() {
  final fixture = jsonDecode(File('fixture.json').readAsStringSync()) as Map<String, dynamic>;
  final samples = fixture['samples'] as int, warmups = fixture['warmups'] as int, results = <Object>[];
  for (final n in (fixture['sizes'] as List).cast<int>()) {
    final b = GeometryBuilder(), plane = GeometryWorkplane(origin: Vec3.zero, normal: Vec3.unitZ);
    final o = b.point3('ref.o', Vec3.zero, fixed: true), xRef = GeometryLine(o, b.point3('ref.x', Vec3.unitX, fixed: true)), yRef = GeometryLine(o, b.point3('ref.y', Vec3.unitY, fixed: true));
    final xs = expected(n, width(0)); var k = 0;
    final bottom = <GeometryPoint>[], top = <GeometryPoint>[];
    for (var i = 0; i <= n; i++) {
      bottom.add(b.workplanePoint('b$i', plane, i == 0 ? 0 : xs[i] + jitter(++k), i == 0 ? 0 : jitter(++k), fixed: i == 0));
      top.add(b.workplanePoint('t$i', plane, xs[i] + jitter(++k), height + jitter(++k)));
    }
    final firstWidth = b.dimension('w0', width(0), lower: 0.001);
    for (var i = 0; i < n; i++) {
      b.parallel('hb$i', GeometryLine(bottom[i], bottom[i + 1]), xRef);
      b.parallel('ht$i', GeometryLine(top[i], top[i + 1]), xRef);
      b.distance('w$i.d', bottom[i], bottom[i + 1], i == 0 ? firstWidth : b.dimension('w$i', width(i), lower: 0.001));
    }
    for (var i = 0; i <= n; i++) b.parallel('v$i', GeometryLine(bottom[i], top[i]), yRef);
    b.distance('h.d', bottom[0], top[0], b.dimension('h', height, lower: 0.001));
    final compile = Stopwatch()..start(); final session = b.compile().createSession(); compile.stop();
    double error(GeometrySolveResult r, double first) { final xs = expected(n, first); var e = 0.0; for (var i = 0; i <= n; i++) { final p = r.values['b$i']!, q = r.values['t$i']!; e = [e, (p[0] - xs[i]).abs(), p[1].abs(), p[2].abs(), (q[0] - xs[i]).abs(), (q[1] - height).abs(), q[2].abs()].reduce(math.max); } return e; }
    var clock = Stopwatch()..start(); final cold = session.solve(); clock.stop();
    final coldUs = clock.elapsedMicroseconds, coldError = error(cold, width(0)), times = <int>[], errors = <double>[]; var ok = 0;
    for (var s = 0; s < samples + warmups; s++) {
      final first = s.isOdd ? 10.0 : 12.0; session.setParameterValues('w0', [first]);
      clock = Stopwatch()..start(); final r = session.solve(); clock.stop();
      if (s >= warmups) { times.add(clock.elapsedMicroseconds); errors.add(error(r, first)); if (r.isSuccess) ok++; }
    }
    times.sort();
    results.add({'solver': 'dart_csp geometric', 'bays': n, 'coordinates': 4 * (n + 1), 'compileMs': compile.elapsedMicroseconds / 1000,
      'cold': {'ms': coldUs / 1000, 'success': cold.isSuccess, 'status': '${cold.status}', 'localDegreesOfFreedom': cold.localDegreesOfFreedom, 'maxCoordinateErrorMm': coldError},
      'medianEditMs': times[times.length ~/ 2] / 1000, 'maxEditCoordinateErrorMm': errors.reduce(math.max), 'editsSucceeded': ok, 'edits': samples});
  }
  print(const JsonEncoder.withIndent(' ').convert({'runtime': 'dart ${Platform.version.split(' ').first} (JIT)', 'results': results}));
}
