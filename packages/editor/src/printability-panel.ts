// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {DEFAULT_PRINTABILITY_SETTINGS} from '@brickwright/cad-geometry';
import type {PrintabilityReport, PrintabilitySettings} from '@brickwright/cad-geometry';

export interface PrintabilityRow { status: 'pass' | 'warn' | 'fail'; label: string; detail: string }

const mm = (v: number) => v.toLocaleString(undefined, {maximumFractionDigits: 2});
const rotation = (deg: number, axis: number[]) => {
  if (Math.abs(deg) < 1e-9) return t('as modelled');
  const name = axis[0] ? 'X' : axis[1] ? 'Y' : 'Z';
  return t`rotate ${mm(deg)}° about ${name}`;
};

/** Plain rows per body for display; the report itself stays the source of truth. */
export function summarizePrintability(report: PrintabilityReport): {body: string; rows: PrintabilityRow[]}[] {
  return report.bodies.map(body => {
    const rows: PrintabilityRow[] = [];
    const topo = body.topology;
    rows.push(topo.watertight
      ? {status: 'pass', label: t('Watertight mesh'), detail: t('Pass')}
      : {status: 'fail', label: t('Watertight mesh'), detail: t`${topo.openEdges} open, ${topo.nonManifoldEdges} non-manifold edges`});
    const wall = body.minWall;
    rows.push({status: wall.violations.length ? 'fail' : 'pass', label: t('Minimum wall thickness'), detail: wall.thinnestMm === null ? t('Not measured') : t`${mm(wall.thinnestMm)} mm (limit ${mm(wall.thresholdMm)} mm)`});
    const current = body.current, best = body.orientations?.[0];
    if (current && best) {
      rows.push({status: current.unsupportedAreaMm2 > 0 ? 'warn' : 'pass', label: t('Unsupported overhang as modelled'), detail: t`${mm(current.unsupportedAreaMm2)} mm²`});
      rows.push({status: best.fitsBed ? (best.unsupportedAreaMm2 > 0 ? 'warn' : 'pass') : 'fail', label: t('Suggested print orientation'),
        detail: best.fitsBed ? t`${best.label ?? ''} up: ${rotation(best.rotation.deg, best.rotation.axis)}; ${mm(best.unsupportedAreaMm2)} mm² unsupported` : t('Does not fit the bed in any axis orientation')});
      if (best.bedContactLow || best.tipRisk) rows.push({status: 'warn', label: t('Bed adhesion'), detail: best.tipRisk ? t('Tall part on a small base may tip') : t('Small bed contact area')});
    }
    return {body: body.name, rows};
  });
}

function numberField(form: HTMLElement, label: string, value: number, step: number): HTMLInputElement {
  const wrap = document.createElement('label'); wrap.textContent = t(label);
  const input = document.createElement('input'); input.type = 'number'; input.min = String(step); input.step = String(step); input.value = String(value); input.setAttribute('aria-label', t(label));
  wrap.append(input); form.append(wrap); return input;
}

/** Modal "Check printability" dialog. Settings are a transient view preference, not model history. */
export function mountPrintabilityPanel(shell: HTMLElement, getDocument: () => CadDocument, check: (document: CadDocument, settings: Partial<PrintabilitySettings>) => Promise<PrintabilityReport>) {
  const dialog = document.createElement('dialog'); dialog.className = 'export-dialog printability-dialog'; dialog.setAttribute('aria-label', t('Check printability'));
  const heading = document.createElement('h2'); heading.textContent = t('Check printability');
  const form = document.createElement('div'); form.className = 'printability-settings';
  const d = DEFAULT_PRINTABILITY_SETTINGS;
  const fields = {
    nozzleMm: numberField(form, 'Nozzle (mm)', d.nozzleMm, 0.05), minWallMm: numberField(form, 'Minimum wall (mm)', d.minWallMm, 0.1),
    maxOverhangDeg: numberField(form, 'Maximum overhang (°)', d.maxOverhangDeg, 1), maxBridgeMm: numberField(form, 'Maximum bridge (mm)', d.maxBridgeMm, 1),
    bedX: numberField(form, 'Bed X (mm)', d.bedSizeMm.x, 1), bedY: numberField(form, 'Bed Y (mm)', d.bedSizeMm.y, 1), bedZ: numberField(form, 'Bed Z (mm)', d.bedSizeMm.z, 1),
  };
  const results = document.createElement('div'); results.className = 'printability-results'; results.setAttribute('aria-live', 'polite');
  const note = document.createElement('p'); note.textContent = `${t('Each body is checked as a separate part resting on the bed.')} ${t('Sampled screening of the tessellated mesh, not a guarantee of a successful print.')}`;
  const footer = document.createElement('footer');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = t('Close'); close.onclick = () => dialog.close();
  const run = document.createElement('button'); run.type = 'button'; run.className = 'primary'; run.textContent = t('Run check');
  footer.append(close, run); dialog.append(heading, form, results, note, footer);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  shell.append(dialog);
  let sequence = 0;
  const execute = async () => {
    const id = ++sequence, value = (input: HTMLInputElement) => Number(input.value);
    run.disabled = true; results.textContent = t('Checking…');
    try {
      const report = await check(getDocument(), {nozzleMm: value(fields.nozzleMm), minWallMm: value(fields.minWallMm), maxOverhangDeg: value(fields.maxOverhangDeg), maxBridgeMm: value(fields.maxBridgeMm), bedSizeMm: {x: value(fields.bedX), y: value(fields.bedY), z: value(fields.bedZ)}});
      if (id !== sequence) return;
      results.replaceChildren();
      if (!report.bodies.length) results.textContent = t('The design has no solid bodies to check');
      for (const body of summarizePrintability(report)) {
        const title = document.createElement('h3'); title.textContent = body.body;
        const list = document.createElement('dl');
        for (const row of body.rows) {
          const term = document.createElement('dt'); term.textContent = row.label;
          const detail = document.createElement('dd'); detail.textContent = row.detail; detail.dataset.status = row.status;
          list.append(term, detail);
        }
        results.append(title, list);
      }
    } catch (error) { if (id === sequence) results.textContent = error instanceof Error ? error.message : String(error); }
    finally { if (id === sequence) run.disabled = false; }
  };
  run.onclick = () => void execute();
  return {
    open() { results.replaceChildren(); dialog.showModal(); void execute(); },
    dispose() { sequence++; dialog.remove(); },
  };
}
