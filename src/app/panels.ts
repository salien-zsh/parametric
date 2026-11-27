// PropertyManager panels for creating and editing features.

import type { Frame, Vec2, Vec3 } from '../math/vec';
import { add, cross, dot, len, scale, sub, toLocal, toWorld } from '../math/vec';
import {
  defaultName, newChamfer, newCircularPattern, newDraft, newExtrude, newFillet, newHole, newLinearPattern, newLoft,
  newAxis, newBaseFlange, newBevelGear, newCoil, newEdgeFlange, newFlatPattern, newMirror, newMoveBody, newOffsetFace, newScaleBody, newSplitBody, newPlane, newPoint, newRevolve, newRib, newThread, newShaft, newShell, newSketch, newSpurGear, newSprocket, newSweep, newSyncBelt,
  newVBelt, newWormGear, THREAD_PRESETS,
} from '../model/features';
import { BASE_PLANE_NAMES } from '../model/planes';
import { SHAFT_MATERIALS, sizeShaft } from '../model/shaft';
import { BaseFeaturePanel } from './pm';
import { BevelGearPanel, SpurGearPanel, SprocketPanel, SyncBeltPanel, VBeltPanel, WormGearPanel } from './panels-pt';
import { formatNumber } from '../model/units';
import { ORIGIN_ID, SketchIndex, sketchBounds } from '../sketch/geom';
import { buildProfiles, inRegion } from '../sketch/profiles';
import type {
  AxisFeature, AxisKind, AxisRef, BaseFlangeFeature, ChamferFeature, CoilFeature, EdgeFlangeFeature, FlatPatternFeature, MoveBodyFeature, OffsetFaceFeature, RibFeature, ScaleBodyFeature, SplitBodyFeature, ThreadFeature, CircularPatternFeature, DraftFeature, EdgeRef, ExtrudeFeature, FaceRef, Feature, FilletFeature,
  HoleFeature, HoleKind, Id, LinearPatternFeature, LoftFeature, MirrorFeature, PatternDir, PlaneFeature, PlaneKind, PlaneRef, PointFeature, PointKind, RevolveFeature,
  ShaftFeature, ShellFeature, SketchFeature, SweepFeature,
} from '../model/types';
import { h } from '../ui/dom';
import type { App } from './app';
import {
  PropertyPanel, SelectionBox, type CanvasValue, type SelBoxItem, checkbox, flipButton, numberField, paramText, section, segmented, selectField, setNumberFieldValue,
} from './pm';
import { type SelItem, edgeRef, faceRef } from './selection';
import { tr } from '../i18n';

// ---------- conversions from picks ----------

function faceLabel(app: App, i: number): string {
  const f = app.faces[i];
  const owner = f ? app.store.feature(f.feature) : null;
  return `Face <${i + 1}>${owner ? ` of ${owner.name}` : ''}`;
}

export const toFace = (app: App, planarOnly = false) => (it: SelItem): SelBoxItem | null => {
  if (it.kind !== 'face') return null;
  const f = app.faces[it.index];
  if (!f || (planarOnly && f.type !== 'plane')) return null;
  return { item: it, data: faceRef(f), label: faceLabel(app, it.index) };
};

export const toEdge = (app: App) => (it: SelItem): SelBoxItem | null => {
  if (it.kind !== 'edge') return null;
  const e = app.edges[it.index];
  if (!e) return null;
  return { item: it, data: edgeRef(e), label: `Edge <${it.index + 1}> (${e.type})` };
};

export const toEdgeOrFace = (app: App) => (it: SelItem): SelBoxItem | null => toEdge(app)(it) ?? toFace(app)(it);

/** A picked model vertex, for references that store a point. */
export const toVertex = (it: SelItem): SelBoxItem | null => (it.kind === 'vertex' ? { item: it, data: it.p, label: tr("Vertex") } : null);

export const toPlane = (app: App) => (it: SelItem): SelBoxItem | null => {
  if (it.kind === 'plane') {
    const label = it.ref.kind === 'base' ? BASE_PLANE_NAMES[it.ref.plane] : app.store.feature(it.ref.id)?.name ?? tr("Plane");
    return { item: it, data: it.ref as PlaneRef, label };
  }
  if (it.kind === 'feature') {
    const f = app.store.feature(it.id);
    if (f?.type === 'plane') return { item: { kind: 'plane', ref: { kind: 'feature', id: f.id } }, data: { kind: 'feature', id: f.id } as PlaneRef, label: f.name };
  }
  if (it.kind === 'face') {
    const f = app.faces[it.index];
    if (f?.type !== 'plane') return null;
    return { item: it, data: { kind: 'face', face: faceRef(f) } as PlaneRef, label: faceLabel(app, it.index) };
  }
  return null;
};

export const toAxis = (app: App) => (it: SelItem): SelBoxItem | null => {
  if (it.kind === 'edge') {
    const e = app.edges[it.index];
    if (!e || (e.type !== 'line' && e.type !== 'circle')) return null;
    return { item: it, data: { kind: 'edge', edge: edgeRef(e) } as AxisRef, label: `Edge <${it.index + 1}> (${e.type})` };
  }
  if (it.kind === 'face') {
    const f = app.faces[it.index];
    if (!f || (f.type !== 'cylinder' && f.type !== 'plane')) return null;
    return { item: it, data: { kind: 'face', face: faceRef(f) } as AxisRef, label: faceLabel(app, it.index) };
  }
  if (it.kind === 'plane' && it.ref.kind === 'base') {
    const axis = it.ref.plane === 'front' ? 'z' : it.ref.plane === 'top' ? 'y' : 'x';
    return { item: it, data: { kind: 'base', axis } as AxisRef, label: `${BASE_PLANE_NAMES[it.ref.plane]} normal` };
  }
  return null;
};

export const toFeature = (app: App, filter?: (f: Feature) => boolean) => (it: SelItem): SelBoxItem | null => {
  let id: Id | null = null;
  if (it.kind === 'feature') id = it.id;
  else if (it.kind === 'face') id = app.faces[it.index]?.feature ?? null;
  const f = id ? app.store.feature(id) : null;
  if (!f || (filter && !filter(f))) return null;
  return { item: { kind: 'feature', id: f.id }, data: f.id, label: f.name };
};

const isSketch = (f: Feature) => f.type === 'sketch';
const isSeed = (f: Feature) => ['extrude', 'revolve', 'hole', 'loft', 'sweep', 'linearPattern', 'circularPattern', 'mirror'].includes(f.type);

function planeLabel(app: App, ref: PlaneRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'base') return BASE_PLANE_NAMES[ref.plane];
  if (ref.kind === 'feature') return app.store.feature(ref.id)?.name ?? tr("Plane");
  return `Face of ${app.store.feature(app.faces.find((f) => f.name === ref.face.name)?.feature ?? '')?.name ?? 'part'}`;
}

function axisLabel(app: App, ref: AxisRef | null): string {
  if (!ref) return '';
  switch (ref.kind) {
    case 'base': return `${ref.axis.toUpperCase()} axis`;
    case 'edge': return `Edge (${ref.edge.sig.type})`;
    case 'face': return `Face of ${app.store.feature(app.faces.find((f) => f.name === ref.face.name)?.feature ?? '')?.name ?? 'part'}`;
    case 'sketchLine': return `${app.store.feature(ref.sketch)?.name ?? tr("Sketch")} line`;
    case 'feature': return app.store.feature(ref.id)?.name ?? tr("Axis");
  }
}

/**
 * A face/edge reference as a pick, for highlighting and for telling a second
 * pick of it apart. A panel editing a feature opens on the finished part,
 * where the referenced face or edge may not exist (a fillet removed its edge):
 * the index (-1 then) is found again by name on each rebuild.
 */
function faceItem(app: App, r: FaceRef): SelItem {
  return { kind: 'face', index: app.faces.findIndex((f) => f.name === r.name), name: r.name };
}

function edgeItem(app: App, r: EdgeRef): SelItem {
  return { kind: 'edge', index: app.edges.findIndex((e) => e.name === r.name), name: r.name };
}

function planeItem(app: App, r: PlaneRef): SelItem {
  return r.kind === 'face' ? faceItem(app, r.face) : { kind: 'plane', ref: r };
}

function axisItem(app: App, r: AxisRef): SelItem | null {
  return r.kind === 'edge' ? edgeItem(app, r.edge) : r.kind === 'face' ? faceItem(app, r.face) : null;
}

// ---------- base ----------

/** Adds the sketch picker to the shared feature panel base. */
abstract class FeaturePanel<T extends Feature> extends BaseFeaturePanel<T> {
  protected sketchBox(label: string, get: () => Id | null, set: (id: Id | null) => void): SelectionBox {
    const box = new SelectionBox(this, label, { feature: true, sketch: true }, toFeature(this.app, isSketch), (items) => { set((items[0]?.data as Id) ?? null); this.changed(); }, { single: true, placeholder: tr("Select a sketch in the design tree"), icon: 'sketchFeature' });
    const id = get();
    const sk = id ? this.app.store.feature(id) : null;
    if (sk) box.setItems([{ item: { kind: 'feature', id: sk.id }, data: sk.id, label: sk.name }]);
    return box;
  }
}

// ---------- extrude ----------

/** Fusion-style profile picking: one checkbox per closed region of the sketch. */
function profilesField(app: App, f: { sketch: string; contours?: Vec2[] }, changed: () => void): HTMLElement | null {
  const sk = app.store.feature(f.sketch);
  if (sk?.type !== 'sketch') return null;
  let regions;
  try { regions = buildProfiles(sk.entities).regions; } catch { return null; }
  if (!regions.length) return null;
  const selected = new Set<number>();
  regions.forEach((r, i) => { if (!f.contours || f.contours.some((p) => inRegion(p, r))) selected.add(i); });
  const sync = () => {
    // No contours means every profile, which keeps the feature following edits.
    f.contours = selected.size === regions.length ? undefined : [...selected].sort((a, b) => a - b).map((i) => regions[i].sample);
    changed();
  };
  const rows = regions.map((_, i) => checkbox(tr("Profile {0}", [String(i + 1)]), selected.has(i), (v) => {
    if (v) selected.add(i); else selected.delete(i);
    sync();
  }));
  return h('div', { class: 'selbox', role: 'group', 'aria-label': tr("Profiles") }, ...rows);
}

export class ExtrudePanel extends FeaturePanel<ExtrudeFeature> {
  helpText = '';
  private depthField: HTMLElement | null = null;
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const sketch = this.sketchBox(tr("Profile sketch"), () => f.sketch, (id) => { f.sketch = id ?? ''; });
    const endOpts = [{ value: 'blind' as const, label: tr("Blind") }, { value: 'throughAll' as const, label: tr("Through All") }, { value: 'midPlane' as const, label: tr("Mid Plane") }, { value: 'toObject' as const, label: tr("To Face") }];
    const depth = numberField({ label: tr("Depth"), icon: 'ruler', value: f.depth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.depth = v; this.syncDepth(); this.changed(); } });
    this.depthField = depth;
    depth.hidden = f.end !== 'blind';
    const toFaceBox = new SelectionBox(this, tr("To face"), { face: true }, toFace(this.app), (items) => {
      f.toFace = (items[0]?.data as FaceRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select the planar face to stop at"), icon: 'face' });
    if (f.toFace) toFaceBox.setItems([{ item: faceItem(this.app, f.toFace), data: f.toFace, label: tr("Face") }]);
    toFaceBox.el.hidden = f.end !== 'toObject';
    // A draft linked to an equation ("=Angle") is on too.
    const hasDraft = String(f.draft).trim().startsWith('=') || Number(f.draft) > 0;
    const draftAngle = numberField({ label: tr("Draft angle"), icon: 'draft', value: f.draft || 3, kind: 'angle', ctx, min: 0, onChange: (v) => { f.draft = v; this.changed(); } });
    draftAngle.hidden = !hasDraft;
    const outward = checkbox(tr("Draft outward"), f.draftOutward, (v) => { f.draftOutward = v; this.changed(); });
    const newBody = checkbox(tr("New body"), !!f.newBody, (v) => { f.newBody = v; if (v) f.intersect = false; this.changed(); });
    newBody.hidden = f.cut;
    outward.hidden = !hasDraft;
    const startOffset = numberField({ label: tr("Start offset"), icon: 'ruler', value: f.startOffset ?? 0, kind: 'length', ctx, onChange: (v) => { f.startOffset = v; this.changed(); } });
    let dir2sec: HTMLElement;
    const dir1 = section(tr("Direction 1"), [
      // Two directions, like Inventor's Direction 2: the second handle appears
      // at the other side of the sketch plane.
      checkbox(tr("Two directions"), !!f.dir2, (v) => {
        f.dir2 = v ? { end: 'blind', depth: f.depth } : null;
        dir2sec.hidden = !v || f.end === 'midPlane';
        this.changed();
      }),
      h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('div', { class: 'grow' },
        selectField(tr("End condition"), f.end, endOpts, (v) => {
          f.end = v;
          depth.hidden = v !== 'blind';
          toFaceBox.el.hidden = v !== 'toObject';
          dir2sec.hidden = v === 'midPlane';
          this.changed();
        }))),
      depth, startOffset, toFaceBox.el,
      checkbox(tr("Draft"), hasDraft, (v) => {
        f.draft = v ? 3 : 0;
        draftAngle.hidden = !v;
        outward.hidden = !v;
        this.changed();
      }),
      draftAngle, outward, newBody,
      checkbox(tr("Intersect"), !!f.intersect, (v) => { f.intersect = v; if (v) f.cut = false; this.changed(); }),
    ]);
    const d2depth = numberField({ label: tr("Depth"), icon: 'ruler', value: f.dir2?.depth ?? f.depth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { if (f.dir2) { f.dir2.depth = v; this.changed(); } } });
    dir2sec = section(tr("Direction 2"), [
      selectField(tr("End condition"), f.dir2?.end ?? 'blind', [{ value: 'blind' as const, label: tr("Blind") }, { value: 'throughAll' as const, label: tr("Through All") }], (v) => {
        if (f.dir2) { f.dir2.end = v; d2depth.hidden = v === 'throughAll'; this.changed(); }
      }),
      d2depth,
    ]);
    dir2sec.hidden = !f.dir2 || f.end === 'midPlane';
    const profiles = profilesField(this.app, f, () => this.changed());
    return [section(tr("Profile"), profiles ? [sketch.el, profiles] : [sketch.el]), dir1, dir2sec];
  }

  protected validate() {
    if (!this.f.sketch) return tr("Select a sketch to extrude");
    if (this.f.end === 'toObject' && !this.f.toFace) return tr("Select the face the extrusion should stop at");
    return null;
  }

  private depthNumber(): number {
    try {
      return this.app.store.evalParam(this.f.depth, 'length');
    } catch {
      return 0;
    }
  }

  private syncDepth() {
    if (this.depthField) setNumberFieldValue(this.depthField, this.f.depth, this.ctx());
  }

  /**
   * Fusion-style handle at the end of the extrusion: drag along the direction
   * to change the depth, or type it. Through All has no distance to show.
   */
  canvasValue(): CanvasValue | CanvasValue[] {
    const f = this.f;
    if (!f.sketch || f.end === 'throughAll' || f.end === 'toObject') return [];
    const sk = this.app.store.feature(f.sketch);
    if (sk?.type !== 'sketch') return [];
    const fr = this.app.frameOfSketch(sk) ?? this.app.frames[f.sketch] ?? null;
    if (!fr) return [];
    const dir = scale(fr.n, (f.cut ? -1 : 1) * (f.flip ? -1 : 1));
    const depth = this.depthNumber();
    const b = sketchBounds(new SketchIndex(sk.entities));
    const center: Vec3 = b ? toWorld(fr, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]) : fr.o;
    const taper = {
      value: Number(f.draft) || 0, min: 0, max: 60,
      onChange: (v: number) => { f.draft = Math.round(v * 10) / 10; this.changed(); },
    };
    const first: CanvasValue = {
      anchor: add(center, scale(dir, f.end === 'midPlane' ? depth / 2 : depth)),
      arrowFrom: center,
      axis: dir, value: depth, kind: 'length', label: tr("Depth"), min: 1e-6, taper,
      onChange: (v) => { f.depth = Math.max(1e-6, v); this.syncDepth(); this.changed(); },
      menu: () => [
        { label: tr("Reverse direction"), icon: 'reset', run: () => { f.flip = !f.flip; this.changed(); } },
      ],
    };
    // Inventor-style taper handle: a small curved grip near the arrow end.
    const lateral = cross(dir, fr.x);
    const side = len(lateral) > 1e-9 ? scale(lateral, 1 / len(lateral)) : fr.y;
    const tip = add(center, scale(dir, f.end === 'midPlane' ? depth / 2 : depth));
    const taperHandle: CanvasValue = {
      anchor: add(tip, scale(side, Math.max(depth * 0.35, 8))),
      axis: null, value: Number(f.draft) || 0, kind: 'angle', label: tr("Taper angle"), min: 0, max: 60, style: 'taper',
      onChange: (v) => { f.draft = Math.round(v * 10) / 10; this.changed(); },
    };
    if (!f.dir2) return [first, taperHandle];
    const d2 = f.dir2.end === 'throughAll' ? depth : Number(this.app.store.evalParam(f.dir2.depth, 'length')) || 0;
    const second: CanvasValue = {
      anchor: add(center, scale(dir, -d2)),
      arrowFrom: center,
      axis: scale(dir, -1), value: d2, kind: 'length', label: tr("Depth (Direction 2)"), taper,
      onChange: (v) => { if (f.dir2) { f.dir2.depth = Math.max(1e-6, v); this.changed(); } },
    };
    return [first, second, taperHandle];
  }
}

