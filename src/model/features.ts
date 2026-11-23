// Feature factories, display names and parameter metadata.

import type {
  AxisRef, ChamferFeature, CircularPatternFeature, DraftFeature, ExtrudeFeature, Feature, FeatureType, FilletFeature, HoleFeature,
  Id, LinearPatternFeature, LoftFeature, MirrorFeature, PartDocument, PlaneFeature, PlaneRef, RevolveFeature, ShaftFeature, ShellFeature,
  SketchFeature, SweepFeature,
} from './types';
import { tr } from '../i18n';

export type ParamKind = 'length' | 'angle' | 'count';

export interface ThreadPreset {
  id: string;
  label: string;
  nominal: number;
  pitch: number;
  tapDrill: number;
}

/** Common metric coarse and inch UNC tapped-hole presets, in millimetres. */
export const THREAD_PRESETS: ThreadPreset[] = [
  { id: 'M2x0.4', label: 'M2 × 0.4', nominal: 2, pitch: 0.4, tapDrill: 1.6 },
  { id: 'M2.5x0.45', label: 'M2.5 × 0.45', nominal: 2.5, pitch: 0.45, tapDrill: 2.05 },
  { id: 'M3x0.5', label: 'M3 × 0.5', nominal: 3, pitch: 0.5, tapDrill: 2.5 },
  { id: 'M4x0.7', label: 'M4 × 0.7', nominal: 4, pitch: 0.7, tapDrill: 3.3 },
  { id: 'M5x0.8', label: 'M5 × 0.8', nominal: 5, pitch: 0.8, tapDrill: 4.2 },
  { id: 'M6x1', label: 'M6 × 1.0', nominal: 6, pitch: 1, tapDrill: 5 },
  { id: 'M8x1.25', label: 'M8 × 1.25', nominal: 8, pitch: 1.25, tapDrill: 6.8 },
  { id: 'M10x1.5', label: 'M10 × 1.5', nominal: 10, pitch: 1.5, tapDrill: 8.5 },
  { id: 'M12x1.75', label: 'M12 × 1.75', nominal: 12, pitch: 1.75, tapDrill: 10.2 },
  { id: 'M16x2', label: 'M16 × 2.0', nominal: 16, pitch: 2, tapDrill: 14 },
  { id: '1/4-20', label: '1/4-20 UNC', nominal: 6.35, pitch: 1.27, tapDrill: 5.1 },
  { id: '5/16-18', label: '5/16-18 UNC', nominal: 7.94, pitch: 1.41, tapDrill: 6.6 },
  { id: '3/8-16', label: '3/8-16 UNC', nominal: 9.53, pitch: 1.59, tapDrill: 8 },
  { id: '1/2-13', label: '1/2-13 UNC', nominal: 12.7, pitch: 1.95, tapDrill: 10.8 },
];

