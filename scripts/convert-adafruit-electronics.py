#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Offline conversion only; requires cadquery-ocp==7.8.1.1. No OCP runtime dependency.
Preserves STEP solid surfaces and colours. Does not certify collision or mass geometry.
"""
import json, hashlib
from pathlib import Path
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorSurf, XCAFDoc_ColorGen
from OCP.Quantity import Quantity_Color
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopLoc import TopLoc_Location
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
omitted=[]
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'library/sources/adafruit-electronics'
OUT=ROOT/'packages/editor/src/electronics-assets'
provenance=json.loads((SOURCE/'provenance.json').read_text())
(OUT/'sources.json').write_text(json.dumps(provenance,indent=2)+'\n')
def mesh(shape,transform):
 BRepMesh_IncrementalMesh(shape,0.12,False,0.22,True).Perform()
 vertices=[];indices=[];lookup={}
 e=TopExp_Explorer(shape,TopAbs_FACE)
 while e.More():
  f=TopoDS.Face_s(e.Current());loc=TopLoc_Location();tri=BRep_Tool.Triangulation_s(f,loc)
  if tri is None:
   props=GProp_GProps();BRepGProp.SurfaceProperties_s(f,props)
   area=props.Mass();assert area<0.01, f'Unmeshed face area {area}'
   omitted.append(area);e.Next();continue
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

for slug,name,transform in [
 ('feather-rp2040','4884 Feather RP2040.step',lambda p:[11.43-p[1],p[0]-25.4,p[2]-4]),
 ('aa-holder-830','830 Battery Holder 4xAA.step',lambda p:[p[0]-32.3,p[1]-35,p[2]-10.6]),
]:
 omitted.clear()
 source=next(f for f in provenance['files'] if f['local']==name)
 data=(SOURCE/name).read_bytes();assert hashlib.sha256(data).hexdigest()==source['sha256']
 assert 'SI_UNIT(.MILLI.,.METRE.)' in data.decode(), 'Source must declare millimetres'
 reader=STEPCAFControl_Reader();reader.SetColorMode(True);assert int(reader.ReadFile(str(SOURCE/name)))==1
 doc=TDocStd_Document(TCollection_ExtendedString('BinXCAF'));assert reader.Transfer(doc)
 colors=XCAFDoc_DocumentTool.ColorTool_s(doc.Main());e=TopExp_Explorer(reader.Reader().OneShape(),TopAbs_SOLID);parts=[]
 while e.More():
  solid=e.Current();color=Quantity_Color()
  found=colors.GetColor(solid,XCAFDoc_ColorSurf,color) or colors.GetColor(solid,XCAFDoc_ColorGen,color)
  rgb=[round(v,6) for v in [color.Red(),color.Green(),color.Blue()]] if found else [.055,.065,.08]
  part=mesh(solid,transform);part['color']=rgb;parts.append(part);e.Next()
 result={'omittedTinyFaceAreasMm2':list(omitted),'source':source,'parts':parts,'modificationNotes':'OCP 7.8.1.1 tessellation 0.12 mm / 0.22 rad. Rigid rotation/translation only; source solid colours retained, uncoloured solids dark grey. Visual-only geometry: existing clearance collider, mass and joints are unchanged. Unmeshable faces smaller than 0.01 square mm are recorded explicitly; not a watertight manufacturing export.'}
 (OUT/(slug+'.json')).write_text(json.dumps(result,separators=(',',':'))+'\n')
 print(slug,len(parts),'solids',sum(len(p['indices'])//3 for p in parts),'triangles')