// ---------- revolve ----------

export class RevolvePanel extends FeaturePanel<RevolveFeature> {
  private angleField: HTMLElement | null = null;
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const sketch = this.sketchBox(tr("Profile sketch"), () => f.sketch, (id) => { f.sketch = id ?? ''; });
    const axis = new SelectionBox(this, tr("Axis of revolution"), { edge: true, face: true }, toAxis(this.app), (items) => { f.axis = (items[0]?.data as AxisRef) ?? null; this.changed(); }, { single: true, placeholder: tr("Uses the sketch centerline (or pick an edge)"), icon: 'axis' });
    if (f.axis) axis.setItems([{ item: axisItem(this.app, f.axis), data: f.axis, label: axisLabel(this.app, f.axis) }]);
    const angle = numberField({ label: tr("Angle"), icon: 'revolve', value: f.angle, kind: 'angle', ctx, min: 1e-6, onChange: (v) => { f.angle = v; this.syncAngle(); this.changed(); } });
    this.angleField = angle;
    const profiles = profilesField(this.app, f, () => this.changed());
    return [
      section(tr("Profile"), profiles ? [sketch.el, profiles] : [sketch.el]),
      section(tr("Axis"), [axis.el]),
      section(tr("Direction 1"), [
        h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('div', { class: 'grow' },
          selectField(tr("Type"), f.end, [{ value: 'blind' as const, label: tr("Blind") }, { value: 'midPlane' as const, label: tr("Mid Plane") }], (v) => { f.end = v; this.changed(); }))),
        angle,
        checkbox(tr("Intersect"), !!f.intersect, (v) => { f.intersect = v; if (v) f.cut = false; this.changed(); }),
      ]),
    ];
  }

  protected validate() {
    return this.f.sketch ? null : tr("Select a sketch to revolve");
  }

  private angleNumber(): number {
    try {
      return this.app.store.evalParam(this.f.angle, 'angle');
    } catch {
      return 0;
    }
  }

  private syncAngle() {
    if (this.angleField) setNumberFieldValue(this.angleField, this.f.angle, this.ctx());
  }

  canvasValue(): CanvasValue | null {
    const f = this.f;
    if (!f.sketch) return null;
    const sk = this.app.store.feature(f.sketch);
    const fr = sk?.type === 'sketch' ? this.app.frameOfSketch(sk) : this.app.frames[f.sketch] ?? null;
    if (!fr) return null;
    return {
      anchor: fr.o, axis: fr.x, value: this.angleNumber(), kind: 'angle', label: tr("Angle"), min: 1e-6,
      onChange: (v) => { f.angle = v; this.syncAngle(); this.changed(); },
      menu: () => [
        { label: tr("Reverse direction"), icon: 'reset', run: () => { f.flip = !f.flip; this.changed(); } },
      ],
    };
  }
}

// ---------- fillet / chamfer ----------

function edgeFaceBox(panel: PropertyPanel, app: App, label: string, f: { edges: EdgeRef[]; faces: FaceRef[] }, onChange: () => void): SelectionBox {
  const box = new SelectionBox(panel, label, { edge: true, face: true }, toEdgeOrFace(app), (items) => {
    f.edges = items.filter((i) => i.item?.kind === 'edge').map((i) => i.data as EdgeRef);
    f.faces = items.filter((i) => i.item?.kind === 'face').map((i) => i.data as FaceRef);
    onChange();
  }, { placeholder: tr("Select edges or faces"), icon: 'fillet' });
  box.setItems([
    ...f.edges.map((e) => ({ item: edgeItem(app, e), data: e, label: `Edge (${e.sig.type})` })),
    ...f.faces.map((r) => ({ item: faceItem(app, r), data: r, label: tr("Face") })),
  ]);
  return box;
}

export class FilletPanel extends FeaturePanel<FilletFeature> {
  private radiusField: HTMLElement | null = null;
  render(): HTMLElement[] {
    const f = this.f;
    const box = edgeFaceBox(this, this.app, tr("Items to fillet"), f, () => this.changed());
    const radius = numberField({ label: tr("Radius"), icon: 'fillet', value: f.radius, kind: 'length', ctx: this.ctx(), min: 1e-6, onChange: (v) => { f.radius = v; this.syncRadius(); this.changed(); } });
    this.radiusField = radius;
    return [section(tr("Fillet Parameters"), [box.el, radius])];
  }

  private radiusNumber(): number {
    try {
      return this.app.store.evalParam(this.f.radius, 'length');
    } catch {
      return 0;
    }
  }

  private syncRadius() {
    if (this.radiusField) setNumberFieldValue(this.radiusField, this.f.radius, this.ctx());
  }

  canvasValue(): CanvasValue | null {
    const e = this.f.edges[0], face = this.f.faces[0];
    const anchor = e?.sig.m ?? face?.sig.c;
    if (!anchor) return null;
    return {
      anchor, axis: null, value: this.radiusNumber(), kind: 'length', label: tr("Radius"), min: 1e-6,
      onChange: (v) => { this.f.radius = v; this.syncRadius(); this.changed(); },
    };
  }

  protected validate() {
    return this.f.edges.length || this.f.faces.length ? null : tr("Select edges or faces to fillet");
  }

  preview() {
    return this.f.edges.length || this.f.faces.length ? this.f : null;
  }
}

export class ChamferPanel extends FeaturePanel<ChamferFeature> {
  private distanceField: HTMLElement | null = null;
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const box = edgeFaceBox(this, this.app, tr("Items to chamfer"), f, () => this.changed());
    const d2 = numberField({ label: tr("Distance 2"), icon: 'ruler', value: f.distance2, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.distance2 = v; this.changed(); } });
    const ang = numberField({ label: tr("Angle"), icon: 'chamfer', value: f.angle, kind: 'angle', ctx, min: 1e-6, onChange: (v) => { f.angle = v; this.changed(); } });
    const flip = flipButton(tr("Flip direction"), f.flip, (v) => { f.flip = v; this.changed(); });
    const sync = () => { d2.hidden = f.mode !== 'twoDistance'; ang.hidden = f.mode !== 'distanceAngle'; flip.hidden = f.mode === 'distance'; };
    sync();
    const distance = numberField({ label: tr("Distance"), icon: 'ruler', value: f.distance, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.distance = v; this.syncDistance(); this.changed(); } });
    this.distanceField = distance;
    return [section(tr("Chamfer Parameters"), [
      box.el,
      h('div', { class: 'row' }, flip, h('div', { class: 'grow' }, selectField(tr("Chamfer type"), f.mode, [
        { value: 'distance' as const, label: tr("Equal distance") },
        { value: 'twoDistance' as const, label: tr("Distance distance") },
        { value: 'distanceAngle' as const, label: tr("Angle distance") },
      ], (v) => { f.mode = v; sync(); this.changed(); }))),
      distance,
      d2, ang,
    ])];
  }

  private distanceNumber(): number {
    try {
      return this.app.store.evalParam(this.f.distance, 'length');
    } catch {
      return 0;
    }
  }

  private syncDistance() {
    if (this.distanceField) setNumberFieldValue(this.distanceField, this.f.distance, this.ctx());
  }

  canvasValue(): CanvasValue | null {
    const e = this.f.edges[0], face = this.f.faces[0];
    const anchor = e?.sig.m ?? face?.sig.c;
    if (!anchor) return null;
    return {
      anchor, axis: null, value: this.distanceNumber(), kind: 'length', label: tr("Distance"), min: 1e-6,
      onChange: (v) => { this.f.distance = v; this.syncDistance(); this.changed(); },
    };
  }

  protected validate() {
    return this.f.edges.length || this.f.faces.length ? null : tr("Select edges or faces to chamfer");
  }

  preview() {
    return this.f.edges.length || this.f.faces.length ? this.f : null;
  }
}

// ---------- shell ----------

export class ShellPanel extends FeaturePanel<ShellFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const box = new SelectionBox(this, tr("Faces to remove"), { face: true }, toFace(this.app), (items) => { f.faces = items.map((i) => i.data as FaceRef); this.changed(); }, { placeholder: tr("Select faces to open (optional)"), icon: 'shell' });
    box.setItems(f.faces.map((r) => ({ item: faceItem(this.app, r), data: r, label: tr("Face") })));
    return [section(tr("Parameters"), [
      numberField({ label: tr("Thickness"), icon: 'ruler', value: f.thickness, kind: 'length', ctx: this.ctx(), min: 1e-6, onChange: (v) => { f.thickness = v; this.changed(); } }),
      box.el,
      checkbox(tr("Shell outward"), f.outward, (v) => { f.outward = v; this.changed(); }),
    ])];
  }
}

// ---------- draft ----------

export class DraftPanel extends FeaturePanel<DraftFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const neutral = new SelectionBox(this, tr("Neutral plane"), { plane: true, planarOnly: true }, toPlane(this.app), (items) => { f.neutral = (items[0]?.data as PlaneRef) ?? null; this.changed(); }, { single: true, icon: 'plane' });
    if (f.neutral) neutral.setItems([{ item: planeItem(this.app, f.neutral), data: f.neutral, label: planeLabel(this.app, f.neutral) }]);
    const faces = new SelectionBox(this, tr("Faces to draft"), { face: true }, toFace(this.app), (items) => { f.faces = items.map((i) => i.data as FaceRef); this.changed(); }, { icon: 'draft' });
    faces.setItems(f.faces.map((r) => ({ item: faceItem(this.app, r), data: r, label: tr("Face") })));
    return [section(tr("Draft"), [
      numberField({ label: tr("Draft angle"), icon: 'draft', value: f.angle, kind: 'angle', ctx: this.ctx(), onChange: (v) => { f.angle = v; this.changed(); } }),
      h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('span', { class: 'field-label' }, tr("Reverse pull direction"))),
      neutral.el, faces.el,
    ])];
  }

  protected validate() {
    if (!this.f.neutral) return tr("Select a neutral plane");
    return this.f.faces.length ? null : tr("Select faces to draft");
  }

  preview() {
    return this.f.neutral && this.f.faces.length ? this.f : null;
  }
}

// ---------- shaft (mechanical design) ----------

/** A keyway sized for a segment: a quarter of the diameter wide, 8% deep. */
function defaultKeyway(f: ShaftFeature) {
  const segment = Math.min(f.keyway?.segment ?? 0, Math.max(0, f.segments.length - 1));
  const d = Number(f.segments[segment]?.diameter) || 20;
  const l = Number(f.segments[segment]?.length) || 40;
  return {
    segment,
    width: Math.max(2, d * 0.25),
    depth: Math.max(1, d * 0.08),
    length: Math.max(4, Math.min(l * 0.6, l - 2)),
  };
}

export class ShaftPanel extends FeaturePanel<ShaftFeature> {
  private statsEl: HTMLElement | null = null;
  private allowableField: HTMLElement | null = null;

  get title() {
    return this.editingId ? this.f.name : tr("Shaft Design");
  }

  private scalar(label: string, value: number, step: number, onChange: (v: number) => void): HTMLElement {
    const input = h('input', {
      class: 'input', type: 'number', step, value: String(Math.round(value * 1000) / 1000), 'aria-label': label,
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      onChange(v);
      this.syncStats();
    });
    return h('div', {}, h('div', { class: 'field-label' }, label), input);
  }

  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const segments: HTMLElement[] = [];
    for (const [i, s] of f.segments.entries()) {
      const remove = h('button', { class: 'btn ghost small', type: 'button' }, tr("Remove"));
      remove.disabled = f.segments.length <= 1;
      remove.addEventListener('click', () => {
        if (f.segments.length <= 1) return;
        f.segments.splice(i, 1);
        if (f.keyway && f.keyway.segment >= f.segments.length) f.keyway.segment = f.segments.length - 1;
        this.app.refreshPanel();
        this.changed();
      });
      segments.push(h('div', { class: 'shaft-segment' },
        h('div', { class: 'row' }, h('span', { class: 'field-label grow' }, tr("Segment {0}", [i + 1])), remove),
        numberField({
          label: tr("Diameter {0}", [i + 1]), icon: 'ruler', value: s.diameter, kind: 'length', ctx, min: 1e-6, allowExpr: false,
          onChange: (v) => { s.diameter = v; this.syncStats(); this.changed(); },
        }),
        numberField({
          label: tr("Length {0}", [i + 1]), icon: 'ruler', value: s.length, kind: 'length', ctx, min: 1e-6, allowExpr: false,
          onChange: (v) => { s.length = v; this.syncStats(); this.changed(); },
        }),
      ));
    }
    const add = h('button', { class: 'btn small', type: 'button' }, tr("Add Segment"));
    add.addEventListener('click', () => {
      const last = f.segments[f.segments.length - 1];
      f.segments.push({ diameter: Number(last?.diameter) || 20, length: 30 });
      if (f.keyway && f.keyway.segment > f.segments.length - 1) f.keyway.segment = f.segments.length - 1;
      this.app.refreshPanel();
      this.changed();
    });

