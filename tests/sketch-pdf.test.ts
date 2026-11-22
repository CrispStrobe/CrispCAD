// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {createCadSession} from '@brickwright/cad-core';
import {exportSketchPdf} from '../packages/editor/src/sketch-pdf.js';

const source = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const latinHex = (text: string) => Buffer.from(text,'latin1').toString('hex');

it('writes a vector A4 template with a real-size 50 mm reference and valid PDF offsets', () => {
  const session = createCadSession();
  const id = session.addSketchExtrusion({kind:'rectangle',id:'outline',width:40,depth:30}, {name:'Montage (Ä)',distance:5});
  const file = exportSketchPdf(session.state.document,id);
  expect(file).toMatchObject({name:'Montage -Ä--1-to-1.pdf',mime:'application/pdf'});
  const pdf = source(file.bytes);
  expect(pdf).toContain('/MediaBox [0 0 595.27559 841.88976]');
  expect(pdf).toContain('/PrintScaling /None');
  expect(pdf).toContain('2.83465 0 0 2.83465 0 0 cm');
  expect(pdf).toContain('15 16 m 65 16 l S');
  expect(pdf).toContain('85 128.5 m 125 128.5 l 125 158.5 l 85 158.5 l h S');
  expect(pdf).toContain('<'+latinHex('Montage (Ä)')+'>');
  expect(pdf).not.toContain('/Subtype /Image');
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  expect(pdf.slice(xref)).toMatch(/^xref\n0 6/);
  for (const [index, entry] of [...pdf.matchAll(/^(\d{10}) 00000 n\r?$/gm)].entries()){
    expect(pdf.slice(Number(entry[1]))).toMatch(new RegExp('^'+(index+1)+' 0 obj'));
  }
  session.dispose();
});

it('re-exports current hole spacing and leaves project history alone', () => {
  const session = createCadSession();
  const parameters = {version:1 as const, parameters:{spacing:{expression:'20',unit:'mm' as const}},bindings:[]};
  session.setParametric(parameters);
  const id = session.addSketchExtrusion({kind:'region',id:'plate',loops:[
    {kind:'outline',id:'body',points:[[0,0],[40,0],[40,30],[0,30]]},
    {kind:'circle',id:'left',center:['20 mm - spacing / 2',15],radius:2,segments:64},
    {kind:'circle',id:'right',center:['20 mm + spacing / 2',15],radius:2,segments:64}
  ]},{distance:5});
  const saved=session.serialize();
  const before=source(exportSketchPdf(session.state.document,id).bytes);
  expect(before).toContain('95 142.1 m 95 144.9 l S');
  expect(before).toContain('115 142.1 m 115 144.9 l S');
  expect(session.serialize()).toBe(saved);
  session.setParametric({...parameters,parameters:{spacing:{expression:'28',unit:'mm'}}});
  const after=source(exportSketchPdf(session.state.document,id).bytes);
  expect(after).toContain('91 142.1 m 91 144.9 l S');
  expect(after).toContain('119 142.1 m 119 144.9 l S');
  session.undo();
  expect(source(exportSketchPdf(session.state.document,id).bytes)).toBe(before);
  session.remove([id]);
  expect(()=>exportSketchPdf(session.state.document,id)).toThrow('requires an original sketch extrusion');
  session.dispose();
});

it('uses a landscape sheet for a wide plate and reports oversized drawings without rescaling', () => {
  const session=createCadSession();
  const id=session.addSketchExtrusion({kind:'rectangle',id:'wide',width:250,depth:80},{distance:3});
  expect(source(exportSketchPdf(session.state.document,id).bytes)).toContain('/MediaBox [0 0 841.88976 595.27559]');
  const huge=session.addSketchExtrusion({kind:'rectangle',id:'large',width:300,depth:300},{distance:5});
  expect(()=>exportSketchPdf(session.state.document,huge)).toThrow('too large');
  session.dispose();
});
