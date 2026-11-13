// SPDX-License-Identifier: BSD-3-Clause
// Original line icons for the workbench. No external icon/font dependency.
const paths: Record<string, string> = {
  Select:'M5 2 5 20l5-5 4 7 4-2-4-7h7Z',
  Parameters:'M3 6h18 M3 12h18 M3 18h18 M7 3v6 M16 9v6 M10 15v6',
  Shapes: 'M12 2 22 7v10l-10 5-10-5V7Z M2 7l10 5 10-5 M12 12v10 M18 21l3 2 3-2',
  Box: 'M12 2 22 7v10l-10 5-10-5V7Z M2 7l10 5 10-5 M12 12v10',
  Cylinder: 'M3 6c0-5 18-5 18 0s-18 5-18 0v12c0 5 18 5 18 0V6',
  Sphere: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c-7 6-7 14 0 20 7-6 7-14 0-20',
  Move: 'M12 2v20 M2 12h20 M8 6l4-4 4 4 M8 18l4 4 4-4 M6 8l-4 4 4 4 M18 8l4 4-4 4',
  Rotate: 'M20 8A9 9 0 1 0 21 16 M20 2v6h-6',
  Scale: 'M3 14v7h7 M21 10V3h-7 M3 21l7-7 M21 3l-7 7',
  Union: 'M3 3h11v5h7v13H8v-7H3Z',
  Subtract: 'M3 3h12v5H8v7H3Z M8 8h13v13H8Z',
  Intersect: 'M3 3h12v12H3Z M9 9h12v12H9Z M9 9h6v6H9',
  Undo: 'M9 4 3 10l6 6 M3 10h11a7 7 0 0 1 7 7v3',
  Redo: 'M15 4l6 6-6 6 M21 10H10a7 7 0 0 0-7 7v3',
  Duplicate: 'M8 8h13v13H8Z M16 8V3H3v13h5',
  Delete: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  'Drop to workplane': 'M12 2v12 M7 9l5 5 5-5 M3 17v4h18v-4',
  New: 'M5 2h10l4 4v16H5Z M15 2v5h4 M8 14h8 M12 10v8',
  Open: 'M2 19V5h8l3 3h9 M2 19l4-9h16l-4 9Z',
  'Save project': 'M3 3h15l3 3v15H3Z M7 3v6h9V3 M7 21v-8h10v8',
  STL: 'M12 2 22 7v10l-10 5-10-5V7Z M12 2v10l10 5 M12 12 2 17',
  '3MF': 'M12 2 22 7v10l-10 5-10-5V7Z M2 7l10 5 10-5 M12 12v10',
  Objects: 'M8 5h14 M8 12h14 M8 19h14 M2 4h2v2H2Z M2 11h2v2H2Z M2 18h2v2H2Z',
  Properties: 'M4 3v18 M12 3v18 M20 3v18 M1 8h6 M9 16h6 M17 7h6',
  Fit: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6 M8 8h8v8H8Z',
  Home: 'M2 11 12 2l10 9 M5 9v12h14V9 M9 21v-8h6v8',
  'Zoom in': 'M4 12h16 M12 4v16',
  'Zoom out': 'M4 12h16',
  'Orthographic view': 'M4 4h16v16H4Z M8 8h8v8H8Z',
  'Show workplane': 'M12 3 23 12l-11 9L1 12Z M6 8l11 9 M6 16 17 7',
  'Multi-select': 'M3 3h7v7H3Z M14 3h7v7h-7Z M3 14h7v7H3Z M14 18l3 3 5-7',
};
export function toolIcon(name: string): SVGSVGElement | null {
  const d = paths[name]; if (!d) return null;
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'tool-icon');
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path); return svg;
}