    const material = selectField(tr("Material"), f.material, SHAFT_MATERIALS.map((m) => ({ value: m.id, label: m.name })), (v) => {
      f.material = v;
      const preset = SHAFT_MATERIALS.find((m) => m.id === v);
      if (preset) {
        f.allowableShear = preset.allowableShear;
        if (this.allowableField) setNumberFieldValue(this.allowableField, preset.allowableShear, ctx);
      }
      this.syncStats();
    }, 'shaft');
    const allowable = numberField({
      label: tr("Allowable shear stress (MPa)"), icon: 'ruler', value: f.allowableShear, kind: 'count', ctx, min: 1, allowExpr: false,
      onChange: (v) => { f.allowableShear = v; this.syncStats(); },
    });
    this.allowableField = allowable;
    this.statsEl = h('div', { class: 'pm-msg info', role: 'status' });
    const mechanical = section(tr("Shaft Check"), [
      material,
      this.scalar(tr("Power (kW)"), Number(f.power) || 0, 0.1, (v) => { f.power = v; }),
      this.scalar(tr("Speed (rpm)"), Number(f.speed) || 0, 10, (v) => { f.speed = v; }),
      this.scalar(tr("Service factor"), Number(f.serviceFactor) || 1, 0.05, (v) => { f.serviceFactor = v; }),
      allowable,
      this.statsEl,
    ]);

    const endChamfer = numberField({
      label: tr("End chamfer"), icon: 'chamfer', value: f.endChamfer, kind: 'length', ctx, min: 0, allowExpr: false,
      onChange: (v) => { f.endChamfer = v; this.changed(); },
    });
    const keywayToggle = checkbox(tr("Keyway"), !!f.keyway, (v) => {
      f.keyway = v ? defaultKeyway(f) : null;
      this.app.refreshPanel();
      this.changed();
    });
    const keywayFields: HTMLElement[] = [];
    if (f.keyway) {
      const k = f.keyway;
      keywayFields.push(
        selectField(tr("Keyway segment"), String(k.segment), f.segments.map((_, i) => ({ value: String(i), label: tr("Segment {0}", [i + 1]) })), (v) => {
          k.segment = Number(v);
          this.changed();
        }, 'shaft'),
        numberField({
          label: tr("Keyway width"), icon: 'ruler', value: k.width, kind: 'length', ctx, min: 1e-6, allowExpr: false,
          onChange: (v) => { k.width = v; this.changed(); },
        }),
        numberField({
          label: tr("Keyway depth"), icon: 'ruler', value: k.depth, kind: 'length', ctx, min: 1e-6, allowExpr: false,
          onChange: (v) => { k.depth = v; this.changed(); },
        }),
        numberField({
          label: tr("Keyway length"), icon: 'ruler', value: k.length, kind: 'length', ctx, min: 1e-6, allowExpr: false,
          onChange: (v) => { k.length = v; this.changed(); },
        }),
      );
    }

    this.syncStats();
    return [
      section(tr("Shaft Segments"), [...segments, add]),
      mechanical,
      section(tr("Ends and Features"), [endChamfer, keywayToggle, ...keywayFields]),
    ];
  }

  private syncStats() {
    const el = this.statsEl;
    if (!el) return;
    const f = this.f;
    const sizing = sizeShaft(Number(f.power) || 0, Number(f.speed) || 0, Number(f.serviceFactor) || 0, Number(f.allowableShear) || 0,
      f.segments.map((s) => Number(s.diameter) || 0));
    if (!sizing || !Number.isFinite(sizing.minDiameter)) {
      el.className = 'pm-msg warn';
      el.textContent = tr("Enter a power, speed, service factor and allowable stress to size the shaft.");
      return;
    }
    const dec = this.app.store.doc.decimals;
    const strong = sizing.maxUtilization <= 1;
    el.className = `pm-msg ${strong ? 'info' : 'error'}`;
    el.textContent = tr(
      "Design torque {0} N·m, minimum diameter {1} mm. Maximum torsional stress {2} MPa ({3}% of allowable).",
      [
        formatNumber(sizing.designTorque, Math.max(1, dec - 1)),
        formatNumber(sizing.minDiameter, dec),
        formatNumber(sizing.maxUtilization * Number(f.allowableShear), dec),
        formatNumber(sizing.maxUtilization * 100, 0),
      ],
    );
  }

  protected validate() {
    const f = this.f;
    if (!f.segments.length) return tr("Add at least one shaft segment");
    if (f.segments.some((s) => !(Number(s.diameter) > 0) || !(Number(s.length) > 0))) return tr("Every shaft segment needs a positive diameter and length");
    if (f.keyway) {
      const k = f.keyway, seg = f.segments[k.segment];
      if (!seg) return tr("Select the segment that carries the keyway");
      const d = Number(seg.diameter), l = Number(seg.length);
      if (!(Number(k.width) > 0) || !(Number(k.depth) > 0) || !(Number(k.length) > 0)) return tr("Keyway width, depth and length must be greater than zero");
      if (Number(k.width) >= d) return tr("Keyway width must be less than the shaft diameter");
      if (Number(k.depth) >= d / 2) return tr("Keyway depth must be less than the shaft radius");
      if (Number(k.length) > l) return tr("Keyway length cannot be longer than its segment");
      if (Number(k.length) < Number(k.width)) return tr("Keyway length must be at least its width");
    }
    return null;
  }

  preview() {
    return this.f.segments.length ? this.f : null;
  }
}

// ---------- hole ----------

export class HolePanel extends FeaturePanel<HoleFeature> {
  /** Sketch created by this panel to hold hole positions. */
  private createdSketch: Id | null = null;
  /** Fusion-style flow: positions are confirmed before the hole is previewed. */
  private positionsReady: boolean;
  private positionsHint: HTMLElement | null = null;
  private confirmPositions: HTMLButtonElement | null = null;
  private parameterSections: HTMLElement[] = [];
  private positionList: HTMLElement | null = null;
  private addCenterButton: HTMLButtonElement | null = null;
  private addExactButton: HTMLButtonElement | null = null;
  private exactPlacement: HTMLElement[] = [];
  private threadSection: HTMLElement | null = null;
  private placementMode: 'face' | 'sketch' = 'face';

