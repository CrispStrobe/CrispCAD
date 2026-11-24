// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';

export interface TerminalAlias {name:string;command:string}
type Command={name:string;aliases:readonly string[]};
type Storage={getItem(key:string):string|null;setItem(key:string,value:string):void};
const storageKey='brickwright-cad:terminal-aliases:v1';
const maxAliases=64,maxStoredLength=16384;
const validName=(name:string)=>/^[a-z][a-z0-9_-]{0,31}$/.test(name);

/** User preferences only. Targets are canonical names, never expansion text. */
export function createTerminalAliases(commands:readonly Command[],storage?:Storage){
 const builtins=new Map<string,string>();
 for(const command of commands)for(const name of [command.name,...command.aliases])builtins.set(name.toLowerCase(),command.name);
 const canonical=new Set(commands.map(command=>command.name));
 let aliases=new Map<string,string>();
 // Retry failed writes and merge sequential editors' unrelated changes.
 const dirty=new Map<string,string|null>();
 function read():Map<string,string>|null|undefined{
  if(!storage)return undefined;
  let raw:string|null;
  // An inaccessible collection may contain another editor's changes. Keep it
  // distinct from malformed data, which the next save can deliberately repair.
  try{raw=storage.getItem(storageKey);}catch{return undefined;}
  if(raw===null)return new Map();
  if(raw.length>maxStoredLength)return null;
  try{
   const data:unknown=JSON.parse(raw);
   if(!data||typeof data!=='object'||Array.isArray(data))return null;
   const saved=data as {version?:unknown;aliases?:unknown};
   if(saved.version!==1||!Array.isArray(saved.aliases)||saved.aliases.length>maxAliases)return null;
   const result=new Map<string,string>();
   for(const entry of saved.aliases){
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(key=>key!=='name'&&key!=='command'))continue;
    if(typeof entry.name!=='string'||typeof entry.command!=='string')continue;
    const name=entry.name.toLowerCase();
    if(validName(name)&&!builtins.has(name)&&canonical.has(entry.command)&&!result.has(name))result.set(name,entry.command);
   }
   return result;
  }catch{return null;}
 }
 function refresh(){
  const saved=read();if(!saved)return;
  for(const [name,command] of dirty){if(command===null)saved.delete(name);else saved.set(name,command);}
  if(saved.size<=maxAliases)aliases=saved;
 }
 function save():boolean{
  if(!storage){dirty.clear();return true;}
  try{
   const saved=read();
   if(saved===undefined)return false;
   if(saved){
    for(const [name,command] of dirty){if(command===null)saved.delete(name);else saved.set(name,command);}
    if(saved.size>maxAliases)return false;
    aliases=saved;
   }
   storage.setItem(storageKey,JSON.stringify({version:1,aliases:list()}));dirty.clear();return true;
  }
  catch{return false;}
 }
 function list():TerminalAlias[]{return [...aliases].sort(([a],[b])=>a.localeCompare(b)).map(([name,command])=>({name,command}));}
 function nameOf(value:string):string{
  const name=value.toLowerCase();
  if(!validName(name))throw new Error(t('Alias names must start with a letter and use 1–32 letters, digits, hyphens or underscores.'));
  return name;
 }
 function editableName(value:string):string{
  const name=nameOf(value);
  if(builtins.has(name))throw new Error(t('Built-in commands and fixed aliases cannot be changed.'));
  return name;
 }
 refresh();
 return {
  list,
  resolve(value:string):string|undefined{return aliases.get(value.toLowerCase());},
  get(value:string):TerminalAlias{
   const name=nameOf(value),command=aliases.get(name);
   if(!command)throw new Error(t('No custom alias has that name.'));
   return {name,command};
  },
  set(value:string,target:string):{alias:TerminalAlias;saved:boolean}{
   const name=editableName(value);refresh();
   const command=builtins.get(target.toLowerCase())??aliases.get(target.toLowerCase());
   if(!command)throw new Error(t('Choose an existing command or alias as the target.'));
   if(!aliases.has(name)&&aliases.size>=maxAliases)throw new Error(t('At most 64 custom aliases can be saved.'));
   aliases.set(name,command);dirty.set(name,command);
   return {alias:{name,command},saved:save()};
  },
  remove(value:string):{name:string;saved:boolean}{
   const name=editableName(value);refresh();
   if(!aliases.has(name))throw new Error(t('No custom alias has that name.'));
   aliases.delete(name);dirty.set(name,null);
   return {name,saved:save()};
  },
 };
}
