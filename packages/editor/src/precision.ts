// SPDX-License-Identifier: BSD-3-Clause
/** Integrate pointer travel rather than rescaling the entire gesture. Changing
 * precision mid-drag must not jump back towards its starting position. */
export function precisionTracker(start:readonly number[]){
 let previous=[...start],value=[...start];
 return {sample(raw:readonly number[],fine:boolean){const gain=fine?.1:1;value=value.map((v,i)=>v+(raw[i]-previous[i])*gain);previous=[...raw];return [...value];}};
}
/** Shift makes native number steppers ten times finer without changing stored
 * expression syntax. Text inputs/formulas keep their ordinary keyboard behavior. */
export function fineNumberKeys(input:HTMLInputElement,event:KeyboardEvent){
 if(!event.shiftKey||!['ArrowUp','ArrowDown'].includes(event.key)||input.type!=='number'||input.readOnly||input.disabled||!Number.isFinite(input.valueAsNumber))return false;
 const step=Number(input.step);if(!Number.isFinite(step)||step<=0)return false;
 event.preventDefault();event.stopPropagation();let value=input.valueAsNumber+(event.key==='ArrowUp'?1:-1)*step/10;
 if(input.min!=='')value=Math.max(Number(input.min),value);if(input.max!=='')value=Math.min(Number(input.max),value);
 input.value=String(Number(value.toPrecision(12)));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;
}