  constructor(app: App, f: HoleFeature, editing: boolean) {
    super(app, f, editing);
    // Fusion keeps the shape settings visible: positions and type are edited
    // together and OK creates the hole once at least one position exists.
    this.positionsReady = true;
    this.helpText = '';
  }

  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const nominal = typeof f.diameter === 'number' ? f.diameter : 5;
    const kinds = [
      { value: 'simple' as const, label: tr("Simple") },
      { value: 'counterbore' as const, label: tr("Counterbore") },
      { value: 'doubleCounterbore' as const, label: tr("Double Counterbore") },
      { value: 'countersink' as const, label: tr("Countersink") },
      { value: 'counterdrill' as const, label: tr("Counterdrill") },
      { value: 'spotface' as const, label: tr("Spotface") },
      { value: 'tapped' as const, label: tr("Tapped") },
    ];
    const cb = [
      numberField({ label: tr("Counterbore diameter"), value: f.cbDiameter, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.cbDiameter = v; this.changed(); } }),
      numberField({ label: tr("Counterbore depth"), value: f.cbDepth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.cbDepth = v; this.changed(); } }),
    ];
    const cb2 = [
      numberField({ label: tr("Second counterbore diameter"), value: f.cb2Diameter ?? nominal * 2.4, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.cb2Diameter = v; this.changed(); } }),
      numberField({ label: tr("Second counterbore depth"), value: f.cb2Depth ?? nominal * 0.4, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.cb2Depth = v; this.changed(); } }),
    ];
    const cs = [
      numberField({ label: tr("Countersink diameter"), value: f.csDiameter, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.csDiameter = v; this.changed(); } }),
      numberField({ label: tr("Countersink angle"), value: f.csAngle, kind: 'angle', ctx, min: 1, onChange: (v) => { f.csAngle = v; this.changed(); } }),
    ];
    const cd = [
      numberField({ label: tr("Counterdrill diameter"), value: f.cdDiameter ?? nominal * 1.8, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.cdDiameter = v; this.changed(); } }),
      numberField({ label: tr("Counterdrill depth"), value: f.cdDepth ?? nominal * 0.5, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.cdDepth = v; this.changed(); } }),
      numberField({ label: tr("Counterdrill angle"), value: f.cdAngle ?? 90, kind: 'angle', ctx, min: 1, onChange: (v) => { f.cdAngle = v; this.changed(); } }),
    ];
    const sf = [
      numberField({ label: tr("Spotface diameter"), value: f.sfDiameter ?? nominal * 1.8, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.sfDiameter = v; this.changed(); } }),
      numberField({ label: tr("Spotface depth"), value: f.sfDepth ?? nominal * 0.4, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.sfDepth = v; this.changed(); } }),
    ];
    const diameter = numberField({ label: tr("Diameter"), value: f.diameter, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.diameter = v; this.changed(); } });
    // Fusion's Threads section: standard first, then the sizes of that standard.
    let threadStandard: 'metric' | 'unc' = (f.threadSize ?? '').startsWith('M') ? 'metric' : 'unc';
    const threadSelect = h('select', { class: 'input', 'aria-label': tr("Thread size") }) as HTMLSelectElement;
    const fillThreadSizes = () => {
      threadSelect.textContent = '';
      for (const p of THREAD_PRESETS.filter((p) => /^M/.test(p.id) === (threadStandard === 'metric'))) {
        threadSelect.append(h('option', { value: p.id }, p.label));
      }
      threadSelect.append(h('option', { value: 'Custom' }, tr("Custom")));
    };
    fillThreadSizes();
    if (f.threadSize && [...threadSelect.options].some((o) => o.value === f.threadSize)) threadSelect.value = f.threadSize;
    else threadSelect.value = 'Custom';
    threadSelect.addEventListener('change', () => {
      const v = threadSelect.value;
      f.threadSize = v;
      const preset = THREAD_PRESETS.find((p) => p.id === v);
      if (preset) {
        f.diameter = preset.nominal;
        f.threadPitch = preset.pitch;
        f.tapDrillDiameter = preset.tapDrill;
        setFieldValue(diameter, preset.nominal, 'length');
        setFieldValue(threadPitch, preset.pitch, 'length');
        setFieldValue(tapDrill, preset.tapDrill, 'length');
      }
      sync();
      this.changed();
    });
    const threadSize = h('div', {}, h('div', { class: 'field-label' }, tr("Thread size")), threadSelect);
    const threadStandardField = selectField(tr("Thread standard"), threadStandard, [
      { value: 'metric' as const, label: tr("ISO Metric") },
      { value: 'unc' as const, label: tr("ANSI Unified") },
    ], (v) => {
      threadStandard = v;
      fillThreadSizes();
      const first = THREAD_PRESETS.find((p) => /^M/.test(p.id) === (threadStandard === 'metric'));
      if (first) {
        f.threadSize = first.id;
        f.diameter = first.nominal;
        f.threadPitch = first.pitch;
        f.tapDrillDiameter = first.tapDrill;
        threadSelect.value = first.id;
        setFieldValue(diameter, first.nominal, 'length');
        setFieldValue(threadPitch, first.pitch, 'length');
        setFieldValue(tapDrill, first.tapDrill, 'length');
      }
      sync();
      this.changed();
    }, 'hole');
    const threadClass = selectField(tr("Thread class"), f.threadClass ?? '6H', [
      { value: '6H', label: '6H' },
      { value: '6G', label: '6G' },
      { value: '2B', label: '2B' },
      { value: '3B', label: '3B' },
    ], (v) => { f.threadClass = v; this.changed(); }, 'hole');
    const threadPitch = numberField({ label: tr("Thread pitch"), value: f.threadPitch ?? nominal * 0.15, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.threadPitch = v; this.changed(); } });
    const tapDrill = numberField({ label: tr("Tap drill diameter"), value: f.tapDrillDiameter ?? nominal * 0.85, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.tapDrillDiameter = v; this.changed(); } });
    const setFieldValue = (field: HTMLElement, value: number, kind: 'length' | 'angle' | 'count') => {
      const input = field.querySelector<HTMLInputElement>('input');
      if (!input) return;
      input.value = paramText(value, kind, ctx);
      input.classList.remove('expr');
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
    };
    const depth = numberField({ label: tr("Depth"), value: f.depth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.depth = v; this.changed(); } });
    const stopFace = new SelectionBox(this, tr("Stop at face"), { face: true, planarOnly: true }, toFace(this.app, true), (items) => {
      f.toFace = (items[0]?.data as FaceRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select the planar face to stop at"), icon: 'plane' });
    if (f.toFace) {
      const index = this.app.faces.findIndex((x) => x.name === f.toFace!.name);
      stopFace.setItems([{ item: faceItem(this.app, f.toFace), data: f.toFace, label: index >= 0 ? faceLabel(this.app, index) : tr("Face") }]);
    }
    let threadSection: HTMLElement;
    const tip = selectField(tr("Drill point"), f.tip ?? 'flat', [
      { value: 'flat' as const, label: tr("Flat") },
      { value: 'drill' as const, label: tr("Drill Point") },
    ], (v) => { f.tip = v; sync(); this.changed(); }, 'hole');
    const tipAngle = numberField({ label: tr("Drill point angle"), value: f.tipAngle ?? 118, kind: 'angle', ctx, min: 1, onChange: (v) => { f.tipAngle = v; this.changed(); } });
    const sync = () => {
      cb.forEach((x) => { x.hidden = f.kind !== 'counterbore' && f.kind !== 'doubleCounterbore'; });
      cb2.forEach((x) => { x.hidden = f.kind !== 'doubleCounterbore'; });
      cs.forEach((x) => { x.hidden = f.kind !== 'countersink'; });
      cd.forEach((x) => { x.hidden = f.kind !== 'counterdrill'; });
      sf.forEach((x) => { x.hidden = f.kind !== 'spotface'; });
      const tapped = f.kind === 'tapped';
      const customThread = tapped && (f.threadSize ?? 'Custom') === 'Custom';
      threadStandardField.hidden = !tapped;
      threadSize.hidden = !tapped;
      threadClass.hidden = !tapped;
      tapDrill.hidden = !tapped;
      threadPitch.hidden = !customThread;
      diameter.hidden = customThread ? false : tapped;
      const blind = f.end === 'blind';
      depth.hidden = !blind;
      stopFace.el.hidden = f.end !== 'toObject';
      tip.hidden = !blind;
      tipAngle.hidden = !blind || (f.tip ?? 'flat') !== 'drill';
      if (threadSection) threadSection.hidden = !tapped;
    };
    sync();

    let placementMode: 'face' | 'sketch' = 'face';
    const placementPick = segmented<'face' | 'sketch'>(tr("Placement"), placementMode, [
      { value: 'face' as const, label: tr("Selected face"), icon: 'plane' },
      { value: 'sketch' as const, label: tr("Sketch"), icon: 'sketchFeature' },
    ], (v) => {
      placementMode = v;
      this.placementMode = v;
      this.syncPlacement();
    });
    this.placementMode = placementMode;
    const positions = new SelectionBox(this, tr("Positions"), { face: true, feature: true, edge: true, vertex: true }, (it) => {
      // A sketch point sketch and face picking are separate modes, as in Fusion.
      if (placementMode === 'sketch' && it.kind !== 'feature') return null;
      if (placementMode === 'face' && it.kind === 'feature') return null;
      return this.pickPosition(it);
    }, (items) => {
      if (!items.length) {
        this.f.sketch = '';
        this.positionsReady = false;
      }
      this.syncPlacement();
      this.changed();
    }, { placeholder: tr("Click a face, edge, vertex, or choose a sketch with points"), icon: 'point', single: true });
    const sk = f.sketch ? this.app.store.feature<SketchFeature>(f.sketch) : null;
    if (sk) positions.setItems([{ item: null, data: sk.id, label: `${sk.name} (${sk.entities.filter((e) => e.t === 'point').length} points)` }]);
    this.positionsHint = h('p', { class: 'field-label', role: 'status' });
    this.positionList = h('div', { class: 'hole-position-list' });
    let exactX = 0;
    let exactY = 0;
    const exactXField = numberField({
      label: tr("Exact X"), value: exactX, kind: 'length', ctx, allowExpr: false,
      onChange: (v) => { exactX = Number(v) || 0; },
    });
    const exactYField = numberField({
      label: tr("Exact Y"), value: exactY, kind: 'length', ctx, allowExpr: false,
      onChange: (v) => { exactY = Number(v) || 0; },
    });
    this.addCenterButton = h('button', { type: 'button', class: 'btn small' }, tr("Add Face Center")) as HTMLButtonElement;
    this.addCenterButton.addEventListener('click', () => {
      const center = this.placementCenterWorld();
      if (center) this.addHolePointWorld(center);
    });
    this.addExactButton = h('button', { type: 'button', class: 'btn small' }, tr("Add Exact Position")) as HTMLButtonElement;
    this.addExactButton.addEventListener('click', () => this.addHolePointLocal(exactX, exactY));
    this.exactPlacement = [exactXField, exactYField, this.addExactButton];
    const precisionHelp = h('p', { class: 'field-label' }, tr("Exact coordinates use the placement face sketch frame. Edges and vertices can be picked to snap a position."));
    // No confirm step: OK creates the hole, as in Fusion.
    this.confirmPositions = h('button', { type: 'button', class: 'btn primary small', hidden: true }, tr("Confirm Positions")) as HTMLButtonElement;
    // Fusion keeps the position list short: the exact-coordinate tools hide
    // behind one collapsed subsection.
    const precise = section(tr("Exact placement"), [
      precisionHelp, exactXField, exactYField, this.addExactButton, this.addCenterButton,
    ], { collapsed: true });
    const positionsSection = section(tr("Positions"), [
      placementPick, positions.el, this.positionList, this.positionsHint, precise,
    ]);

    const mainKinds: HoleKind[] = ['simple', 'counterbore', 'countersink', 'tapped'];
    const moreKinds: HoleKind[] = ['doubleCounterbore', 'counterdrill', 'spotface'];
    const holeIcon: Record<string, string> = { simple: 'holeSimple', counterbore: 'holeCounterbore', countersink: 'holeCountersink', tapped: 'holeTapped' };
    const typePick = segmented<HoleKind>(tr("Hole type"), (mainKinds.includes(f.kind) ? f.kind : '') as HoleKind,
      kinds.filter((k) => mainKinds.includes(k.value)).map((k) => ({ ...k, icon: holeIcon[k.value] })), (v) => {
        f.kind = v;
        sync();
        this.changed();
      });
    const more = selectField(tr("More hole types"), (moreKinds.includes(f.kind) ? f.kind : '') as HoleKind, [
      { value: '' as const, label: tr("More types") },
      ...kinds.filter((k) => moreKinds.includes(k.value)),
    ], (v) => {
      if (!v) return;
      f.kind = v;
      sync();
      this.changed();
    }, 'hole');
    const typeSection = section(tr("Hole Type"), [
      typePick, more, diameter,
      ...cb, ...cb2, ...cs, ...cd, ...sf,
    ]);
    threadSection = section(tr("Threads"), [threadStandardField, threadSize, threadClass, threadPitch, tapDrill]);
    threadSection.hidden = f.kind !== 'tapped';
    this.threadSection = threadSection;
    const endSection = section(tr("Termination"), [
      h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('div', { class: 'grow' },
        selectField(tr("End condition"), f.end, [
          { value: 'throughAll' as const, label: tr("Through All") },
          { value: 'blind' as const, label: tr("Blind") },
          { value: 'toObject' as const, label: tr("To Object") },
        ], (v) => { f.end = v; sync(); this.changed(); }))),
      depth,
      stopFace.el,
      tip, tipAngle,
    ]);
    this.parameterSections = [typeSection, threadSection, endSection];
    this.syncPlacement();
    // Fusion starts on the placement pick when there is no position yet.
    if (this.positionCount() === 0) this.activate(positions);
    return [positionsSection, typeSection, threadSection, endSection];
  }

  /** A face click adds a free point; edges and vertices snap to exact model geometry. */
  private pickPosition(it: SelItem): SelBoxItem | null {
    const f = this.f;
    if (this.placementMode === 'sketch' && it.kind !== 'feature') return null;
    if (this.placementMode === 'face' && it.kind === 'feature') return null;
    if (it.kind === 'feature') {
      const sk = this.app.store.feature(it.id);
      if (sk?.type !== 'sketch') return null;
      if (f.sketch !== sk.id) this.positionsReady = false;
      f.sketch = sk.id;
      this.renderPositionRows();
      this.syncPlacement();
      return { item: it, data: sk.id, label: sk.name };
    }
    const app = this.app;
    if (it.kind === 'face') {
      const face = app.faces[it.index];
      if (!face) return null;
      // A cylindrical face: use the circular edge it meets a flat face at, so
      // the hole is centred on the circle (Fusion's cylinder pick).
      if (!face.frame && face.type === 'cylinder') {
        const edge = app.edges.findIndex((e) => e.type === 'circle' && e.center && e.faces.includes(it.index)
          && e.faces.some((fi) => app.faces[fi]?.frame));
        if (edge >= 0) return this.placeHoleOnEdge(edge, app.edges[edge].center!) ? { item: null, data: f.sketch, label: tr("Cylinder face") } : null;
        return null;
      }
      if (!face.frame) return null;
      const clicked = app.lastPickPoint ?? face.center;
      const world = this.snapToGeometry(face.frame, clicked, face.center);
      if (!f.sketch) this.ensurePositionSketch(face.frame, face);
      const frame = this.currentSketchFrame();
      if (!frame || !this.onFramePlane(frame, world)) return null;
      const local = toLocal(frame, world);
      this.addHolePointLocal(local[0], local[1]);
    } else if (it.kind === 'edge') {
      const edge = app.edges[it.index];
      if (!edge) return null;
      // A circular edge centres the hole; any other edge uses its midpoint.
      const world = edge.type === 'circle' && edge.center ? edge.center : edge.mid;
      if (!this.placeHoleOnEdge(it.index, world)) return null;
    } else if (it.kind === 'vertex') {
      if (!this.addHolePointWorld(it.p)) return null;
    } else {
      return null;
    }
    const sk = app.store.feature<SketchFeature>(f.sketch)!;
    this.renderPositionRows();
    this.syncPlacement();
    return { item: null, data: sk.id, label: `${sk.name} (${this.positionCount()} points)` };
  }

  private currentSketch(): SketchFeature | null {
    if (!this.f.sketch) return null;
    const sk = this.app.store.feature(this.f.sketch);
    return sk?.type === 'sketch' ? sk : null;
  }

  private currentSketchFrame(): Frame | null {
    const sk = this.currentSketch();
    return sk ? this.app.frames[sk.id] ?? sk.frame ?? null : null;
  }

  private ensurePositionSketch(frame: Frame, face: NonNullable<App['faces'][number]>) {
    if (this.f.sketch) return;
    const id = this.app.store.nextId('s');
    const name = defaultName(this.app.store.doc, 'sketch');
    const sk = newSketch(id, name, { kind: 'face', face: faceRef(face) });
    sk.frame = frame;
    this.app.insertFeature(sk);
    this.createdSketch = id;
    this.f.sketch = id;
  }

  private onFramePlane(frame: Frame, p: Vec3): boolean {
    const tolerance = Math.max(this.app.store.unitScale, this.app.typicalSize() * 1e-5);
    return Math.abs(dot(sub(p, frame.o), frame.n)) <= tolerance;
  }

  private addHolePointWorld(p: Vec3): boolean {
    const frame = this.currentSketchFrame();
    if (!frame || !this.onFramePlane(frame, p)) return false;
    const local = toLocal(frame, p);
    return this.addHolePointLocal(local[0], local[1]);
  }

  /** Places a hole on the planar face that meets an edge, at the given world point. */
  private placeHoleOnEdge(edgeIndex: number, worldPoint: Vec3): boolean {
    const app = this.app;
    const edge = app.edges[edgeIndex];
    if (!edge) return false;
    const faceIdx = edge.faces.find((fi) => app.faces[fi]?.frame);
    if (faceIdx == null) return false;
    const face = app.faces[faceIdx];
    if (!face.frame) return false;
    if (!this.f.sketch) this.ensurePositionSketch(face.frame, face);
    const frame = this.currentSketchFrame();
    if (!frame || !this.onFramePlane(frame, worldPoint)) return false;
    const local = toLocal(frame, worldPoint);
    const ok = this.addHolePointLocal(local[0], local[1]);
    if (ok) {
      this.renderPositionRows();
      this.syncPlacement();
    }
    return ok;
  }

  private addHolePointLocal(x: number, y: number): boolean {
    const sk = this.currentSketch();
    if (!sk || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    // Fusion ignores a click on an existing hole position; say why instead.
    const tolerance = this.app.store.unitScale * 1e-3;
    const duplicate = sk.entities.some((e) => e.t === 'point' && Math.hypot(e.x - x, e.y - y) < tolerance);
    if (duplicate) {
      if (this.positionsHint) this.positionsHint.textContent = tr("A hole position already exists there.");
      return false;
    }
    this.app.store.change(tr("Add hole position"), (doc) => {
      const target = doc.features.find((f) => f.id === sk.id);
      if (target?.type !== 'sketch') return;
      let n = target.entities.length + 1;
      while (target.entities.some((e) => e.id === `p${n}`)) n++;
      const pointId = `p${n}`;
      target.entities.push({ id: pointId, t: 'point', x, y });
      // Driving X/Y dimensions to the sketch origin, visible when the position
      // sketch is opened — Fusion keeps the hole positions dimensioned.
      const nextName = () => {
        let k = 1;
        while (target.constraints.some((c) => 'name' in c && c.name === `D${k}`)) k++;
        return `D${k}`;
      };
      target.constraints.push({ id: `${pointId}-x`, type: 'hdistance', refs: [pointId, ORIGIN_ID], value: x, at: [x / 2, y - 8], name: nextName() });
      target.constraints.push({ id: `${pointId}-y`, type: 'vdistance', refs: [pointId, ORIGIN_ID], value: y, at: [x - 8, y / 2], name: nextName() });
    });
    this.renderPositionRows();
    this.syncPlacement();
    return true;
  }

  private placementCenterWorld(): Vec3 | null {
    const sk = this.currentSketch();
    const frame = this.currentSketchFrame();
    if (!sk || !frame) return null;
    const plane = sk.plane;
    if (plane.kind === 'face') {
      const face = this.app.faces.find((f) => f.name === plane.face.name);
      if (face) return face.center;
    }
    return frame.o;
  }

  /** Snap a free face pick to nearby vertices, edge ends/midpoints or circular-edge centres. */
  private snapToGeometry(frame: Frame, clicked: Vec3, faceCenter: Vec3): Vec3 {
    const tolerance = Math.max(this.app.store.unitScale, this.app.typicalSize() * 0.012);
    const local = toLocal(frame, clicked);
    let best = clicked;
    let bestDistance = tolerance;
    const consider = (p: Vec3) => {
      if (!this.onFramePlane(frame, p)) return;
      const q = toLocal(frame, p);
      const distance = Math.hypot(q[0] - local[0], q[1] - local[1]);
      if (distance <= bestDistance) {
        best = p;
        bestDistance = distance;
      }
    };
    consider(faceCenter);
    for (const edge of this.app.edges) {
      consider(edge.a);
      consider(edge.b);
      consider(edge.mid);
      if (edge.center) consider(edge.center);
    }
    return best;
  }

  private renderPositionRows() {
    const host = this.positionList;
    if (!host) return;
    host.textContent = '';
    const points = this.positionPoints();
    if (!points.length) {
      host.append(h('div', { class: 'empty' }, tr("No exact positions yet. Click the model or add a face-center position.")));
      return;
    }
    points.forEach((p, i) => {
      const remove = h('button', { type: 'button', class: 'btn ghost small' }, tr("Remove"));
      remove.addEventListener('click', () => this.removePosition(p.id));
      const x = numberField({
        label: tr("X coordinate ({0})", [i + 1]), value: p.x, kind: 'length', ctx: this.ctx(), allowExpr: false,
        onChange: (v) => this.updatePosition(p.id, 'x', v),
      });
      const y = numberField({
        label: tr("Y coordinate ({0})", [i + 1]), value: p.y, kind: 'length', ctx: this.ctx(), allowExpr: false,
        onChange: (v) => this.updatePosition(p.id, 'y', v),
      });
      host.append(h('div', { class: 'hole-position-row' },
        h('div', { class: 'row' }, h('span', { class: 'field-label grow' }, `P${i + 1}`), remove), x, y));
    });
  }

  private positionPoints(): Extract<SketchFeature['entities'][number], { t: 'point' }>[] {
    const sk = this.currentSketch();
    if (!sk) return [];
    return sk.entities.filter((e): e is Extract<SketchFeature['entities'][number], { t: 'point' }> => e.t === 'point');
  }

  private updatePosition(id: Id, axis: 'x' | 'y', value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.app.store.change(tr("Move hole position"), (doc) => {
      const sk = doc.features.find((f) => f.id === this.f.sketch);
      if (sk?.type !== 'sketch') return;
      const point = sk.entities.find((e) => e.id === id && e.t === 'point');
      if (point?.t === 'point') {
        point[axis] = value;
        const type = axis === 'x' ? 'hdistance' : 'vdistance';
        const dim = sk.constraints.find((c) => 'refs' in c && c.type === type && c.refs.includes(id) && c.refs.includes(ORIGIN_ID));
        if (dim && 'value' in dim) dim.value = value;
      }
    });
  }

  private removePosition(id: Id) {
    this.app.store.change(tr("Remove hole position"), (doc) => {
      const sk = doc.features.find((f) => f.id === this.f.sketch);
      if (sk?.type === 'sketch') {
        sk.entities = sk.entities.filter((e) => e.id !== id);
        sk.constraints = sk.constraints.filter((c) => !('refs' in c && c.refs.includes(id)));
      }
    });
    this.renderPositionRows();
    this.syncPlacement();
  }

  private positionCount(): number {
    return this.positionPoints().length;
  }

  private syncPlacement() {
    const count = this.positionCount();
    this.renderPositionRows();
    if (this.positionsHint) {
      this.positionsHint.textContent = count
        ? tr("{0} hole position(s). Click more points or press OK.", [count])
        : tr("Click a face, circular edge or cylinder to place hole positions.");
    }
    if (this.confirmPositions) {
      this.confirmPositions.disabled = count === 0;
      this.confirmPositions.hidden = this.positionsReady;
    }
    if (this.addCenterButton) this.addCenterButton.disabled = !this.f.sketch;
    if (this.addExactButton) this.addExactButton.disabled = !this.f.sketch;
    for (const el of this.exactPlacement) el.hidden = !this.f.sketch;
    // The type and termination sections stay visible while positions are picked.
    for (const s of this.parameterSections) s.hidden = false;
    if (this.threadSection) this.threadSection.hidden = this.f.kind !== 'tapped';
  }

  cancel() {
    if (this.createdSketch) {
      const id = this.createdSketch;
      this.app.store.change(tr("Remove hole positions"), (doc) => { doc.features = doc.features.filter((x) => x.id !== id); if (doc.rollback != null) doc.rollback = Math.max(0, doc.rollback - 1); });
    }
  }

  protected validate() {
    if (!this.f.sketch) return tr("Place at least one hole position on a planar face or in a sketch");
    if (this.positionCount() === 0) return tr("Add at least one hole position");
    if (this.f.end === 'toObject' && !this.f.toFace) return tr("Select the face to stop at");
    return null;
  }

  preview() {
    return this.positionsReady && this.f.sketch ? this.f : null;
  }
}

// ---------- patterns and mirror ----------

function seedBox(panel: PropertyPanel, app: App, ids: Id[], onChange: (ids: Id[]) => void, label = tr("Features to pattern")): SelectionBox {
  const box = new SelectionBox(panel, label, { face: true, feature: true }, toFeature(app, isSeed), (items) => onChange(items.map((i) => i.data as Id)), { placeholder: tr("Select features in the tree or a face of the feature"), icon: 'part' });
  box.setItems(ids.map((id) => ({ item: { kind: 'feature', id }, data: id, label: app.store.feature(id)?.name ?? id })));
  return box;
}

function directionSection(panel: FeaturePanel<Feature>, app: App, title: string, d: PatternDir, onChange: () => void, extra?: { checkbox: { checked: boolean; onChange: (v: boolean) => void } }): HTMLElement {
  const ctx = app.unitContext();
  const dir = new SelectionBox(panel, tr("Direction"), { edge: true, face: true, plane: true }, toAxis(app), (items) => { d.ref = (items[0]?.data as AxisRef) ?? null; onChange(); }, { single: true, placeholder: tr("Select an edge, face or plane"), icon: 'axis' });
  if (d.ref) dir.setItems([{ item: axisItem(app, d.ref), data: d.ref, label: axisLabel(app, d.ref) }]);
  return section(title, [
    h('div', { class: 'row' }, flipButton(tr("Reverse direction"), d.flip, (v) => { d.flip = v; onChange(); }), h('div', { class: 'grow' }, dir.el)),
    numberField({ label: tr("Spacing"), icon: 'ruler', value: d.spacing, kind: 'length', ctx, onChange: (v) => { d.spacing = v; onChange(); } }),
    numberField({ label: tr("Number of instances"), icon: 'linearPattern', value: d.count, kind: 'count', ctx, min: 1, onChange: (v) => { d.count = v; onChange(); } }),
  ], extra ? { checkbox: extra.checkbox, collapsed: !extra.checkbox.checked } : {});
}

export class LinearPatternPanel extends FeaturePanel<LinearPatternFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const seeds = seedBox(this, this.app, f.seeds, (ids) => { f.seeds = ids; this.changed(); });
    const dir2: PatternDir = f.dir2 ?? { ref: null, spacing: f.dir1.spacing, count: 2, flip: false };
    return [
      directionSection(this as unknown as FeaturePanel<Feature>, this.app, tr("Direction 1"), f.dir1, () => this.changed()),
      directionSection(this as unknown as FeaturePanel<Feature>, this.app, tr("Direction 2"), dir2, () => { if (f.dir2) this.changed(); }, { checkbox: { checked: !!f.dir2, onChange: (v) => { f.dir2 = v ? dir2 : null; this.changed(); } } }),
      section(tr("Features"), [seeds.el]),
    ];
  }

  protected validate() {
    if (!this.f.dir1.ref) return tr("Select a direction");
    return this.f.seeds.length ? null : tr("Select features to pattern");
  }

  preview() {
    return this.f.dir1.ref && this.f.seeds.length ? this.f : null;
  }
}

