// SPDX-License-Identifier: BSD-3-Clause
// Build-time assembly geometry. dart_csp is MIT; see docs/SIMLAB-PARITY.md.
import 'dart:convert';
import 'dart:math' as math;
import 'package:dart_csp/geometry.dart';
void main(){
 final b=GeometryBuilder();
 final origin=b.point3('origin',Vec3.zero,fixed:true),ground=b.point3('ground',const Vec3(60,0,0),fixed:true);
 final crank=b.point3('crank',Vec3(30*math.cos(math.pi/3),30*math.sin(math.pi/3),0),fixed:true),follower=b.point3('follower',const Vec3(70,30,0));
 b.distance('coupler length',crank,follower,b.dimension('coupler',60,lower:0));
 b.distance('follower length',ground,follower,b.dimension('followerLength',40,lower:0));
 b.pointOnPlane('linkage plane',follower,GeometryPlane(origin,Vec3.unitZ));
 final result=b.compile().createSession().solve();
 if(!result.isSuccess)throw StateError('Assembly solve failed: ${result.status}');
 final points={'origin':[0.0,0.0,0.0],'ground':[60.0,0.0,0.0],'crank':[15.0,30*math.sin(math.pi/3),0.0],'follower':result.values[follower.id]!};
 double distance(String a,String c)=>math.sqrt(List.generate(3,(i)=>math.pow(points[a]![i]-points[c]![i],2)).reduce((a,b)=>a+b));
 final errors=[(distance('origin','crank')-30).abs(),(distance('crank','follower')-60).abs(),(distance('follower','ground')-40).abs(),points['follower']![2].abs()];
 if(errors.any((value)=>!value.isFinite||value>1e-6))throw StateError('Independent assembly check failed: $errors');
 print(jsonEncode({'version':1,'solver':'dart_csp','revision':'46288eb23f04c2a2f2210088fe568285bea6114f','points':points,'lengths':{'ground':60,'crank':30,'coupler':60,'follower':40},'maxLengthErrorMm':errors.reduce(math.max),'status':'residual-checked'}));
}
