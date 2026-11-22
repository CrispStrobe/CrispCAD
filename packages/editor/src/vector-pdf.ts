// SPDX-License-Identifier: BSD-3-Clause
export const pointsPerMillimetre = 72 / 25.4;
export const decimal = (value: number) => Number(value.toFixed(5)).toString();
export const pair = (x: number, y: number) => decimal(x) + ' ' + decimal(y);

// Helvetica with WinAnsi encoding covers the Latin-1 characters below. Hex
// text keeps dynamic sketch names out of the PDF operators and offsets ASCII.
export const textOperand = (value: string) => '<' + [...value].map(character => {
  const code = character.charCodeAt(0);
  return (code >= 32 && code < 127 || code >= 160 && code <= 255 ? code : 63).toString(16);
}).join('') + '>';

export function singlePagePdf(width: number, height: number, content: string) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      pair(width * pointsPerMillimetre, height * pointsPerMillimetre) +
      '] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream'
  ];
  let pdf = '%PDF-1.6\n';
  const offsets = ['0000000000 65535 f\r\n'];
  for (const [index, body] of objects.entries()) {
    offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n\r\n');
    pdf += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
  }
  const xref = pdf.length;
  pdf += 'xref\n0 ' + offsets.length + '\n' + offsets.join('') +
    'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return new TextEncoder().encode(pdf);
}

