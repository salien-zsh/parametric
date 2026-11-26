import type { DrawingDoc } from './types';

const sheets = new Set(['A4', 'A3', 'A2', 'A1', 'Letter', 'Tabloid']);
const kinds = new Set(['front', 'back', 'left', 'right', 'top', 'bottom', 'isometric', 'section', 'detail', 'auxiliary']);
const axes = new Set(['x', 'y', 'z']);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Check the sheet and every view before a file can replace the open document. */
export function validDrawing(value: unknown, nested = false): value is DrawingDoc {
  if (!object(value) || (nested && value.sheets != null) || typeof value.sheet !== 'string' || !sheets.has(value.sheet)
    || typeof value.landscape !== 'boolean' || !finite(value.scale) || value.scale <= 0
    || typeof value.title !== 'string' || typeof value.drawnBy !== 'string' || typeof value.notes !== 'string'
    || (value.number != null && typeof value.number !== 'string')
    || (value.revision != null && typeof value.revision !== 'string')
    || !Array.isArray(value.views)) return false;
  if (value.callouts != null) {
    if (!Array.isArray(value.callouts)) return false;
    for (const c of value.callouts) {
      if (!object(c) || typeof c.id !== 'string' || !c.id || typeof c.view !== 'string' || !c.view) return false;
      if (typeof c.text !== 'string') return false;
      if (!Array.isArray(c.p) || c.p.length !== 2 || !c.p.every(finite)) return false;
    }
  }
  if (value.dimensions != null) {
    if (!Array.isArray(value.dimensions)) return false;
    for (const d of value.dimensions) {
      if (!d || typeof d !== 'object') return false;
      const dim = d as Record<string, unknown>;
      if (typeof dim.id !== 'string' || !dim.id || typeof dim.view !== 'string' || !dim.view) return false;
      const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
      if (!pair(dim.a) || !pair(dim.b) || typeof dim.offset !== 'number' || !Number.isFinite(dim.offset)) return false;
    }
  }
  if (value.sheets != null) {
    if (!Array.isArray(value.sheets)) return false;
    for (const sheet of value.sheets) if (!validDrawing(sheet, true)) return false;
  }
  const ids = new Set<string>();
  for (const v of value.views) {
    if (!object(v) || typeof v.id !== 'string' || !v.id || ids.has(v.id)
      || typeof v.kind !== 'string' || !kinds.has(v.kind) || !finite(v.x) || !finite(v.y)
      || typeof v.hidden !== 'boolean' || typeof v.dims !== 'boolean') return false;
    if (v.scale != null && (!finite(v.scale) || v.scale <= 0)) return false;
    if (v.centers != null && typeof v.centers !== 'boolean') return false;
    if (v.balloons != null && typeof v.balloons !== 'boolean') return false;
    if (v.section != null && (!object(v.section) || typeof v.section.axis !== 'string' || !axes.has(v.section.axis)
      || !finite(v.section.offset) || (v.section.flip != null && typeof v.section.flip !== 'boolean'))) return false;
    if (v.auxiliary != null && (!object(v.auxiliary) || !object(v.auxiliary.face) || typeof v.auxiliary.face.name !== 'string' || !v.auxiliary.face.name)) return false;
    if (v.detail != null && (!object(v.detail) || typeof v.detail.source !== 'string' || !v.detail.source
      || !finite(v.detail.x) || !finite(v.detail.y) || !finite(v.detail.radius) || v.detail.radius <= 0
      || !finite(v.detail.scale) || v.detail.scale <= 0)) return false;
    ids.add(v.id);
  }
  return true;
}