export class CircularPatternPanel extends FeaturePanel<CircularPatternFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const axis = new SelectionBox(this, tr("Pattern axis"), { edge: true, face: true, plane: true }, toAxis(this.app), (items) => { f.axis = (items[0]?.data as AxisRef) ?? null; this.changed(); }, { single: true, placeholder: tr("Select a circular edge, cylindrical face or axis"), icon: 'axis' });
    if (f.axis) axis.setItems([{ item: axisItem(this.app, f.axis), data: f.axis, label: axisLabel(this.app, f.axis) }]);
    const seeds = seedBox(this, this.app, f.seeds, (ids) => { f.seeds = ids; this.changed(); });
    return [
      section(tr("Parameters"), [
        h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('div', { class: 'grow' }, axis.el)),
        numberField({ label: tr("Angle"), icon: 'circularPattern', value: f.angle, kind: 'angle', ctx, onChange: (v) => { f.angle = v; this.changed(); } }),
        numberField({ label: tr("Number of instances"), icon: 'circularPattern', value: f.count, kind: 'count', ctx, min: 2, onChange: (v) => { f.count = v; this.changed(); } }),
        checkbox(tr("Equal spacing"), f.equal, (v) => { f.equal = v; this.changed(); }),
      ]),
      section(tr("Features"), [seeds.el]),
    ];
  }

  protected validate() {
    if (!this.f.axis) return tr("Select a pattern axis");
    return this.f.seeds.length ? null : tr("Select features to pattern");
  }

  preview() {
    return this.f.axis && this.f.seeds.length ? this.f : null;
  }
}

export class MirrorPanel extends FeaturePanel<MirrorFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const plane = new SelectionBox(this, tr("Mirror plane"), { plane: true, planarOnly: true }, toPlane(this.app), (items) => { f.plane = (items[0]?.data as PlaneRef) ?? null; this.changed(); }, { single: true, icon: 'plane' });
    if (f.plane) plane.setItems([{ item: planeItem(this.app, f.plane), data: f.plane, label: planeLabel(this.app, f.plane) }]);
    const seeds = seedBox(this, this.app, f.seeds, (ids) => { f.seeds = ids; this.changed(); }, tr("Features to mirror"));
    return [section(tr("Mirror Face/Plane"), [plane.el]), section(tr("Features to Mirror"), [seeds.el, h('p', { class: 'field-label' }, tr("Leave empty to mirror the whole body."))])];
  }

  protected validate() {
    return this.f.plane ? null : tr("Select a mirror plane");
  }

  preview() {
    return this.f.plane ? this.f : null;
  }
}

// ---------- reference plane ----------

export class PlanePanel extends FeaturePanel<PlaneFeature> {
  private offsetField: HTMLElement | null = null;
  private angleField: HTMLElement | null = null;
  private offsetSection: HTMLElement | null = null;
  private midSection: HTMLElement | null = null;
  private angleSection: HTMLElement | null = null;
  private tangentSection: HTMLElement | null = null;
  private edgeSection: HTMLElement | null = null;
  private pointSection: HTMLElement | null = null;

  get title() {
    if (this.editingId) return this.f.name;
    switch (this.f.kind ?? 'offset') {
      case 'midplane': return tr("Midplane");
      case 'angle': return tr("Plane at Angle");
      case 'tangent': return tr("Tangent Plane");
      case 'twoEdges': return tr("Plane Through Two Edges");
      case 'threePoints': return tr("Plane Through Three Points");
      default: return tr("Offset Plane");
    }
  }

