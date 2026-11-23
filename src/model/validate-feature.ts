// Validate the references of features other than sketches at the file
// boundary. The feature tree, delete checks and the rebuild walk these lists
// and references, so a missing list or a reference without a name broke the
// app after the file had replaced the open document.
import type { Feature } from './types';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const named = (v: unknown) => object(v) && typeof v.name === 'string';
const list = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item);
// A feature's own sketch may be '' (a panel or the Assistant creates it before a
// sketch is picked); the rebuild reports that feature instead of failing the file.
const sketchId = (v: unknown) => typeof v === 'string';

function plane(v: unknown): boolean {
  if (v == null) return true;
  if (!object(v)) return false;
  if (v.kind === 'base') return ['front', 'top', 'right'].includes(String(v.plane));
  if (v.kind === 'feature') return id(v.id);
  return v.kind === 'face' && named(v.face);
}

function axis(v: unknown): boolean {
  if (v == null) return true;
  if (!object(v)) return false;
  if (v.kind === 'base') return ['x', 'y', 'z'].includes(String(v.axis));
  if (v.kind === 'edge') return named(v.edge);
  if (v.kind === 'face') return named(v.face);
  return v.kind === 'sketchLine' && id(v.sketch) && id(v.entity);
}

const patternDir = (v: unknown) => object(v) && axis(v.ref);
const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const vector3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function shaftSegment(v: unknown): boolean {
  return object(v) && positive(v.diameter) && positive(v.length);
}

function shaftKeyway(v: unknown): boolean {
  if (v == null) return true;
  return object(v) && typeof v.segment === 'number' && Number.isInteger(v.segment) && v.segment >= 0
    && positive(v.width) && positive(v.depth) && positive(v.length);
}

/** A numeric parameter: a literal, or a linked expression string. */
const numeric = (v: unknown) => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.length > 0);
const numbers = (r: Record<string, unknown>, keys: string[]) => keys.every((k) => numeric(r[k]));

export function validFeature(f: Feature): boolean {
  const r = f as unknown as Record<string, unknown>;
  switch (f.type) {
    case 'extrude':
      return sketchId(r.sketch);
    case 'hole':
      return sketchId(r.sketch) && (r.toFace == null || named(r.toFace));
    case 'revolve':
      return sketchId(r.sketch) && axis(r.axis);
    case 'fillet':
    case 'chamfer':
      return list(r.edges, named) && list(r.faces, named);
    case 'shell':
      return list(r.faces, named);
    case 'draft':
      return list(r.faces, named) && plane(r.neutral);
    case 'mirror':
      return list(r.seeds, id) && plane(r.plane);
    case 'plane': {
      const kind = r.kind ?? 'offset';
      if (!['offset', 'midplane', 'angle', 'tangent', 'twoEdges', 'threePoints'].includes(String(kind))) return false;
      if (kind === 'tangent') return named(r.face) && (r.point == null || vector3(r.point));
      if (kind === 'twoEdges') return list(r.edges, named) && (r.edges as unknown[]).length >= 2;
      if (kind === 'threePoints') return list(r.points, vector3) && (r.points as unknown[]).length >= 3;
      return plane(r.ref) && plane(r.ref2) && axis(r.axis);
    }
    case 'linearPattern':
      return list(r.seeds, id) && patternDir(r.dir1) && (r.dir2 == null || patternDir(r.dir2));
    case 'circularPattern':
      return list(r.seeds, id) && axis(r.axis);
    case 'loft':
      return list(r.profiles, id);
    case 'sweep':
      return (r.profile == null || id(r.profile)) && (r.path == null || id(r.path));
    case 'shaft':
      return list(r.segments, shaftSegment) && shaftKeyway(r.keyway);
    case 'spurGear':
      return numbers(r, ['module', 'teeth', 'pressureAngle', 'faceWidth', 'bore', 'hubDiameter', 'hubLength']);
    case 'bevelGear':
      return numbers(r, ['module', 'teeth', 'mateTeeth', 'faceWidth', 'bore', 'pressureAngle']);
    case 'wormGear':
      return numbers(r, ['module', 'wormStarts', 'wheelTeeth', 'wormDiameter', 'wormLength', 'faceWidth', 'bore']);
    case 'vBelt':
      return numbers(r, ['pulley1', 'pulley2', 'centerDistance', 'beltWidth', 'beltThickness', 'grooves']);
    case 'syncBelt':
      return numbers(r, ['toothPitch', 'pulley1', 'pulley2', 'centerDistance', 'beltWidth', 'beltThickness']);
    case 'sprocket':
      return numbers(r, ['pitch', 'teeth', 'rollerDiameter', 'toothWidth', 'bore', 'hubDiameter', 'hubLength']);
    default:
      return true;
  }
}
