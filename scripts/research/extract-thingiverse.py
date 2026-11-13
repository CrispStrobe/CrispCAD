# SPDX-License-Identifier: BSD-3-Clause
"""Extract research-only fenced source files, preserving dataset/file boundaries.
Requires external Python/pyarrow. Never writes dataset contents into this repo.
"""
import argparse,collections,datetime,hashlib,json,pathlib,re
import pyarrow.parquet as pq
parser=argparse.ArgumentParser();parser.add_argument('--parquet',required=True);parser.add_argument('--revision',required=True);parser.add_argument('--out',required=True);args=parser.parse_args()
output=pathlib.Path(args.out).resolve();repo=pathlib.Path(__file__).resolve().parents[2]
if output.is_relative_to(repo):raise SystemExit('Research sources must be written outside the application repository')
output.parent.mkdir(parents=True,exist_ok=True)
source_file=pathlib.Path(args.parquet);parquet_hash=hashlib.sha256(source_file.read_bytes()).hexdigest()
pattern=re.compile(r'(?:^|\n)([^\n]+\.scad):[ \t]*\r?\n[ \t]*```[^\n]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)',re.I)
rows=0;files=0;excluded=[];licenses=collections.Counter();hashes=set();total_bytes=0
with output.open('w',encoding='utf8') as stream:
 for batch in pq.ParquetFile(source_file).iter_batches(batch_size=128,columns=['thingiverse_id','name','creator_name','license','scad']):
  for row in batch.to_pylist():
   index=rows;rows+=1;cell=row.get('scad') or '';matches=list(pattern.finditer(cell));remainder=pattern.sub('',cell).strip()
   if not matches or remainder:
    excluded.append({'row':index,'thingiverseId':row.get('thingiverse_id'),'reason':'unrecognized-or-partial-fenced-wrapper'});continue
   for part,match in enumerate(matches):
    name,source=match.groups();digest=hashlib.sha256(source.encode()).hexdigest();hashes.add(digest);size=len(source.encode());total_bytes+=size;license=row.get('license');licenses[license]+=1
    record={'id':f'thingiverse:{row["thingiverse_id"]}:{part}','dataset':'redcathode/thingiverse-openscad','revision':args.revision,'rowIndex':index,'fileIndex':part,'thingiverseId':row['thingiverse_id'],'name':row.get('name'),'creator':row.get('creator_name'),'license':license,'filename':name.strip(),'cellSha256':hashlib.sha256(cell.encode()).hexdigest(),'sourceSha256':digest,'sourceBytes':size,'extraction':'named-fenced-file-v1','source':source};stream.write(json.dumps(record,ensure_ascii=False)+'\n');files+=1
metadata={'researchOnly':True,'dataset':'redcathode/thingiverse-openscad','datasetRevision':args.revision,'datasetCardLicense':'CC-BY-NC-SA-4.0','captured':datetime.datetime.now(datetime.timezone.utc).isoformat(),'parquetSha256':parquet_hash,'rows':rows,'extractedFiles':files,'uniqueSources':len(hashes),'sourceBytes':total_bytes,'perFileLicenses':dict(licenses),'excludedRows':excluded,'output':str(output),'extraction':'named-fenced-file-v1; code is never concatenated across files; fakeprompt is ignored'}
output.with_suffix(output.suffix+'.metadata.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n');print(json.dumps({k:v for k,v in metadata.items() if k!='excludedRows'}));print(json.dumps({'excludedRows':len(excluded)}))
