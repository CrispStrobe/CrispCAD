// SPDX-License-Identifier: BSD-3-Clause
import 'dart:math' as math;
import 'package:dart_csp/geometry.dart';
Map<String, Object?> benchmark(String kind, int size, int samples) {
  if (!['geometric-axis', 'geometric-drag'].contains(kind) || size < 1 || size > 500 || samples < 1 || samples > 9) throw ArgumentError('Unsupported probe request');
  final drag = kind == 'geometric-drag', b = GeometryBuilder();
  final origin = b.point3('origin', Vec3.zero, fixed: true), axis = b.point3('axis', Vec3.unitX, fixed: true);
  final radius = b.dimension('radius', drag ? 5 : 10, lower: 0.001), count = drag ? 1 : size;
  for (var i = 0; i < count; i++) {
    final point = b.point3('p$i', drag ? const Vec3(3,4,0) : const Vec3(8,1,0.5));
    if (drag) b.pointOnPlane('plane$i', point, GeometryPlane(origin, Vec3.unitZ));
    else b.pointOnLine('axis$i', point, GeometryLine(origin, axis));
    b.distance('distance$i', origin, point, radius);
  }
  final compileClock = Stopwatch()..start(); final session = b.compile().createSession(); compileClock.stop();
  var maximumError = 0.0;
  void check(GeometrySolveResult result, double target) {
    if (!result.isSuccess || result.localDegreesOfFreedom != (drag ? 1 : 0)) throw StateError('Solve failed: ${result.status}; dof=${result.localDegreesOfFreedom}');
    for(var i=0;i<count;i++) {
      final p=result.values['p$i']!, radial=(math.sqrt(result.values['p$i']!.fold<double>(0,(sum,x)=>sum+x*x))-target).abs();
      final error=drag?math.max(radial,p[2].abs()):math.max(radial,math.max((p[0]-target).abs(),math.max(p[1].abs(),p[2].abs())));
      maximumError=math.max(maximumError,error);
      if(!error.isFinite||error>2e-7) throw StateError('Independent residual check failed: $error');
    }
  }
  final coldClock=Stopwatch()..start(); final first=session.solve();coldClock.stop();check(first,drag?5:10);
  final times=<int>[];GeometrySolveResult last=first;
  for(var i=0;i<samples+2;i++) {
    final radiusValue=drag?5.0:10.1+(i%2)*0.1;
    if(!drag)session.setParameterValues(radius.id,[radiusValue]);
    final angle=0.7+(i%2)*0.1,target=[5*math.cos(angle),5*math.sin(angle),0.0],clock=Stopwatch()..start();
    last=drag?session.solve(preferences:[GeometryParameterTarget(parameterId:'p0',values:target)]):session.solve();
    clock.stop();check(last,radiusValue);
    if(drag){final p=last.values['p0']!;if(math.sqrt(List.generate(3,(j)=>(p[j]-target[j])*(p[j]-target[j])).reduce((a,b)=>a+b))>1e-3)throw StateError('Drag target not approached');}
    if(i>=2)times.add(clock.elapsedMicroseconds);
  }
  final sorted=[...times]..sort();
  return {'kind':kind,'entities':count,'scalarCoordinates':count*3,'samples':samples,'warmups':2,'compileUs':compileClock.elapsedMicroseconds,'coldUs':coldClock.elapsedMicroseconds,'warmUs':times,'medianWarmUs':sorted[sorted.length~/2],'p95WarmUs':sorted[((sorted.length-1)*.95).ceil()],'maxIndependentError':maximumError,'localDegreesOfFreedom':last.localDegreesOfFreedom,'status':last.status.name,'componentsSolved':last.stats.componentsSolved,'componentsReused':last.stats.componentsReused};
}