  render(): HTMLElement[] {
    const f = this.f;
    const kind = f.kind ?? 'offset';
    const first = new SelectionBox(this, tr("First reference"), { plane: true, planarOnly: true }, toPlane(this.app), (items) => { f.ref = (items[0]?.data as PlaneRef) ?? null; this.changed(); }, { single: true, icon: 'plane' });
    if (f.ref) first.setItems([{ item: planeItem(this.app, f.ref), data: f.ref, label: planeLabel(this.app, f.ref) }]);
    const second = new SelectionBox(this, tr("Second reference"), { plane: true, planarOnly: true }, toPlane(this.app), (items) => { f.ref2 = (items[0]?.data as PlaneRef) ?? null; this.changed(); }, { single: true, icon: 'plane' });
    if (f.ref2) second.setItems([{ item: planeItem(this.app, f.ref2), data: f.ref2, label: planeLabel(this.app, f.ref2) }]);
    const axis = new SelectionBox(this, tr("Axis"), { edge: true }, toAxis(this.app), (items) => { f.axis = (items[0]?.data as AxisRef) ?? null; this.changed(); }, { single: true, placeholder: tr("Select an edge in the reference plane"), icon: 'axis' });
    if (f.axis) axis.setItems([{ item: axisItem(this.app, f.axis), data: f.axis, label: axisLabel(this.app, f.axis) }]);

    // Tangent plane: a curved face and, optionally, the point it touches.
    const curved = new SelectionBox(this, tr("Curved face"), { face: true }, toFace(this.app), (items) => {
      f.face = (items[0]?.data as FaceRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a cylindrical, conical or spherical face"), icon: 'plane' });
    if (f.face) curved.setItems([{ item: faceItem(this.app, f.face), data: f.face, label: tr("Curved face") }]);
    const touch = new SelectionBox(this, tr("Contact point"), { vertex: true }, toVertex, (items) => {
      f.point = (items[0]?.data as Vec3) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Pick a vertex (defaults to the face centre)"), icon: 'point' });
    if (f.point) touch.setItems([{ item: { kind: 'vertex', p: f.point }, data: f.point, label: tr("Vertex") }]);

    // Plane through two straight edges.
    const edgeBoxes = [0, 1].map((i) => {
      const box = new SelectionBox(this, i === 0 ? tr("First edge") : tr("Second edge"), { edge: true }, toEdge(this.app), (items) => {
        const next = [...(f.edges ?? [])];
        const ref = (items[0]?.data as EdgeRef) ?? null;
        next[i] = ref as EdgeRef;
        f.edges = next.filter((e, k) => !!e || k < i);
        this.changed();
      }, { single: true, placeholder: tr("Select a straight edge"), icon: 'line' });
      const stored = f.edges?.[i];
      if (stored) box.setItems([{ item: edgeItem(this.app, stored), data: stored, label: tr("Edge") }]);
      return box;
    });

    // Plane through three points.
    const pointBoxes = [0, 1, 2].map((i) => {
      const box = new SelectionBox(this, tr("Point {0}", [i + 1]), { vertex: true }, toVertex, (items) => {
        const next = [...(f.points ?? [])];
        const p = (items[0]?.data as Vec3) ?? null;
        next[i] = p as Vec3;
        f.points = next.filter((q, k) => !!q || k < i);
        this.changed();
      }, { single: true, placeholder: tr("Pick a vertex"), icon: 'point' });
      const stored = f.points?.[i];
      if (stored) box.setItems([{ item: { kind: 'vertex', p: stored }, data: stored, label: tr("Vertex") }]);
      return box;
    });

    const type = selectField(tr("Plane type"), kind, [
      { value: 'offset' as const, label: tr("Offset") },
      { value: 'midplane' as const, label: tr("Midplane") },
      { value: 'angle' as const, label: tr("Plane at Angle") },
      { value: 'tangent' as const, label: tr("Tangent Plane") },
      { value: 'twoEdges' as const, label: tr("Plane Through Two Edges") },
      { value: 'threePoints' as const, label: tr("Plane Through Three Points") },
    ], (v) => {
      f.kind = v;
      if (v === 'angle' && f.angle == null) f.angle = 45;
      sync();
      this.refreshTitle();
      this.changed();
    }, 'plane');

    const offset = numberField({ label: tr("Offset distance"), icon: 'ruler', value: f.offset, kind: 'length', ctx: this.ctx(), onChange: (v) => { f.offset = v; this.syncOffset(); this.changed(); } });
    this.offsetField = offset;
    const angle = numberField({ label: tr("Angle"), icon: 'revolve', value: f.angle ?? 45, kind: 'angle', ctx: this.ctx(), min: 0, max: 180, onChange: (v) => { f.angle = v; this.syncAngle(); this.changed(); } });
    this.angleField = angle;
    const offsetFlip = checkbox(tr("Flip offset"), f.flip, (v) => { f.flip = v; this.syncOffset(); syncFlips(); this.changed(); });
    const reverseAngle = checkbox(tr("Reverse direction"), f.flip, (v) => { f.flip = v; syncFlips(); this.changed(); });
    const flipBox = () => checkbox(tr("Reverse direction"), f.flip, (v) => { f.flip = v; syncFlips(); this.changed(); });
    const flipTangent = flipBox();
    const flipEdges = flipBox();
    const flipPoints = flipBox();
    const syncFlips = () => {
      for (const el of [offsetFlip, reverseAngle, flipTangent, flipEdges, flipPoints]) {
        const box = el.querySelector<HTMLInputElement>('input');
        if (box) box.checked = f.flip;
      }
    };

    const firstSection = section(tr("First Reference"), [first.el]);
    this.offsetSection = section(tr("Offset"), [offset, offsetFlip]);
    this.midSection = section(tr("Second Reference"), [second.el]);
    this.angleSection = section(tr("Axis and Angle"), [axis.el, angle, reverseAngle]);
    this.tangentSection = section(tr("Tangency"), [curved.el, touch.el, flipTangent]);
    this.edgeSection = section(tr("Edges"), [...edgeBoxes.map((b) => b.el), flipEdges, h('p', { class: 'field-label' }, tr("The plane runs through the first edge and along the second."))]);
    this.pointSection = section(tr("Points"), [...pointBoxes.map((b) => b.el), flipPoints]);

    const sync = () => {
      const k = f.kind ?? 'offset';
      this.offsetSection!.hidden = k !== 'offset';
      this.midSection!.hidden = k !== 'midplane';
      this.angleSection!.hidden = k !== 'angle';
      this.tangentSection!.hidden = k !== 'tangent';
      this.edgeSection!.hidden = k !== 'twoEdges';
      this.pointSection!.hidden = k !== 'threePoints';
      firstSection.hidden = k === 'tangent' || k === 'twoEdges' || k === 'threePoints';
      syncFlips();
      // The viewport picks go to the box of the visible section (the panel
      // filters itself through its active box).
      const active = k === 'tangent' ? curved : k === 'twoEdges' ? edgeBoxes[0] : k === 'threePoints' ? pointBoxes[0] : first;
      this.activeBox = active;
      for (const b of this.boxes) b.setActive(b === active);
    };
    sync();
    return [section(tr("Definition"), [type]), firstSection, this.offsetSection, this.midSection, this.angleSection, this.tangentSection, this.edgeSection, this.pointSection];
  }

  private offsetNumber(): number {
    try {
      return this.app.store.evalParam(this.f.offset, 'length');
    } catch {
      return 0;
    }
  }

  private angleNumber(): number {
    try {
      return this.app.store.evalParam(this.f.angle ?? 0, 'angle');
    } catch {
      return 0;
    }
  }

  private syncOffset() {
    if (this.offsetField) setNumberFieldValue(this.offsetField, this.f.offset, this.ctx());
  }

  /** The type selector renames the open panel (Offset Plane → Midplane...). */
  private refreshTitle() {
    const head = this.el.closest('.pm')?.querySelector<HTMLElement>('.pm-head .title');
    if (head) head.textContent = this.title;
  }

  private syncAngle() {
    if (this.angleField) setNumberFieldValue(this.angleField, this.f.angle ?? 45, this.ctx());
  }

  /** The value Fusion shows beside the plane: offset distance or rotation angle. */
  canvasValue(): CanvasValue | null {
    const f = this.f;
    if (!f.ref) return null;
    if ((f.kind ?? 'offset') === 'midplane') return null;
    if ((f.kind ?? 'offset') === 'angle') {
      if (!f.axis) return null;
      const fr = this.app.frames[f.id] ?? this.app.frameOfPlane(f.ref);
      if (!fr) return null;
      return {
        anchor: fr.o, axis: null, value: this.angleNumber(), kind: 'angle', label: tr("Angle"), min: 0, max: 180,
        onChange: (v) => { f.angle = v; this.syncAngle(); this.changed(); },
        menu: () => [
          { label: tr("Reverse direction"), icon: 'reset', run: () => { f.flip = !f.flip; this.changed(); } },
        ],
      };
    }
    const base = this.app.frameOfPlane(f.ref);
    if (!base) return null;
    const sign = f.flip ? -1 : 1;
    const value = this.offsetNumber() * sign;
    // Like the plane fill, the handle sits near the model rather than at the
    // plane's origin, which may be far outside the visible plane.
    const b = this.app.bbox;
    const center: Vec3 = b ? scale(add(b.min, b.max), 0.5) : [0, 0, 0];
    const onBase = sub(center, scale(base.n, dot(sub(center, base.o), base.n)));
    return {
      anchor: add(onBase, scale(base.n, value)), axis: scale(base.n, sign), value, kind: 'length', label: tr("Offset distance"),
      onChange: (v) => { f.offset = Math.abs(v); f.flip = v < -1e-9; this.syncOffset(); this.changed(); },
      menu: () => [
        { label: tr("Flip offset"), icon: 'reset', run: () => { f.flip = !f.flip; this.syncOffset(); this.changed(); } },
        { label: tr("Reset offset"), icon: 'plane', run: () => { f.offset = 0; f.flip = false; this.syncOffset(); this.changed(); } },
      ],
    };
  }

  preview() {
    const f = this.f;
    const kind = f.kind ?? 'offset';
    if (kind === 'tangent') return f.face ? f : null;
    if (kind === 'twoEdges') return (f.edges ?? []).filter(Boolean).length >= 2 ? f : null;
    if (kind === 'threePoints') return (f.points ?? []).filter(Boolean).length >= 3 ? f : null;
    if (!f.ref) return null;
    if (kind === 'midplane') return f.ref2 ? f : null;
    if (kind === 'angle') return f.axis ? f : null;
    return f;
  }

  protected validate() {
    const f = this.f;
    const kind = f.kind ?? 'offset';
    if (kind === 'tangent') {
      if (!f.face) return tr("Select a curved face to be tangent to");
      if (f.face.sig.type === 'plane') return tr("The selected face is planar. Use an offset plane instead");
      return null;
    }
    if (kind === 'twoEdges') {
      const edges = (f.edges ?? []).filter(Boolean);
      if (edges.length < 2) return tr("Select two straight edges");
      if (edges.some((e) => e.sig.type !== 'line')) return tr("Both edges must be straight");
      return null;
    }
    if (kind === 'threePoints') {
      const pts = (f.points ?? []).filter(Boolean);
      if (pts.length < 3) return tr("Select three points");
      const [p1, p2, p3] = pts;
      const n = cross(sub(p2, p1), sub(p3, p1));
      return len(n) < 1e-9 ? tr("The three points lie on one line") : null;
    }
    if (!f.ref) return tr("Select a plane or planar face");
    if (kind === 'midplane' && !f.ref2) return tr("Select a second parallel plane or face");
    if (kind === 'angle') {
      if (!f.axis) return tr("Select the axis to rotate about");
      if (!(this.angleNumber() >= 0)) return tr("Enter an angle");
    }
    return null;
  }

  onBuild() {
    // Show the resulting plane while editing.
    this.app.viewport.drawReferenceGeometry();
  }
}

// ---------- construction axes and points ----------

const axisTitle = (kind: AxisKind) => kind === 'twoPoints' ? tr("Axis Through Two Points")
  : kind === 'edge' ? tr("Axis Along an Edge")
    : kind === 'perpendicular' ? tr("Axis Perpendicular to a Plane")
      : tr("Axis of a Cylinder");

const pointTitle = (kind: PointKind) => kind === 'midpoint' ? tr("Point at an Edge Midpoint")
  : kind === 'center' ? tr("Point at a Centre")
    : kind === 'faceCenter' ? tr("Point at a Face Centre")
      : kind === 'intersection' ? tr("Point at an Intersection")
        : tr("Point at a Vertex");

export class AxisPanel extends FeaturePanel<AxisFeature> {
  private faceSection: HTMLElement | null = null;
  private edgeSection: HTMLElement | null = null;
  private pointsSection: HTMLElement | null = null;
  private perpSection: HTMLElement | null = null;

  get title() {
    return this.editingId ? this.f.name : axisTitle(this.f.kind ?? 'cylinder');
  }

  render(): HTMLElement[] {
    const f = this.f;
    const kind = f.kind ?? 'cylinder';

    const curved = new SelectionBox(this, tr("Cylindrical face"), { face: true }, toFace(this.app), (items) => {
      f.face = (items[0]?.data as FaceRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a cylindrical or conical face"), icon: 'plane' });
    if (f.face) curved.setItems([{ item: faceItem(this.app, f.face), data: f.face, label: tr("Face") }]);

    const edgeBox = new SelectionBox(this, tr("Edge"), { edge: true }, toEdge(this.app), (items) => {
      f.edge = (items[0]?.data as EdgeRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a straight or circular edge"), icon: 'line' });
    if (f.edge) edgeBox.setItems([{ item: edgeItem(this.app, f.edge), data: f.edge, label: tr("Edge") }]);

    const pointBoxes = [0, 1].map((i) => {
      const box = new SelectionBox(this, tr("Point {0}", [i + 1]), { vertex: true }, toVertex, (items) => {
        const next = [...(f.points ?? [])];
        next[i] = (items[0]?.data as Vec3) ?? (undefined as unknown as Vec3);
        f.points = next.filter((p) => !!p);
        this.changed();
      }, { single: true, placeholder: tr("Pick a vertex"), icon: 'point' });
      const stored = f.points?.[i];
      if (stored) box.setItems([{ item: { kind: 'vertex', p: stored }, data: stored, label: tr("Vertex") }]);
      return box;
    });

    const planeBox = new SelectionBox(this, tr("Plane"), { plane: true, planarOnly: true }, toPlane(this.app), (items) => {
      f.ref = (items[0]?.data as PlaneRef) ?? null;
      this.changed();
    }, { single: true, icon: 'plane' });
    if (f.ref) planeBox.setItems([{ item: planeItem(this.app, f.ref), data: f.ref, label: planeLabel(this.app, f.ref) }]);

    const pointBox = new SelectionBox(this, tr("Through point"), { vertex: true }, toVertex, (items) => {
      f.point = (items[0]?.data as Vec3) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Pick the vertex the axis starts at"), icon: 'point' });
    if (f.point) pointBox.setItems([{ item: { kind: 'vertex', p: f.point }, data: f.point, label: tr("Vertex") }]);

    const flip = checkbox(tr("Reverse direction"), !!f.flip, (v) => { f.flip = v; this.changed(); });
    const type = selectField<AxisKind>(tr("Axis type"), kind, [
      { value: 'cylinder', label: tr("Axis of a Cylinder") },
      { value: 'twoPoints', label: tr("Axis Through Two Points") },
      { value: 'edge', label: tr("Axis Along an Edge") },
      { value: 'perpendicular', label: tr("Axis Perpendicular to a Plane") },
    ], (v) => {
      f.kind = v;
      sync();
      this.refreshTitle();
      this.changed();
    }, 'axis');

    this.faceSection = section(tr("Cylinder"), [curved.el]);
    this.edgeSection = section(tr("Edge"), [edgeBox.el]);
    this.pointsSection = section(tr("Points"), pointBoxes.map((b) => b.el));
    this.perpSection = section(tr("Plane and Point"), [planeBox.el, pointBox.el]);
    const sync = () => {
      const k = f.kind ?? 'cylinder';
      this.faceSection!.hidden = k !== 'cylinder';
      this.edgeSection!.hidden = k !== 'edge';
      this.pointsSection!.hidden = k !== 'twoPoints';
      this.perpSection!.hidden = k !== 'perpendicular';
      const active = k === 'cylinder' ? curved : k === 'edge' ? edgeBox : k === 'twoPoints' ? pointBoxes[0] : planeBox;
      this.activeBox = active;
      for (const b of this.boxes) b.setActive(b === active);
    };
    sync();
    return [section(tr("Definition"), [type]), this.faceSection, this.edgeSection, this.pointsSection, this.perpSection, section(tr("Direction"), [flip])];
  }

  private refreshTitle() {
    const head = this.el.closest('.pm')?.querySelector<HTMLElement>('.pm-head .title');
    if (head) head.textContent = this.title;
  }

  preview() {
    const f = this.f;
    const kind = f.kind ?? 'cylinder';
    if (kind === 'cylinder') return f.face ? f : null;
    if (kind === 'edge') return f.edge ? f : null;
    if (kind === 'twoPoints') return (f.points ?? []).filter(Boolean).length >= 2 ? f : null;
    return f.ref && f.point ? f : null;
  }

  protected validate() {
    const f = this.f;
    const kind = f.kind ?? 'cylinder';
    if (kind === 'cylinder') return f.face ? null : tr("Select a cylindrical or conical face");
    if (kind === 'edge') return f.edge ? null : tr("Select a straight or circular edge");
    if (kind === 'twoPoints') return (f.points ?? []).filter(Boolean).length >= 2 ? null : tr("Select two points");
    if (!f.ref) return tr("Select a plane or planar face");
    return f.point ? null : tr("Select the point the axis starts at");
  }

  onBuild() {
    this.app.viewport.drawReferenceGeometry();
  }
}

export class PointPanel extends FeaturePanel<PointFeature> {
  private vertexSection: HTMLElement | null = null;
  private edgeSection: HTMLElement | null = null;
  private faceSection: HTMLElement | null = null;
  private crossSection: HTMLElement | null = null;

  get title() {
    return this.editingId ? this.f.name : pointTitle(this.f.kind ?? 'vertex');
  }

  render(): HTMLElement[] {
    const f = this.f;
    const kind = f.kind ?? 'vertex';

    const vertex = new SelectionBox(this, tr("Vertex"), { vertex: true }, toVertex, (items) => {
      f.point = (items[0]?.data as Vec3) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Pick a vertex"), icon: 'point' });
    if (f.point) vertex.setItems([{ item: { kind: 'vertex', p: f.point }, data: f.point, label: tr("Vertex") }]);

    const edgeBox = new SelectionBox(this, tr("Edge"), { edge: true }, toEdge(this.app), (items) => {
      f.edge = (items[0]?.data as EdgeRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a straight edge for its midpoint, or a circular edge for its centre"), icon: 'line' });
    if (f.edge) edgeBox.setItems([{ item: edgeItem(this.app, f.edge), data: f.edge, label: tr("Edge") }]);

    const faceBox = new SelectionBox(this, tr("Face"), { face: true }, toFace(this.app), (items) => {
      f.face = (items[0]?.data as FaceRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a face"), icon: 'plane' });
    if (f.face) faceBox.setItems([{ item: faceItem(this.app, f.face), data: f.face, label: tr("Face") }]);

    const crossEdge = new SelectionBox(this, tr("Edge"), { edge: true }, toEdge(this.app), (items) => {
      f.edge2 = (items[0]?.data as EdgeRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a straight edge"), icon: 'line' });
    if (f.edge2) crossEdge.setItems([{ item: edgeItem(this.app, f.edge2), data: f.edge2, label: tr("Edge") }]);
    const crossPlane = new SelectionBox(this, tr("Plane"), { plane: true, planarOnly: true }, toPlane(this.app), (items) => {
      f.plane = (items[0]?.data as PlaneRef) ?? null;
      this.changed();
    }, { single: true, icon: 'plane' });
    if (f.plane) crossPlane.setItems([{ item: planeItem(this.app, f.plane), data: f.plane, label: planeLabel(this.app, f.plane) }]);

    const type = selectField<PointKind>(tr("Point type"), kind, [
      { value: 'vertex', label: tr("Point at a Vertex") },
      { value: 'midpoint', label: tr("Point at an Edge Midpoint") },
      { value: 'center', label: tr("Point at a Centre") },
      { value: 'faceCenter', label: tr("Point at a Face Centre") },
      { value: 'intersection', label: tr("Point at an Intersection") },
    ], (v) => {
      f.kind = v;
      sync();
      this.refreshTitle();
      this.changed();
    }, 'point');

    this.vertexSection = section(tr("Vertex"), [vertex.el]);
    this.edgeSection = section(tr("Edge"), [edgeBox.el]);
    this.faceSection = section(tr("Face"), [faceBox.el]);
    this.crossSection = section(tr("Edge and Plane"), [crossEdge.el, crossPlane.el]);
    const sync = () => {
      const k = f.kind ?? 'vertex';
      this.vertexSection!.hidden = k !== 'vertex';
      this.edgeSection!.hidden = k !== 'midpoint' && k !== 'center';
      this.faceSection!.hidden = k !== 'faceCenter';
      this.crossSection!.hidden = k !== 'intersection';
      const active = k === 'vertex' ? vertex : k === 'faceCenter' ? faceBox : k === 'intersection' ? crossEdge : edgeBox;
      this.activeBox = active;
      for (const b of this.boxes) b.setActive(b === active);
    };
    sync();
    return [section(tr("Definition"), [type]), this.vertexSection, this.edgeSection, this.faceSection, this.crossSection];
  }

  private refreshTitle() {
    const head = this.el.closest('.pm')?.querySelector<HTMLElement>('.pm-head .title');
    if (head) head.textContent = this.title;
  }

  preview() {
    const f = this.f;
    const kind = f.kind ?? 'vertex';
    if (kind === 'vertex') return f.point ? f : null;
    if (kind === 'faceCenter') return f.face ? f : null;
    if (kind === 'intersection') return f.edge2 && f.plane ? f : null;
    return f.edge ? f : null;
  }

  protected validate() {
    const f = this.f;
    const kind = f.kind ?? 'vertex';
    if (kind === 'vertex') return f.point ? null : tr("Select a vertex");
    if (kind === 'faceCenter') return f.face ? null : tr("Select a face");
    if (kind === 'intersection') {
      if (!f.edge2) return tr("Select a straight edge");
      return f.plane ? null : tr("Select a plane or planar face");
    }
    if (!f.edge) return kind === 'center' ? tr("Select a circular edge") : tr("Select a straight edge");
    return null;
  }

  onBuild() {
    this.app.viewport.drawReferenceGeometry();
  }
}

// ---------- loft / sweep ----------

export class LoftPanel extends FeaturePanel<LoftFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const box = new SelectionBox(this, tr("Profiles"), { feature: true }, toFeature(this.app, isSketch), (items) => { f.profiles = items.map((i) => i.data as Id); this.changed(); }, { placeholder: tr("Select two or more sketches in order"), icon: 'loft' });
    box.setItems(f.profiles.map((id) => ({ item: { kind: 'feature', id }, data: id, label: this.app.store.feature(id)?.name ?? id })));
    return [section(tr("Profiles"), [box.el, checkbox(tr("Ruled (straight) sections"), f.ruled, (v) => { f.ruled = v; this.changed(); })])];
  }

  protected validate() {
    return this.f.profiles.length >= 2 ? null : tr("Select at least two profile sketches");
  }

  preview() {
    return this.f.profiles.length >= 2 ? this.f : null;
  }
}

export class SweepPanel extends FeaturePanel<SweepFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const profile = this.sketchBox(tr("Profile"), () => f.profile, (id) => { f.profile = id; });
    const path = new SelectionBox(this, tr("Path"), { feature: true }, toFeature(this.app, isSketch), (items) => { f.path = (items[0]?.data as Id) ?? null; this.changed(); }, { single: true, placeholder: tr("Select the path sketch"), icon: 'sweep' });
    if (f.path) path.setItems([{ item: { kind: 'feature', id: f.path }, data: f.path, label: this.app.store.feature(f.path)?.name ?? '' }]);
    return [section(tr("Profile and Path"), [profile.el, path.el])];
  }

  protected validate() {
    return this.f.profile && this.f.path ? null : tr("Select a profile and a path");
  }

  preview() {
    return this.f.profile && this.f.path ? this.f : null;
  }
}

// ---------- factory ----------

export class FlatPatternPanel extends FeaturePanel<FlatPatternFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const k = numberField({ label: tr("K factor"), icon: 'ruler', value: f.kFactor, kind: 'count', ctx: this.ctx(), min: 0, max: 1, onChange: (v) => { f.kFactor = v; this.changed(); } });
    return [section(tr("Flat Pattern"), [
      k,
      h('p', { class: 'field-label' }, tr("Unfolds the base flange and every edge flange using the bend radius and this K factor.")),
    ])];
  }

  preview() {
    return this.f;
  }
}

export class EdgeFlangePanel extends FeaturePanel<EdgeFlangeFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const edgeBox = new SelectionBox(this, tr("Edge"), { edge: true }, toEdge(this.app), (items) => {
      const ref = items[0]?.data as EdgeRef | undefined;
      if (ref) { f.edge = ref; this.changed(); }
    });
    edgeBox.setItems(f.edge?.name ? [{ item: edgeItem(this.app, f.edge), data: f.edge, label: tr("Edge") }] : []);
    const length = numberField({ label: tr("Flange length"), icon: 'ruler', value: f.length, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.length = v; this.changed(); } });
    const angle = numberField({ label: tr("Bend angle"), icon: 'ruler', value: f.angle, kind: 'angle', ctx, min: 0, max: 180, onChange: (v) => { f.angle = v; this.changed(); } });
    const flip = checkbox(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); });
    return [
      section(tr("Edge"), [edgeBox.el, h('p', { class: 'field-label' }, tr("Pick a straight edge of the sheet face."))]),
      section(tr("Flange"), [length, angle, flip, h('p', { class: 'field-label' }, tr("Thickness and bend radius come from the base flange."))]),
    ];
  }

  protected validate() {
    return this.f.edge?.name ? null : tr("Select an edge for the flange");
  }

  preview() {
    return this.f.edge?.name ? this.f : null;
  }
}

export class BaseFlangePanel extends FeaturePanel<BaseFlangeFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const sketch = this.sketchBox(tr("Profile sketch"), () => f.sketch, (id) => { f.sketch = id ?? ''; });
    const thickness = numberField({ label: tr("Sheet thickness"), icon: 'ruler', value: f.thickness, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.thickness = v; this.changed(); } });
    const bend = numberField({ label: tr("Bend radius"), icon: 'ruler', value: f.bendRadius, kind: 'length', ctx, min: 0, onChange: (v) => { f.bendRadius = v; this.changed(); } });
    const flip = checkbox(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); });
    return [
      section(tr("Profile"), [
        sketch.el,
        h('p', { class: 'field-label' }, tr("The closed sketch profile becomes a flat sheet-metal face; its outside lines become bend lines.")),
      ]),
      section(tr("Sheet Metal"), [
        thickness,
        bend,
        flip,
        h('p', { class: 'field-label' }, tr("When the part already has a body, the flange is kept as its own body.")),
      ]),
    ];
  }

  protected validate() {
    return this.f.sketch ? null : tr("Select a sketch for the flange");
  }

  preview() {
    return this.f.sketch ? this.f : null;
  }
}

export class SplitBodyPanel extends FeaturePanel<SplitBodyFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const axis = selectField<'x' | 'y' | 'z'>(tr("Split plane"), f.axis, [
      { value: 'x', label: tr("YZ plane (X)") },
      { value: 'y', label: tr("XZ plane (Y)") },
      { value: 'z', label: tr("XY plane (Z)") },
    ], (v) => { f.axis = v; this.changed(); });
    const offset = numberField({ label: tr("Split offset"), icon: 'ruler', value: f.offset, kind: 'length', ctx: this.ctx(), onChange: (v) => { f.offset = v; this.changed(); } });
    const flip = checkbox(tr("Keep the other side"), f.flip, (v) => { f.flip = v; this.changed(); });
    const keepBoth = checkbox(tr("Keep both sides"), !!f.keepBoth, (v) => { f.keepBoth = v; this.changed(); });
    return [
      section(tr("Split"), [
        h('p', { class: 'field-label' }, tr("Removes the material on the discarded side of the plane; the kept side becomes the body.")),
        axis, offset, flip, keepBoth,
      ]),
    ];
  }

  protected validate() {
    return null;
  }

  preview() {
    return this.f;
  }
}

export class ScaleBodyPanel extends FeaturePanel<ScaleBodyFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const factor = numberField({ label: tr("Scale factor"), icon: 'ruler', value: f.factor, kind: 'count', ctx: this.ctx(), min: 0.001, onChange: (v) => { f.factor = v; this.changed(); } });
    return [
      section(tr("Scale"), [
        h('p', { class: 'field-label' }, tr("Scales the whole body uniformly about the world origin. Face names stay with their faces.")),
        factor,
      ]),
    ];
  }

  protected validate() {
    return Number(this.f.factor) > 0 ? null : tr("The scale factor must be greater than zero");
  }

  preview() {
    return this.f;
  }
}

export class MoveBodyPanel extends FeaturePanel<MoveBodyFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const field = (label: string, get: () => unknown, set: (v: number) => void) =>
      numberField({ label, icon: 'ruler', value: get() as never, kind: 'length', ctx, onChange: (v) => { if (typeof v === 'number') set(v); this.changed(); } });
    return [
      section(tr("Move"), [
        h('p', { class: 'field-label' }, tr("Moves the whole body by the given offsets; face names stay with their faces.")),
        field(tr("X offset"), () => f.dx, (v) => { f.dx = v; }),
        field(tr("Y offset"), () => f.dy, (v) => { f.dy = v; }),
        field(tr("Z offset"), () => f.dz, (v) => { f.dz = v; }),
      ]),
      section(tr("Rotation"), [
        numberField({ label: tr("X rotation"), icon: 'revolve', value: f.rotX ?? 0, kind: 'angle', ctx, onChange: (v) => { if (typeof v === 'number') f.rotX = v; this.changed(); } }),
        numberField({ label: tr("Y rotation"), icon: 'revolve', value: f.rotY ?? 0, kind: 'angle', ctx, onChange: (v) => { if (typeof v === 'number') f.rotY = v; this.changed(); } }),
        numberField({ label: tr("Z rotation"), icon: 'revolve', value: f.rotZ ?? 0, kind: 'angle', ctx, onChange: (v) => { if (typeof v === 'number') f.rotZ = v; this.changed(); } }),
      ]),
    ];
  }

  protected validate() {
    return null;
  }

  preview() {
    return this.f;
  }
}

export class OffsetFacePanel extends FeaturePanel<OffsetFaceFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const face = new SelectionBox(this, tr("Planar face"), { face: true }, toFace(this.app), (items) => {
      f.face = (items[0]?.data as FaceRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a planar face to offset"), icon: 'edit' });
    if (f.face) face.setItems([{ item: faceItem(this.app, f.face), data: f.face, label: tr("Face") }]);
    const offset = numberField({ label: tr("Offset"), icon: 'ruler', value: f.offset, kind: 'length', ctx, onChange: (v) => { f.offset = v; this.changed(); } });
    return [
      section(tr("Face"), [face.el, h('p', { class: 'field-label' }, tr("Positive pushes the face out, negative cuts it in."))]),
      section(tr("Offset"), [offset]),
    ];
  }

  protected validate() {
    return this.f.face ? null : tr("Select a planar face to offset");
  }

  preview() {
    return this.f.face ? this.f : null;
  }
}

export class ThreadPanel extends FeaturePanel<ThreadFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const face = new SelectionBox(this, tr("Cylindrical face"), { face: true }, toFace(this.app), (items) => {
      f.face = (items[0]?.data as FaceRef) ?? null;
      this.changed();
    }, { single: true, placeholder: tr("Select a cylindrical face to thread"), icon: 'hole' });
    if (f.face) face.setItems([{ item: faceItem(this.app, f.face), data: f.face, label: tr("Face") }]);
    const pitch = numberField({ label: tr("Pitch"), icon: 'ruler', value: f.pitch, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.pitch = v; this.changed(); } });
    const length = numberField({ label: tr("Thread length"), icon: 'ruler', value: f.length, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.length = v; this.changed(); } });
    const depth = numberField({ label: tr("Thread depth"), icon: 'ruler', value: f.depth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.depth = v; this.changed(); } });
    const left = checkbox(tr("Left-hand winding"), f.left, (v) => { f.left = v; this.changed(); });
    return [
      section(tr("Face"), [face.el, h('p', { class: 'field-label' }, tr("The thread is cut into the picked cylindrical face, starting at the face centre and running along its axis."))]),
      section(tr("Thread"), [pitch, length, depth, left]),
    ];
  }

  protected validate() {
    const f = this.f;
    if (!f.face) return tr("Select a cylindrical face to thread");
    if (!(Number(f.pitch) > 0)) return tr("The thread pitch must be greater than zero");
    if (!(Number(f.length) > 0)) return tr("The thread length must be greater than zero");
    if (!(Number(f.depth) > 0)) return tr("The thread depth must be greater than zero");
    return null;
  }

  preview() {
    return this.f.face ? this.f : null;
  }
}