/** Paths (dot separated) of numeric parameters per feature type. */
export const PARAM_FIELDS: Partial<Record<FeatureType, { path: string; kind: ParamKind; label: string }[]>> = {
  extrude: [
    { path: 'depth', kind: 'length', label: tr("Depth") },
    { path: 'dir2.depth', kind: 'length', label: tr("Depth (Direction 2)") },
    { path: 'draft', kind: 'angle', label: tr("Draft angle") },
  ],
  revolve: [{ path: 'angle', kind: 'angle', label: tr("Angle") }],
  fillet: [{ path: 'radius', kind: 'length', label: tr("Radius") }],
  chamfer: [
    { path: 'distance', kind: 'length', label: tr("Distance") },
    { path: 'distance2', kind: 'length', label: tr("Distance 2") },
    { path: 'angle', kind: 'angle', label: tr("Angle") },
  ],
  shell: [{ path: 'thickness', kind: 'length', label: tr("Thickness") }],
  hole: [
    { path: 'diameter', kind: 'length', label: tr("Diameter") },
    { path: 'depth', kind: 'length', label: tr("Depth") },
    { path: 'cbDiameter', kind: 'length', label: tr("Counterbore diameter") },
    { path: 'cbDepth', kind: 'length', label: tr("Counterbore depth") },
    { path: 'cb2Diameter', kind: 'length', label: tr("Second counterbore diameter") },
    { path: 'cb2Depth', kind: 'length', label: tr("Second counterbore depth") },
    { path: 'csDiameter', kind: 'length', label: tr("Countersink diameter") },
    { path: 'csAngle', kind: 'angle', label: tr("Countersink angle") },
    { path: 'cdDiameter', kind: 'length', label: tr("Counterdrill diameter") },
    { path: 'cdDepth', kind: 'length', label: tr("Counterdrill depth") },
    { path: 'cdAngle', kind: 'angle', label: tr("Counterdrill angle") },
    { path: 'sfDiameter', kind: 'length', label: tr("Spotface diameter") },
    { path: 'sfDepth', kind: 'length', label: tr("Spotface depth") },
    { path: 'threadPitch', kind: 'length', label: tr("Thread pitch") },
    { path: 'tapDrillDiameter', kind: 'length', label: tr("Tap drill diameter") },
    { path: 'tipAngle', kind: 'angle', label: tr("Drill point angle") },
  ],
  linearPattern: [
    { path: 'dir1.spacing', kind: 'length', label: tr("Spacing") },
    { path: 'dir1.count', kind: 'count', label: tr("Instances") },
    { path: 'dir2.spacing', kind: 'length', label: tr("Spacing (Direction 2)") },
    { path: 'dir2.count', kind: 'count', label: tr("Instances (Direction 2)") },
  ],
  circularPattern: [
    { path: 'angle', kind: 'angle', label: tr("Angle") },
    { path: 'count', kind: 'count', label: tr("Instances") },
  ],
  plane: [{ path: 'offset', kind: 'length', label: tr("Offset") }, { path: 'angle', kind: 'angle', label: tr("Angle") }],
  draft: [{ path: 'angle', kind: 'angle', label: tr("Draft angle") }],
  shaft: [{ path: 'endChamfer', kind: 'length', label: tr("End chamfer") }],
};

const BASE_NAMES: Record<FeatureType, string> = {
  sketch: tr('Sketch'),
  extrude: tr('Extrude'),
  revolve: tr('Revolve'),
  fillet: tr('Fillet'),
  chamfer: tr('Chamfer'),
  shell: tr('Shell'),
  hole: tr('Hole'),
  linearPattern: tr('Linear Pattern'),
  circularPattern: tr('Circular Pattern'),
  mirror: tr('Mirror'),
  plane: tr('Plane'),
  loft: tr('Loft'),
  sweep: tr('Sweep'),
  draft: tr('Draft'),
  shaft: tr('Shaft'),
  import: tr('Imported'),
};

export const FEATURE_LABELS: Record<FeatureType, string> = {
  sketch: tr('Sketch'),
  extrude: tr('Extrude'),
  revolve: tr('Revolve'),
  fillet: tr('Fillet'),
  chamfer: tr('Chamfer'),
  shell: tr('Shell'),
  hole: tr('Hole'),
  linearPattern: tr('Linear Pattern'),
  circularPattern: tr('Circular Pattern'),
  mirror: tr('Mirror'),
  plane: tr('Reference Plane'),
  loft: tr('Loft'),
  sweep: tr('Sweep'),
  draft: tr('Draft'),
  shaft: tr('Shaft'),
  import: tr('Imported Body'),
};

export function featureIcon(f: Feature): string {
  switch (f.type) {
    case 'sketch': return 'sketchFeature';
    case 'extrude': return f.cut ? 'extrudeCut' : 'extrude';
    case 'revolve': return f.cut ? 'revolveCut' : 'revolve';
    case 'loft': return 'loft';
    case 'sweep': return 'sweep';
    case 'import': return 'part';
    default: return f.type;
  }
}

