// SPDX-License-Identifier: BSD-3-Clause
import {readFile,writeFile,stat,access} from 'node:fs/promises';
import {resolve,extname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {importOpenSCAD,importJSCAD,exportOpenSCAD,exportJSCAD,exportCodeSource,compileCode,createCadSession,CadCodeError,setLocale,t} from '@brickwright/cad-core';
import {appendPortableRevision} from '@brickwright/cad-history';
export function convertSource(source,{from,to='cadcode',parameters={},entryPoint,arguments:args}={}){
 let program,outputs,warnings=[],evaluatedSnapshot=false,inputParameters={};
 if(from==='openscad')program=importOpenSCAD(source);
 else if(from==='jscad'){const result=importJSCAD(source,parameters,{entryPoint,arguments:args});({program,outputs,warnings,evaluatedSnapshot}=result);inputParameters=result.parameters;}
 else if(from==='cadcode')program={version:1,language:'brickwright-cad-script',source,parameters:{}};
 else throw Error(t('Choose openscad, jscad or cadcode as the input format'));
 if(from!=='jscad')program.parameters=parameters;compileCode(program);
 outputs??=[{program}];
 if(to==='bcad')return {program,outputs,warnings,evaluatedSnapshot,parameters:inputParameters};
 if(!['cadcode','openscad','jscad'].includes(to))throw Error(t('Choose cadcode, openscad, jscad or bcad as the output format'));
 const text=to==='openscad'?exportOpenSCAD(program):to==='jscad'?exportJSCAD(program):exportCodeSource(program);
 return {source:text,program,outputs,warnings,evaluatedSnapshot:evaluatedSnapshot||to!=='cadcode',parameters:inputParameters};
}
async function cli(){
 const args=process.argv.slice(2),options={};let file;
 for(let i=0;i<args.length;i++){if(args[i].startsWith('--')){const name=args[i].slice(2);if(name==='help'){console.log('node scripts/convert-code.mjs INPUT --to cadcode|openscad|jscad|bcad [--out FILE] [--parameters JSON] [--entry FUNCTION --args JSON] [--locale en|de]');return;}if(!['from','to','out','parameters','entry','args','locale'].includes(name)||args[i+1]===undefined)throw Error(t`Invalid converter option “${args[i]}”`);options[name]=args[++i];}else if(!file)file=args[i];else throw Error(t('Choose one input file'));}
 setLocale(options.locale??'en');if(!file)throw Error(t('Choose an input source file'));const path=resolve(file);if((await stat(path)).size>32768)throw Error(t('Source exceeds 32 KiB'));const source=await readFile(path,'utf8'),from=options.from??({'.scad':'openscad','.jscad':'jscad','.js':'jscad','.cadcode':'cadcode'}[extname(path).toLowerCase()]);
 const result=convertSource(source,{from,to:options.to,parameters:options.parameters?JSON.parse(options.parameters):{},entryPoint:options.entry,arguments:options.args?JSON.parse(options.args):undefined});let text=result.source;
 if(options.to==='bcad'){const session=createCadSession();for(const [i,output] of result.outputs.entries()){const id=session.addCode(output.program,`${basename(path,extname(path))} ${i+1}`);if(output.color)session.update(id,{color:output.color});}text=new TextDecoder().decode(await appendPortableRevision(undefined,session.state.document,'Import coded model'));}
 const report={version:1,ok:true,input:{file:path,format:from,sha256:createHash('sha256').update(source).digest('hex')},outputFormat:options.to??'cadcode',evaluatedSnapshot:result.evaluatedSnapshot,outputs:result.outputs.length,warnings:result.warnings,parameters:result.parameters};
 if(options.out){const output=resolve(options.out),sidecar=output+'.conversion.json';for(const p of [output,sidecar]){try{await access(p);throw Error(t`Output already exists: ${p}`);}catch(error){if(error.code!=='ENOENT')throw error;}}await writeFile(sidecar,JSON.stringify({...report,originalSource:source},null,2)+'\n',{flag:'wx'});await writeFile(output,text,{flag:'wx'});report.outputFile=output;report.provenanceFile=sidecar;}else report.source=text;
 console.log(JSON.stringify(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)cli().catch(error=>{console.log(JSON.stringify({version:1,ok:false,error:{kind:error instanceof CadCodeError?'source':'conversion',message:error.message,...(error instanceof CadCodeError?{line:error.line,column:error.column,offset:error.offset}:{})}}));process.exitCode=2;});