export class RibPanel extends FeaturePanel<RibFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const sketch = this.sketchBox(tr("Profile sketch"), () => f.sketch, (id) => { f.sketch = id; });
    const thickness = numberField({ label: tr("Thickness"), icon: 'ruler', value: f.thickness, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.thickness = v; this.changed(); } });
    const depth = numberField({ label: tr("Depth"), icon: 'ruler', value: f.depth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.depth = v; this.changed(); } });
    const symmetric = checkbox(tr("Symmetric"), f.symmetric, (v) => { f.symmetric = v; this.changed(); });
    const flip = checkbox(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); });
    const cut = checkbox(tr("Cut"), f.cut, (v) => { f.cut = v; this.changed(); });
    return [
      section(tr("Profile"), [
        sketch.el,
        h('p', { class: 'field-label' }, tr("Every straight line in the sketch becomes a rib wall, extruded along the sketch normal.")),
      ]),
      section(tr("Rib"), [thickness, depth, symmetric, flip, cut]),
    ];
  }

  protected validate() {
    const f = this.f;
    if (!f.sketch) return tr("Select the sketch with the rib lines");
    if (!(Number(f.thickness) > 0)) return tr("The rib thickness must be greater than zero");
    if (!(Number(f.depth) > 0)) return tr("The rib depth must be greater than zero");
    return null;
  }

  preview() {
    return this.f.sketch ? this.f : null;
  }
}

