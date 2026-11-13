// SPDX-License-Identifier: BSD-3-Clause
import 'dart:convert';
import 'benchmark.dart';
void main(){for(final size in [10,100,500]){print(jsonEncode(benchmark('geometric-axis',size,7)));}print(jsonEncode(benchmark('geometric-drag',1,7)));}
