#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Offline only: pip install cadquery-ocp==7.8.1.1. Original MIT STEP solids -> closed meshes.
OCP is a conversion tool, not shipped application code. Units read from STEP (millimetres).
DC 711's front shaft is fused into its casing in the source: split at the collar's z=22 mm face.
"""
import json, hashlib
from pathlib import Path
from OCP.STEPControl import STEPControl_Reader
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID,TopAbs_FACE,TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopLoc import TopLoc_Location
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common,BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'library/sources/adafruit-motors'
OUTPUT=ROOT/'packages/editor/src/motor-assets';OUTPUT.mkdir(exist_ok=True)
PROVENANCE=json.loads((SOURCE/'provenance.json').read_text())
def solids(shape):
 e=TopExp_Explorer(shape,TopAbs_SOLID);out=[]
 while e.More():out.append(e.Current());e.Next()
 return out

def mesh(shape,transform):
 BRepMesh_IncrementalMesh(shape,0.08,False,0.15,True).Perform()
 vertices=[];indices=[];lookup={}
 e=TopExp_Explorer(shape,TopAbs_FACE)
 while e.More():
  f=TopoDS.Face_s(e.Current());loc=TopLoc_Location();tri=BRep_Tool.Triangulation_s(f,loc)
  assert tri is not None
  mapped={}
  for i in range(1,tri.NbNodes()+1):
   p=tri.Node(i).Transformed(loc.Transformation());key=tuple(round(n,6) for n in transform([p.X(),p.Y(),p.Z()]))
   if key not in lookup:lookup[key]=len(vertices)//3;vertices.extend(key)
   mapped[i]=lookup[key]
  for i in range(1,tri.NbTriangles()+1):
   a,b,c=tri.Triangle(i).Get()
   if f.Orientation()==TopAbs_REVERSED:b,c=c,b
   row=[mapped[a],mapped[b],mapped[c]]
   if len(set(row))==3:indices.extend(row)
  e.Next()
 return {'positions':vertices,'indices':indices}
for slug,path,shaft,axis,anchor,rotate in [
 ('tt-gearmotor','3777 TT Motor/3777 TT Motor.step',1,[0,1,0],[0,0,0],lambda p:[p[2],p[1],-p[0]]),
 ('tt-metal-gearmotor','3802 TT Motor Metal Gear/3802 TT Motor Metal Gear.step',1,[0,1,0],[0,0,0],lambda p:[p[0],p[2],-p[1]]),
 ('dc-toy-motor','711 DC Toy Motor/711 DC Toy Motor.step',-1,[1,0,0],[22,0,0],lambda p:[p[2],p[1],-p[0]])]:
 original=SOURCE/path;data=original.read_bytes();entry=next(f for f in PROVENANCE['files'] if f['path']==path)
 assert hashlib.sha256(data).hexdigest()==entry['sha256']
 assert 'SI_UNIT(.MILLI.,.METRE.)' in data.decode(), 'STEP must explicitly declare millimetres'
 reader=STEPControl_Reader();assert reader.ReadFile(str(original))==1;reader.TransferRoots();parts=solids(reader.OneShape())
 if shaft<0:
  cutter=BRepPrimAPI_MakeBox(gp_Pnt(-50,-50,22),100,100,100).Shape()
  output=solids(BRepAlgoAPI_Common(parts[0],cutter).Shape());assert len(output)==1
  parts=[*solids(BRepAlgoAPI_Cut(parts[0],cutter).Shape()),*parts[1:],output[0]];shaft=len(parts)-1
 meshes=[mesh(p,rotate) for p in parts]
 allpoints=[m['positions'] for m in meshes]
 lo=[min(min(v[i::3]) for v in allpoints) for i in range(3)];hi=[max(max(v[i::3]) for v in allpoints) for i in range(3)]
 offset=[-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2]]
 for m in meshes:m['positions']=[round(v+offset[i%3],6) for i,v in enumerate(m['positions'])]
 content={'source':entry,'axis':axis,'anchor':[round(v+offset[i],6) for i,v in enumerate(anchor)],'shaft':shaft,'parts':meshes,'toMillimetresZUp':[*rotate([1,0,0]),0,*rotate([0,1,0]),0,*rotate([0,0,1]),0,*offset,1],
 'modificationNotes':'STEP millimetres; OCP 7.8.1.1 tessellation 0.08 mm / 0.15 rad, welded at 1e-6 mm, rigid rotation and floor alignment; case solids retained and output shaft articulated.'+(' Source front shaft separated at z=22 mm collar face.' if slug=='dc-toy-motor' else '')}
 (OUTPUT/(slug+'.json')).write_text(json.dumps(content,separators=(',',':'))+'\n')
 print(slug,len(parts),'solids',sum(len(m['indices'])//3 for m in meshes),'triangles',flush=True)