export class CoilPanel extends FeaturePanel<CoilFeature> {
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const profile = this.sketchBox(tr("Profile sketch"), () => f.profile, (id) => { f.profile = id; });
    const pitch = numberField({ label: tr("Pitch"), icon: 'ruler', value: f.pitch, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.pitch = v; this.changed(); } });
    const revolutions = numberField({ label: tr("Revolutions"), icon: 'count', value: f.revolutions, kind: 'count', ctx, min: 0.1, onChange: (v) => { f.revolutions = v; this.changed(); } });
    const height = numberField({ label: tr("Height"), icon: 'ruler', value: f.height, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.height = v; this.changed(); } });
    const byHeight = checkbox(tr("Size by height"), f.byHeight, (v) => { f.byHeight = v; revolutions.hidden = v; height.hidden = !v; this.changed(); });
    revolutions.hidden = f.byHeight;
    height.hidden = !f.byHeight;
    const left = checkbox(tr("Left-hand winding"), f.left, (v) => { f.left = v; this.changed(); });
    const cut = checkbox(tr("Cut"), f.cut, (v) => { f.cut = v; this.changed(); });
    return [
      section(tr("Profile"), [
        profile.el,
        h('p', { class: 'field-label' }, tr("Draw the circle away from the sketch origin: the origin is the coil axis, and the distance to the circle is the coil radius.")),
      ]),
      section(tr("Coil"), [pitch, byHeight, revolutions, height, left, cut]),
    ];
  }

  protected validate() {
    const f = this.f;
    if (!f.profile) return tr("Select the profile sketch");
    if (!(Number(f.pitch) > 0)) return tr("The pitch must be greater than zero");
    return null;
  }

  preview() {
    return this.f.profile ? this.f : null;
  }
}

export function panelFor(app: App, f: Feature, editing: boolean): PropertyPanel | null {
  switch (f.type) {
    case 'extrude': return new ExtrudePanel(app, f, editing);
    case 'revolve': return new RevolvePanel(app, f, editing);
    case 'fillet': return new FilletPanel(app, f, editing);
    case 'chamfer': return new ChamferPanel(app, f, editing);
    case 'shell': return new ShellPanel(app, f, editing);
    case 'hole': return new HolePanel(app, f, editing);
    case 'linearPattern': return new LinearPatternPanel(app, f, editing);
    case 'circularPattern': return new CircularPatternPanel(app, f, editing);
    case 'mirror': return new MirrorPanel(app, f, editing);
    case 'plane': return new PlanePanel(app, f, editing);
    case 'loft': return new LoftPanel(app, f, editing);
    case 'sweep': return new SweepPanel(app, f, editing);
    case 'coil': return new CoilPanel(app, f, editing);
    case 'rib': return new RibPanel(app, f, editing);
    case 'thread': return new ThreadPanel(app, f, editing);
    case 'offsetFace': return new OffsetFacePanel(app, f, editing);
    case 'moveBody': return new MoveBodyPanel(app, f, editing);
    case 'scaleBody': return new ScaleBodyPanel(app, f, editing);
    case 'splitBody': return new SplitBodyPanel(app, f, editing);
    case 'baseFlange': return new BaseFlangePanel(app, f, editing);
    case 'edgeFlange': return new EdgeFlangePanel(app, f, editing);
    case 'flatPattern': return new FlatPatternPanel(app, f, editing);
    case 'draft': return new DraftPanel(app, f, editing);
    case 'shaft': return new ShaftPanel(app, f, editing);
    case 'axis': return new AxisPanel(app, f, editing);
    case 'point': return new PointPanel(app, f, editing);
    case 'spurGear': return new SpurGearPanel(app, f, editing);
    case 'bevelGear': return new BevelGearPanel(app, f, editing);
    case 'wormGear': return new WormGearPanel(app, f, editing);
    case 'vBelt': return new VBeltPanel(app, f, editing);
    case 'syncBelt': return new SyncBeltPanel(app, f, editing);
    case 'sprocket': return new SprocketPanel(app, f, editing);

    default: return null;
  }
}

/** Creates a new feature panel, pre-filling from the current selection. */
export function startFeature(app: App, type: Feature['type'], opts: { cut?: boolean; planeKind?: PlaneKind; axisKind?: AxisKind; pointKind?: PointKind } = {}): PropertyPanel | null {
  const doc = app.store.doc;
  const id = app.store.nextId('f');
  const size = app.typicalSize();
  const sel = app.selection.items;
  const selSketch = (() => {
    for (const it of sel) if (it.kind === 'feature' && app.store.feature(it.id)?.type === 'sketch') return it.id;
    // Default to the most recent unconsumed sketch.
    const used = new Set(doc.features.flatMap((f) => (f.type === 'extrude' || f.type === 'revolve' || f.type === 'hole' ? [f.sketch] : f.type === 'loft' ? f.profiles : f.type === 'sweep' ? [f.profile, f.path] : f.type === 'coil' ? [f.profile] : f.type === 'rib' ? [f.sketch] : [])));
    const built = doc.features.slice(0, app.store.builtCount);
    for (let i = built.length - 1; i >= 0; i--) if (built[i].type === 'sketch' && !used.has(built[i].id)) return built[i].id;
    return null;
  })();
  const name = defaultName(doc, type, opts.cut);
  const edges = app.selection.ofKind('edge').map((s) => app.edges[s.index]).filter(Boolean).map(edgeRef);
  const faces = app.selectedFaceRefs();
  const seeds = [...new Set(sel.flatMap((it) => (it.kind === 'feature' ? [it.id] : it.kind === 'face' ? [app.faces[it.index]?.feature] : [])).filter((x): x is Id => !!x && isSeed(app.store.feature(x)!)))];
  let f: Feature;
  switch (type) {
    case 'extrude': {
      const e = newExtrude(id, name, selSketch ?? '', !!opts.cut, size);
      if (opts.cut) e.flip = cutFlip(app, selSketch);
      f = e;
      break;
    }
    case 'revolve': f = newRevolve(id, name, selSketch ?? '', !!opts.cut); break;
    case 'fillet': { const x = newFillet(id, name, Math.max(size / 10, app.store.unitScale)); x.edges = edges; x.faces = faces; f = x; break; }
    case 'chamfer': { const x = newChamfer(id, name, Math.max(size / 10, app.store.unitScale)); x.edges = edges; x.faces = faces; f = x; break; }
    case 'shell': { const x = newShell(id, name, shellThickness(app, Math.max(size / 20, app.store.unitScale))); x.faces = faces; f = x; break; }
    case 'hole': f = newHole(id, name, selSketch ?? '', Math.max(size / 5, app.store.unitScale * 2)); break;
    case 'linearPattern': {
      const x = newLinearPattern(id, name, seeds, size);
      const e = app.selection.ofKind('edge')[0];
      if (e && app.edges[e.index]?.type === 'line') x.dir1.ref = { kind: 'edge', edge: edgeRef(app.edges[e.index]) };
      f = x;
      break;
    }
    case 'circularPattern': f = newCircularPattern(id, name, seeds); break;
    case 'mirror': { const x = newMirror(id, name, seeds); x.plane = app.selectedPlaneRef(); f = x; break; }
    case 'plane': {
      const kind = opts.planeKind ?? 'offset';
      const refs = sel.flatMap((it) => {
        const c = toPlane(app)(it);
        return c ? [c.data as PlaneRef] : [];
      });
      const x = newPlane(id, name, refs[0] ?? null, kind === 'offset' ? size : 0);
      x.kind = kind;
      const picked = (k: SelItem['kind']) => sel.filter((it) => it.kind === k);
      if (kind === 'angle') {
        x.angle = 45;
        if (edges[0]) x.axis = { kind: 'edge', edge: edges[0] };
      }
      if (kind === 'midplane') x.ref2 = refs[1] ?? null;
      if (kind === 'tangent') {
        // A curved face to be tangent to, and a vertex for the contact point.
        const face = picked('face').find((it) => app.faces[(it as { index: number }).index]?.type !== 'plane');
        if (face) x.face = faceRef(app.faces[(face as { index: number }).index]);
        const vertex = picked('vertex')[0] as { p: Vec3 } | undefined;
        if (vertex) x.point = vertex.p;
      }
      if (kind === 'twoEdges') {
        x.edges = edges.filter((e) => e.sig.type === 'line').slice(0, 2);
      }
      if (kind === 'threePoints') {
        x.points = picked('vertex').slice(0, 3).map((it) => (it as { p: Vec3 }).p);
      }
      f = x;
      break;
    }
    case 'loft': f = newLoft(id, name, sel.filter((it) => it.kind === 'feature' && app.store.feature(it.id)?.type === 'sketch').map((it) => (it as { id: Id }).id), !!opts.cut); break;
    case 'sweep': f = newSweep(id, name, !!opts.cut); break;
    case 'flatPattern': f = newFlatPattern(id, name); break;
    case 'edgeFlange': {
      const x = newEdgeFlange(id, name);
      if (edges[0]) x.edge = edges[0];
      x.length = Math.max(size / 4, app.store.unitScale * 2);
      f = x;
      break;
    }
    case 'baseFlange': {
      const x = newBaseFlange(id, name);
      const sketchFeature = app.selection.items.find((it) => it.kind === 'feature');
      if (sketchFeature) x.sketch = sketchFeature.id;
      x.thickness = Math.max(1, app.store.unitScale);
      x.bendRadius = x.thickness;
      f = x;
      break;
    }
    case 'splitBody': {
      const x = newSplitBody(id, name);
      x.offset = size / 2;
      f = x;
      break;
    }
    case 'scaleBody': {
      const x = newScaleBody(id, name);
      f = x;
      break;
    }
    case 'moveBody': {
      const x = newMoveBody(id, name);
      x.dx = Math.max(size / 10, app.store.unitScale);
      f = x;
      break;
    }
    case 'offsetFace': {
      const x = newOffsetFace(id, name);
      x.face = faces[0] ?? null;
      x.offset = Math.max(1, size / 20);
      f = x;
      break;
    }
    case 'thread': {
      const x = newThread(id, name);
      x.face = faces[0] ?? null;
      x.pitch = Math.max(2, app.store.unitScale);
      x.depth = Number(x.pitch) * 0.6;
      x.length = Math.max(size / 4, app.store.unitScale);
      f = x;
      break;
    }
    case 'rib': {
      const x = newRib(id, name, Math.max(size / 20, app.store.unitScale), Math.max(size / 2, app.store.unitScale));
      x.sketch = selSketch;
      f = x;
      break;
    }
    case 'coil': {
      const x = newCoil(id, name);
      x.profile = selSketch;
      x.pitch = Math.max(size / 20, app.store.unitScale);
      x.revolutions = 5;
      x.height = Number(x.pitch) * 5;
      f = x;
      break;
    }
    case 'draft': { const x = newDraft(id, name); x.faces = faces; f = x; break; }
    case 'shaft': f = newShaft(id, name); break;
    case 'axis': {
      const x = newAxis(id, name);
      x.kind = opts.axisKind ?? 'cylinder';
      if (x.kind === 'cylinder') {
        const face = app.selection.items.find((it) => it.kind === 'face' && app.faces[it.index]?.type !== 'plane');
        if (face) x.face = faceRef(app.faces[(face as { index: number }).index]);
      }
      if (x.kind === 'edge') {
        const edge = app.selection.items.find((it) => it.kind === 'edge');
        if (edge) x.edge = edgeRef(app.edges[(edge as { index: number }).index]);
      }
      if (x.kind === 'twoPoints') x.points = app.selection.ofKind('vertex').slice(0, 2).map((it) => it.p);
      if (x.kind === 'perpendicular') {
        x.ref = app.selectedPlaneRef();
        const vertex = app.selection.ofKind('vertex')[0];
        if (vertex) x.point = vertex.p;
      }
      f = x;
      break;
    }
    case 'point': {
      const x = newPoint(id, name);
      x.kind = opts.pointKind ?? 'vertex';
      if (x.kind === 'vertex') {
        const vertex = app.selection.ofKind('vertex')[0];
        if (vertex) x.point = vertex.p;
      }
      if (x.kind === 'midpoint' || x.kind === 'center') {
        const edge = app.selection.items.find((it) => it.kind === 'edge');
        if (edge) x.edge = edgeRef(app.edges[(edge as { index: number }).index]);
      }
      if (x.kind === 'faceCenter') {
        const face = app.selection.items.find((it) => it.kind === 'face');
        if (face) x.face = faceRef(app.faces[(face as { index: number }).index]);
      }
      if (x.kind === 'intersection') {
        const edge = app.selection.items.find((it) => it.kind === 'edge');
        if (edge) x.edge2 = edgeRef(app.edges[(edge as { index: number }).index]);
        x.plane = app.selectedPlaneRef();
      }
      f = x;
      break;
    }
    case 'spurGear': f = newSpurGear(id, name); break;
    case 'bevelGear': f = newBevelGear(id, name); break;
    case 'wormGear': f = newWormGear(id, name); break;
    case 'vBelt': f = newVBelt(id, name); break;
    case 'syncBelt': f = newSyncBelt(id, name); break;
    case 'sprocket': f = newSprocket(id, name); break;

    default: return null;
  }
  // Features that add depth are easier to judge in a 3D view.
  const flat = ['front', 'back', 'left', 'right', 'top', 'bottom'];
  if (['extrude', 'revolve', 'loft', 'sweep'].includes(type) && flat.includes(app.renderer.camera.viewName() ?? '')) app.viewport.setView('trimetric');
  return panelFor(app, f, false);
}

/**
 * A default shell thickness below the radius of every fillet built so far:
 * a wall as thick as a fillet's radius cannot be offset (the default fillet
 * and shell sizes are equal on small parts).
 */
function shellThickness(app: App, size: number): number {
  let t = size;
  for (const f of app.store.doc.features.slice(0, app.store.builtCount)) {
    if (f.type !== 'fillet' || f.suppressed) continue;
    let r: number;
    try { r = app.store.evalParam(f.radius, 'length'); } catch { continue; }
    if (r > 0 && r <= t) t = r / 2;
  }
  return t;
}

/** Whether a new cut should be flipped so that it goes into the material. */
function cutFlip(app: App, sketchId: Id | null): boolean {
  if (!sketchId || !app.bbox) return false;
  const sk = app.store.feature<SketchFeature>(sketchId);
  const fr = sk ? app.frameOfSketch(sk) : null;
  if (!fr) return false;
  const c: Vec3 = [(app.bbox.min[0] + app.bbox.max[0]) / 2, (app.bbox.min[1] + app.bbox.max[1]) / 2, (app.bbox.min[2] + app.bbox.max[2]) / 2];
  // Cuts go against the normal by default; flip when the material is in front.
  return dot(sub(c, fr.o), fr.n) > 1e-6;
}
