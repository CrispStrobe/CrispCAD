// SPDX-License-Identifier: BSD-3-Clause
import 'dart:convert';
import 'dart:js_interop';
import 'benchmark.dart';

@JS('cadConstraintBenchmark')
external set benchmarkCallback(JSFunction callback);
void main() {
  benchmarkCallback = ((JSString kind, JSNumber size, JSNumber samples) =>
      jsonEncode(benchmark(kind.toDart, size.toDartInt, samples.toDartInt))
          .toJS).toJS;
}