/** Next free display name such as "Extrude3". */
export function nextName(doc: PartDocument, base: string): string {
  let n = 1;
  const names = new Set(doc.features.map((f) => f.name));
  while (names.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function defaultName(doc: PartDocument, type: FeatureType, cut = false): string {
  const base = cut && (type === 'extrude' || type === 'revolve') ? `Cut-${BASE_NAMES[type]}` : BASE_NAMES[type];
  return nextName(doc, base);
}

export const newSketch = (id: Id, name: string, plane: PlaneRef): SketchFeature => ({ id, name, type: 'sketch', plane, entities: [], constraints: [] });

export const newExtrude = (id: Id, name: string, sketch: Id, cut: boolean, depth: number): ExtrudeFeature => ({
  id, name, type: 'extrude', sketch, cut, end: cut ? 'throughAll' : 'blind', depth, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null,
});

export const newRevolve = (id: Id, name: string, sketch: Id, cut: boolean): RevolveFeature => ({
  id, name, type: 'revolve', sketch, cut, axis: null, end: 'blind', angle: 360, flip: false, thin: null,
});

export const newFillet = (id: Id, name: string, radius: number): FilletFeature => ({ id, name, type: 'fillet', edges: [], faces: [], radius });

export const newChamfer = (id: Id, name: string, distance: number): ChamferFeature => ({
  id, name, type: 'chamfer', edges: [], faces: [], mode: 'distance', distance, distance2: distance, angle: 45, flip: false,
});

export const newShell = (id: Id, name: string, thickness: number): ShellFeature => ({ id, name, type: 'shell', faces: [], thickness, outward: false });

export const newHole = (id: Id, name: string, sketch: Id, diameter: number): HoleFeature => ({
  id, name, type: 'hole', sketch, kind: 'simple', diameter, end: 'throughAll', depth: diameter * 2, cbDiameter: diameter * 1.8, cbDepth: diameter * 0.6,
  csDiameter: diameter * 2, csAngle: 90, sfDiameter: diameter * 1.8, sfDepth: diameter * 0.4,
  cb2Diameter: diameter * 2.4, cb2Depth: diameter * 0.4, cdDiameter: diameter * 1.8, cdDepth: diameter * 0.5, cdAngle: 90,
  threadSize: 'Custom', threadPitch: diameter * 0.15, threadClass: '6H', tapDrillDiameter: diameter * 0.85,
  tip: 'drill', tipAngle: 118, flip: false,
});

export const newShaft = (id: Id, name: string): ShaftFeature => ({
  id, name, type: 'shaft',
  segments: [
    { diameter: 25, length: 40 },
    { diameter: 35, length: 60 },
    { diameter: 45, length: 35 },
    { diameter: 30, length: 45 },
  ],
  endChamfer: 1.5,
  keyway: null,
  material: 'steel45',
  power: 5,
  speed: 1450,
  serviceFactor: 1.2,
  allowableShear: 40,
});

export const newLinearPattern = (id: Id, name: string, seeds: Id[], spacing: number): LinearPatternFeature => ({
  id, name, type: 'linearPattern', seeds, dir1: { ref: null, spacing, count: 3, flip: false }, dir2: null,
});

export const newCircularPattern = (id: Id, name: string, seeds: Id[]): CircularPatternFeature => ({
  id, name, type: 'circularPattern', seeds, axis: null, angle: 360, count: 4, equal: true, flip: false,
});

export const newMirror = (id: Id, name: string, seeds: Id[]): MirrorFeature => ({ id, name, type: 'mirror', seeds, plane: null });

export const newPlane = (id: Id, name: string, ref: PlaneRef | null, offset: number): PlaneFeature =>
  ({ id, name, type: 'plane', kind: 'offset', ref, offset, flip: false });

export const newLoft = (id: Id, name: string, profiles: Id[], cut: boolean): LoftFeature => ({ id, name, type: 'loft', profiles, cut, ruled: false });

export const newSweep = (id: Id, name: string, cut: boolean): SweepFeature => ({ id, name, type: 'sweep', profile: null, path: null, cut });

export const newDraft = (id: Id, name: string): DraftFeature => ({ id, name, type: 'draft', faces: [], neutral: null, angle: 3, flip: false });

/** Features that consume a sketch (the sketch is shown nested under them). */
export function consumedSketches(f: Feature): Id[] {
  switch (f.type) {
    case 'extrude':
    case 'revolve':
    case 'hole':
      return [f.sketch];
    case 'loft':
      return f.profiles;
    case 'sweep':
      return [f.profile, f.path].filter((x): x is Id => !!x);
    default:
      return [];
  }
}

/**
 * Ids of the features that created a named face or edge. Face names start
 * with the creating feature ("f3:cap1"), patterned and mirrored copies add
 * "@<pattern>.<n>", and edge names join the names of their faces with "|".
 */
export function refFeatureIds(name: string): Id[] {
  const out: Id[] = [];
  for (const part of name.split('|')) {
    const [base, ...copies] = part.replace(/#\d+$/, '').split('@');
    const i = base.indexOf(':');
    if (i > 0) out.push(base.slice(0, i));
    for (const c of copies) { const id = c.split('.')[0]; if (id) out.push(id); }
  }
  return out;
}

/** Ids of features a feature depends on (for delete warnings and ordering). */
export function dependencies(f: Feature): Id[] {
  const out = new Set<Id>(consumedSketches(f));
  const visitName = (name: string) => { for (const id of refFeatureIds(name)) if (id !== f.id) out.add(id); };
  const visitPlane = (p: PlaneRef | null | undefined) => {
    if (p?.kind === 'feature') out.add(p.id);
    else if (p?.kind === 'face') visitName(p.face.name);
  };
  const visitAxis = (a: AxisRef | null | undefined) => {
    if (a?.kind === 'sketchLine') out.add(a.sketch);
    else if (a?.kind === 'edge') visitName(a.edge.name);
    else if (a?.kind === 'face') visitName(a.face.name);
  };
  if (f.type === 'sketch') {
    visitPlane(f.plane);
    // Geometry projected from the model depends on the features that made its edges.
    for (const e of f.entities) {
      if (e.ext?.kind === 'edge') visitName(e.ext.edge.name);
      else if (e.ext?.kind === 'vertex') e.ext.edges.forEach((r) => visitName(r.name));
    }
  }
  if (f.type === 'plane') {
    visitPlane(f.ref);
    visitPlane(f.ref2);
    visitAxis(f.axis);
  }
  if (f.type === 'hole' && f.toFace) visitName(f.toFace.name);
  if (f.type === 'mirror') { visitPlane(f.plane); f.seeds.forEach((s) => out.add(s)); }
  if (f.type === 'draft') { visitPlane(f.neutral); f.faces.forEach((r) => visitName(r.name)); }
  if (f.type === 'linearPattern' || f.type === 'circularPattern') f.seeds.forEach((s) => out.add(s));
  if (f.type === 'revolve' || f.type === 'circularPattern') visitAxis(f.axis);
  if (f.type === 'linearPattern') for (const d of [f.dir1, f.dir2]) visitAxis(d?.ref);
  if (f.type === 'fillet' || f.type === 'chamfer') { f.edges.forEach((r) => visitName(r.name)); f.faces.forEach((r) => visitName(r.name)); }
  if (f.type === 'shell') f.faces.forEach((r) => visitName(r.name));
  return [...out];
}

export function getPath(obj: unknown, path: string): unknown {
  let cur = obj as Record<string, unknown> | null;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[k] as Record<string, unknown> | null;
  }
  return cur;
}

export function setPath(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.');
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) return;
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}
