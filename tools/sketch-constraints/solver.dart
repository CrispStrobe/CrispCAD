// SPDX-License-Identifier: BSD-3-Clause
import 'dart:convert';
import 'dart:js_interop';
import 'package:dart_csp/geometry.dart';

@JS('solveBrickwrightOutline')
external set solveCallback(JSFunction callback);

String solve(String data) {
  try {
    final request = jsonDecode(data) as Map<String, dynamic>;
    final seeds = request['points'] as List;
    final constraints = request['constraints'] as List;
    if (seeds.length < 3 ||
        seeds.length > 32 ||
        constraints.isEmpty ||
        constraints.length > 48) {
      throw const FormatException();
    }
    final builder = GeometryBuilder();
    final origin = builder.point3('origin', Vec3.zero, fixed: true);
    final plane = GeometryPlane(origin, Vec3.unitZ);
    final points = [
      for (var i = 0; i < seeds.length; i++)
        builder.point3(
          'p$i',
          Vec3((seeds[i][0] as num).toDouble(), (seeds[i][1] as num).toDouble(),
              0),
          fixed: i == 0,
        ),
    ];
    for (var i = 1; i < points.length; i++) {
      builder.pointOnPlane('xy$i', points[i], plane);
    }
    GeometryLine segment(int index) =>
        GeometryLine(points[index], points[(index + 1) % points.length]);

    for (var i = 0; i < constraints.length; i++) {
      final c = constraints[i];
      final id = 'constraint$i';
      final edge = segment(c['edge'] as int);
      switch (c['kind']) {
        case 'horizontal':
          builder.pointOnPlane(
              id, edge.end, GeometryPlane(edge.start, Vec3.unitY));
        case 'vertical':
          builder.pointOnPlane(
              id, edge.end, GeometryPlane(edge.start, Vec3.unitX));
        case 'length':
          final length = (c['length'] as num).toDouble();
          builder.distance(id, edge.start, edge.end,
              builder.dimension('length$i', length, lower: .01));
        case 'parallel':
          builder.parallel(id, edge, segment(c['other'] as int));
        case 'perpendicular':
          builder.perpendicular(id, edge, segment(c['other'] as int));
        case 'equal':
          builder.equalLengths(id, edge, segment(c['other'] as int));
        default:
          throw const FormatException();
      }
    }
    final result = builder.compile().createSession().solve();
    if (!result.isSuccess) return jsonEncode({'status': 'unsolved'});
    return jsonEncode({
      'status': 'solved',
      'degrees': result.localDegreesOfFreedom,
      'points': [
        for (final point in points) result.values[point.id]!.take(2).toList()
      ],
    });
  } catch (_) {
    return jsonEncode({'status': 'unsolved'});
  }
}

void main() {
  solveCallback = ((JSString data) => solve(data.toDart).toJS).toJS;
}
