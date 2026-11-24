import type { DrawingDoc } from './types';

const sheets = new Set(['A4', 'A3', 'A2', 'A1', 'Letter', 'Tabloid']);
const kinds = new Set(['front', 'back', 'left', 'right', 'top', 'bottom', 'isometric', 'section', 'detail']);
const axes = new Set(['x', 'y', 'z']);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Check the sheet and every view before a file can replace the open document. */
export function validDrawing(value: unknown): value is DrawingDoc {
  if (!object(value) || typeof value.sheet !== 'string' || !sheets.has(value.sheet)
    || typeof value.landscape !== 'boolean' || !finite(value.scale) || value.scale <= 0
    || typeof value.title !== 'string' || typeof value.drawnBy !== 'string' || typeof value.notes !== 'string'
    || !Array.isArray(value.views)) return false;
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
    if (v.detail != null && (!object(v.detail) || typeof v.detail.source !== 'string' || !v.detail.source
      || !finite(v.detail.x) || !finite(v.detail.y) || !finite(v.detail.radius) || v.detail.radius <= 0
      || !finite(v.detail.scale) || v.detail.scale <= 0)) return false;
    ids.add(v.id);
  }
  return true;
}
