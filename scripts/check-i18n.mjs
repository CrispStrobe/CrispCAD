// SPDX-License-Identifier: BSD-3-Clause
import ts from 'typescript';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const catalog=new Map(),conflicts=[];
for(const file of await readdir('packages/core/src/locales')){
 const source=ts.createSourceFile(file,await readFile(join('packages/core/src/locales',file),'utf8'),ts.ScriptTarget.Latest,true);
 function visit(n){if(ts.isPropertyAssignment(n)&&ts.isStringLiteral(n.name)&&ts.isStringLiteral(n.initializer)){
  const key=n.name.text,value=n.initializer.text,previous=catalog.get(key);
  if(previous&&previous.value!==value)conflicts.push(`${key}: ${previous.file} / ${file}`);
  const slots=s=>[...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort().join(',');
  if(slots(key)!==slots(value))throw Error(`Translation placeholders differ: ${file}: ${key}`);
  if(!value.trim())throw Error(`Empty translation: ${key}`);catalog.set(key,{value,file});
 }ts.forEachChild(n,visit);}visit(source);
}
const missing=[];let references=0;
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(['dist','build','node_modules','public','locales'].includes(entry.name))continue;const file=join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(/\.[mt]?[jt]sx?$/.test(file)&&file!=='packages/editor/assets/sketch-constraints.dart.js'){
 const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(n){let key;
  if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&['t','translate'].includes(n.expression.text)&&n.arguments.length===1&&ts.isStringLiteralLike(n.arguments[0]))key=n.arguments[0].text;
  if(ts.isTaggedTemplateExpression(n)&&ts.isIdentifier(n.tag)&&['t','translate'].includes(n.tag.text)){
   key=ts.isNoSubstitutionTemplateLiteral(n.template)?n.template.text:n.template.head.text+n.template.templateSpans.map((s,i)=>`{${i}}${s.literal.text}`).join('');
  }
  if(key!==undefined){references++;if(!catalog.has(key))missing.push(`${file}:${source.getLineAndCharacterOfPosition(n.getStart()).line+1}: ${JSON.stringify(key)}`);}ts.forEachChild(n,visit);
 }visit(source);
}}}
await walk('packages');await walk('apps/standalone/src');await walk('apps/mcp');await walk('apps/cli');
if(conflicts.length)console.error('Conflicting translations:\n'+conflicts.join('\n'));
if(missing.length)console.error('Missing translations:\n'+missing.join('\n'));
if(conflicts.length||missing.length)process.exitCode=1;else console.log(`PASS: ${catalog.size} German messages, ${references} literal/template references; placeholders and duplicate values agree. Dynamic labels need separate UI coverage.`);
