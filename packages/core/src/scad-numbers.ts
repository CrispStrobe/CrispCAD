// SPDX-License-Identifier: BSD-3-Clause
// Original decimal general-format conversion from the IEEE-754 rational value.
// No upstream formatter implementation. Compatibility is checked against CLI output.
import {t} from './i18n.js';
export function formatSCADNumber(value:number):string{
 if(!Number.isFinite(value))throw new Error(t('Expected a finite number'));if(value===0)return '0';const sign=value<0?'-':'',magnitude=Math.abs(value),bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,magnitude,false);const high=bytes.getUint32(0),low=bytes.getUint32(4),exponent=(high>>>20)&2047,bits=(BigInt(high&0xfffff)<<32n)|BigInt(low);let numerator=exponent?bits+(1n<<52n):bits,denominator=1n;const binaryExponent=exponent?exponent-1023-52:-1074;if(binaryExponent>=0)numerator<<=BigInt(binaryExponent);else denominator<<=BigInt(-binaryExponent);
 let decimalExponent=Math.floor(Math.log10(magnitude));const compare=(power:number)=>power>=0?numerator-denominator*10n**BigInt(power):numerator*10n**BigInt(-power)-denominator;while(compare(decimalExponent)<0n)decimalExponent--;while(compare(decimalExponent+1)>=0n)decimalExponent++;
 const scale=5-decimalExponent,n=scale>=0?numerator*10n**BigInt(scale):numerator,d=scale>=0?denominator:denominator*10n**BigInt(-scale);let rounded=n/d;const remainder=n%d;if(remainder*2n>=d)rounded++;if(rounded>=1000000n){rounded/=10n;decimalExponent++;}const digits=String(rounded).padStart(6,'0');
 if(decimalExponent>=6||decimalExponent< -5){const fraction=digits.slice(1).replace(/0+$/,'');return sign+digits[0]+(fraction?'.'+fraction:'')+'e'+(decimalExponent>=0?'+':'')+decimalExponent;}
 const position=decimalExponent+1,text=position<=0?'0.'+'0'.repeat(-position)+digits:digits.slice(0,position)+(position<digits.length?'.'+digits.slice(position):'');return sign+(text.includes('.')?text.replace(/0+$/,'').replace(/\.$/,''):text);
}
