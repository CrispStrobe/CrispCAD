// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';

// Only translate labels emitted by the application. Arbitrary labels supplied by
// API callers are preserved, and this function never changes stored revisions.
const labels = new Set([
  'Before restoring an iteration', 'Opened', 'Opened model', 'Opened project', 'Edit', 'Rename design',
  'Edit parameters', 'Detach shape generator', 'Edit shape parameters',
  'Add code object', 'Edit code object', 'Add sketch', 'Extrude sketch',
  'Add sketch extrusion', 'Edit sketch', 'Edit sketch extrusion', 'Add shape', 'Place shape', 'Change solid/hole role',
  'Add box', 'Add cylinder', 'Add sphere', 'Edit object', 'Transform selection',
  'union', 'intersect', 'Subtract (first selected is the base)', 'Separate operands',
  'Duplicate', 'Delete', 'Detach joints', 'Import geometry', 'Cut objects',
  'Paste objects', 'Restore coded project', 'Imported project', 'Duplicate project', 'Rename project', 'Edit model source', 'Run commands',
  'Fillet body', 'Chamfer body', 'Shell body', 'Add exact features', 'Edit exact feature', 'Recompute exact features',
]);
export function translateHistoryLabel(label: string): string {
  if (labels.has(label)) return t(label);
  const restored = /^Restored iteration ([1-9]\d*)$/.exec(label);
  if (restored) return t`Restored iteration ${restored[1]}`;
  return label;
}
