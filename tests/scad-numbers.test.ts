// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {formatSCADNumber} from '../packages/core/src/scad-numbers.js';
// Original probes evaluated by the official OpenSCAD 2021.01 binary, not source code.
it('matches the frozen executable vectors for numeric lettering, exponent boundaries and halfway rounding',()=>{
 const values=[0,-0,1,100000,999999,999999.5,1000000,.0001,.00001,.000001,1.015625,-1.015625,1.234375,1.23456789,1.23456789e-8,99999.95,1e9];
 const expected=['0','0','1','100000','999999','1e+6','1e+6','0.0001','0.00001','1e-6','1.01563','-1.01563','1.23438','1.23457','1.23457e-8','99999.9','1e+9'];expect(values.map(formatSCADNumber)).toEqual(expected);
 const grid=['1.23457e-8','1.23457e-7','1.23457e-6','0.0000123457','0.000123457','0.00123457','0.0123457','0.123457','1.23457','12.3457','123.457','1234.57','12345.7','123457','1.23457e+6','1.23457e+7','1.23457e+8'];expect(Array.from({length:17},(_,i)=>formatSCADNumber(1.23456789*10**(i-8)))).toEqual(grid);
});
