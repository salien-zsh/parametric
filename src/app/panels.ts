// PropertyManager panels for creating and editing features.

import type { Frame, Vec3 } from '../math/vec';
import { add, dot, scale, sub, toLocal, toWorld } from '../math/vec';
import {
  defaultName, newChamfer, newCircularPattern, newDraft, newExtrude, newFillet, newHole, newLinearPattern, newLoft,
  newMirror, newPlane, newRevolve, newShell, newSketch, newSweep, FEATURE_LABELS, featureIcon, THREAD_PRESETS,
} from '../model/features';
import { BASE_PLANE_NAMES } from '../model/planes';
import { changeFeatureUnits } from '../model/document';
import { evaluateVariables, variableReferenceChanges } from '../model/expr';
import { SketchIndex, sketchBounds } from '../sketch/geom';
import type {
  AxisRef, ChamferFeature, CircularPatternFeature, DraftFeature, EdgeRef, ExtrudeFeature, FaceRef, Feature, FilletFeature,
  HoleFeature, Id, LinearPatternFeature, LoftFeature, MirrorFeature, PatternDir, PlaneFeature, PlaneRef, RevolveFeature,
  ShellFeature, SketchFeature, SweepFeature, UnitSystem, Variable,
} from '../model/types';
import { h } from '../ui/dom';
import type { App } from './app';
import {
  PropertyPanel, SelectionBox, type CanvasValue, type SelBoxItem, checkbox, flipButton, numberField, paramText, section, selectField, setNumberFieldValue, settleNumberFields,
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

abstract class FeaturePanel<T extends Feature> extends PropertyPanel {
  f: T;
  private units: UnitSystem;
  private variables: Variable[];
  constructor(protected app: App, f: T, editing: boolean) {
    super();
    this.f = structuredClone(f);
    this.units = app.store.doc.units;
    this.variables = structuredClone(app.store.doc.variables);
    this.editingId = editing ? f.id : null;
    this.icon = featureIcon(f);
  }

  get title() {
    return this.editingId ? this.f.name : FEATURE_LABELS[this.f.type];
  }

  /** The feature as the panel first showed it, to tell whether it was changed. */
  private initial: string | null = null;

  mount(): HTMLElement {
    const el = super.mount();
    this.initial ??= JSON.stringify(this.f);
    return el;
  }

  get edited(): boolean {
    return this.initial !== null && JSON.stringify(this.f) !== this.initial;
  }

  syncExpressions(): string[] | null {
    const doc = this.app.store.doc;
    const references = variableReferenceChanges(this.variables, doc.variables);
    let unlinked: string[] | null = null;
    if (doc.units !== this.units || references.size) {
      const variables = evaluateVariables(this.variables).values;
      settleNumberFields(this.el, { units: this.units, decimals: doc.decimals, variables: () => variables });
      unlinked = changeFeatureUnits(this.f, this.units, doc.units, this.variables, doc.variables, references);
      if (this.initial !== null) {
        const initial = JSON.parse(this.initial) as T;
        changeFeatureUnits(initial, this.units, doc.units, this.variables, doc.variables, references);
        this.initial = JSON.stringify(initial);
      }
      this.units = doc.units;
    }
    this.variables = structuredClone(doc.variables);
    return unlinked;
  }

  preview(): Feature | null {
    return this.f;
  }

  /** Re-runs the preview after a parameter change. */
  protected changed() {
    this.app.requestRebuild();
  }

  protected validate(): string | null {
    return null;
  }

  ok(): boolean {
    const err = this.validate();
    if (err) { this.setMessage('error', err); return false; }
    if (this.editingId) this.app.replaceFeature(this.f);
    else this.app.insertFeature(this.f);
    return true;
  }

  protected ctx() {
    return this.app.unitContext();
  }

  protected sketchBox(label: string, get: () => Id | null, set: (id: Id | null) => void): SelectionBox {
    const box = new SelectionBox(this, label, { feature: true, sketch: true }, toFeature(this.app, isSketch), (items) => { set((items[0]?.data as Id) ?? null); this.changed(); }, { single: true, placeholder: tr("Select a sketch in the design tree"), icon: 'sketchFeature' });
    const id = get();
    const sk = id ? this.app.store.feature(id) : null;
    if (sk) box.setItems([{ item: { kind: 'feature', id: sk.id }, data: sk.id, label: sk.name }]);
    return box;
  }
}

// ---------- extrude ----------

export class ExtrudePanel extends FeaturePanel<ExtrudeFeature> {
  helpText = '';
  private depthField: HTMLElement | null = null;
  render(): HTMLElement[] {
    const f = this.f;
    const ctx = this.ctx();
    const sketch = this.sketchBox(tr("Profile sketch"), () => f.sketch, (id) => { f.sketch = id ?? ''; });
    const endOpts = [{ value: 'blind' as const, label: tr("Blind") }, { value: 'throughAll' as const, label: tr("Through All") }, { value: 'midPlane' as const, label: tr("Mid Plane") }];
    const depth = numberField({ label: tr("Depth"), icon: 'ruler', value: f.depth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { f.depth = v; this.syncDepth(); this.changed(); } });
    this.depthField = depth;
    depth.hidden = f.end === 'throughAll';
    // A draft linked to an equation ("=Angle") is on too.
    const hasDraft = String(f.draft).trim().startsWith('=') || Number(f.draft) > 0;
    const draftAngle = numberField({ label: tr("Draft angle"), icon: 'draft', value: f.draft || 3, kind: 'angle', ctx, min: 0, onChange: (v) => { f.draft = v; this.changed(); } });
    draftAngle.hidden = !hasDraft;
    const outward = checkbox(tr("Draft outward"), f.draftOutward, (v) => { f.draftOutward = v; this.changed(); });
    outward.hidden = !hasDraft;
    const dir1 = section(tr("Direction 1"), [
      h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('div', { class: 'grow' },
        selectField(tr("End condition"), f.end, endOpts, (v) => {
          f.end = v;
          depth.hidden = v === 'throughAll';
          dir2sec.hidden = v === 'midPlane';
          this.changed();
        }))),
      depth,
      checkbox(tr("Draft"), hasDraft, (v) => {
        f.draft = v ? 3 : 0;
        draftAngle.hidden = !v;
        outward.hidden = !v;
        this.changed();
      }),
      draftAngle, outward,
    ]);
    const d2depth = numberField({ label: tr("Depth"), icon: 'ruler', value: f.dir2?.depth ?? f.depth, kind: 'length', ctx, min: 1e-6, onChange: (v) => { if (f.dir2) { f.dir2.depth = v; this.changed(); } } });
    const dir2sec = section(tr("Direction 2"), [
      selectField(tr("End condition"), f.dir2?.end ?? 'blind', [{ value: 'blind' as const, label: tr("Blind") }, { value: 'throughAll' as const, label: tr("Through All") }], (v) => {
        if (f.dir2) { f.dir2.end = v; d2depth.hidden = v === 'throughAll'; this.changed(); }
      }),
      d2depth,
    ], { collapsed: !f.dir2, checkbox: { checked: !!f.dir2, onChange: (v) => { f.dir2 = v ? { end: 'blind', depth: f.depth } : null; this.changed(); } } });
    dir2sec.hidden = f.end === 'midPlane';
    return [section(tr("Profile"), [sketch.el]), dir1, dir2sec];
  }

  protected validate() {
    return this.f.sketch ? null : tr("Select a sketch to extrude");
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
  canvasValue(): CanvasValue | null {
    const f = this.f;
    if (!f.sketch || f.end === 'throughAll') return null;
    const sk = this.app.store.feature(f.sketch);
    if (sk?.type !== 'sketch') return null;
    const fr = this.app.frameOfSketch(sk) ?? this.app.frames[f.sketch] ?? null;
    if (!fr) return null;
    const dir = scale(fr.n, (f.cut ? -1 : 1) * (f.flip ? -1 : 1));
    const depth = this.depthNumber();
    // Place the handle at the middle of the sketch, then at the end of the
    // extrusion, like the arrow Fusion shows.
    const b = sketchBounds(new SketchIndex(sk.entities));
    const center: Vec3 = b ? toWorld(fr, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]) : fr.o;
    const anchor = add(center, scale(dir, f.end === 'midPlane' ? depth / 2 : depth));
    return {
      anchor, axis: dir, value: depth, kind: 'length', label: tr("Depth"), min: 1e-6,
      onChange: (v) => { f.depth = v; this.syncDepth(); this.changed(); },
      menu: () => [
        { label: tr("Reverse direction"), icon: 'reset', run: () => { f.flip = !f.flip; this.changed(); } },
      ],
    };
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
    return [
      section(tr("Profile"), [sketch.el]),
      section(tr("Axis"), [axis.el]),
      section(tr("Direction 1"), [
        h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('div', { class: 'grow' },
          selectField(tr("Type"), f.end, [{ value: 'blind' as const, label: tr("Blind") }, { value: 'midPlane' as const, label: tr("Mid Plane") }], (v) => { f.end = v; this.changed(); }))),
        angle,
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

// ---------- hole ----------

export class HolePanel extends FeaturePanel<HoleFeature> {
  /** Sketch created by this panel to hold hole positions. */
  private createdSketch: Id | null = null;
  /** Fusion-style flow: positions are confirmed before the hole is previewed. */
  private positionsReady: boolean;
  private positionsHint: HTMLElement | null = null;
  private confirmPositions: HTMLButtonElement | null = null;
  private parameterSections: HTMLElement[] = [];
  private positionsBox: SelectionBox | null = null;
  private positionList: HTMLElement | null = null;
  private addCenterButton: HTMLButtonElement | null = null;
  private addExactButton: HTMLButtonElement | null = null;
  private exactPlacement: HTMLElement[] = [];

  constructor(app: App, f: HoleFeature, editing: boolean) {
    super(app, f, editing);
    this.positionsReady = editing;
    this.helpText = editing ? '' : tr("Choose the hole positions first, then define the hole type and size.");
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
    const threadSize = selectField(tr("Thread size"), f.threadSize ?? 'Custom', [
      ...THREAD_PRESETS.map((p) => ({ value: p.id, label: p.label })),
      { value: 'Custom', label: tr("Custom") },
    ], (v) => {
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
      threadSize.hidden = !tapped;
      threadClass.hidden = !tapped;
      tapDrill.hidden = !tapped;
      threadPitch.hidden = !customThread;
      diameter.hidden = customThread ? false : tapped;
      depth.hidden = f.end === 'throughAll';
      tip.hidden = f.end === 'throughAll';
      tipAngle.hidden = f.end === 'throughAll' || (f.tip ?? 'flat') !== 'drill';
    };
    sync();

    const positions = new SelectionBox(this, tr("Positions"), { face: true, planarOnly: true, feature: true, edge: true, vertex: true }, (it) => this.pickPosition(it), (items) => {
      if (!items.length) {
        this.f.sketch = '';
        this.positionsReady = false;
      }
      this.syncPlacement();
      this.changed();
    }, { placeholder: tr("Click a face, edge, vertex, or choose a sketch with points"), icon: 'point', single: true });
    this.positionsBox = positions;
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
    this.confirmPositions = h('button', { type: 'button', class: 'btn primary small' }, tr("Confirm Positions")) as HTMLButtonElement;
    this.confirmPositions.addEventListener('click', () => {
      if (this.positionCount() === 0) return;
      this.positionsReady = true;
      this.syncPlacement();
      this.changed();
    });
    const positionsSection = section(tr("Positions"), [
      positions.el, precisionHelp, this.positionList, this.addCenterButton,
      exactXField, exactYField, this.addExactButton, this.positionsHint, this.confirmPositions,
    ]);

    const typeSection = section(tr("Hole Type"), [
      selectField(tr("Type"), f.kind, kinds, (v) => { f.kind = v; sync(); this.changed(); }, 'hole'),
      diameter,
      threadSize, threadClass, threadPitch, tapDrill,
      ...cb, ...cb2, ...cs, ...cd, ...sf,
    ]);
    const endSection = section(tr("End Condition"), [
      h('div', { class: 'row' }, flipButton(tr("Reverse direction"), f.flip, (v) => { f.flip = v; this.changed(); }), h('div', { class: 'grow' },
        selectField(tr("End condition"), f.end, [{ value: 'throughAll' as const, label: tr("Through All") }, { value: 'blind' as const, label: tr("Blind") }], (v) => { f.end = v; sync(); this.changed(); }))),
      depth,
      tip, tipAngle,
    ]);
    this.parameterSections = [typeSection, endSection];
    this.syncPlacement();
    return [positionsSection, typeSection, endSection];
  }

  /** A face click adds a free point; edges and vertices snap to exact model geometry. */
  private pickPosition(it: SelItem): SelBoxItem | null {
    const f = this.f;
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
      if (!face?.frame) return null;
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
      const world = edge.type === 'circle' && edge.center ? edge.center : (app.lastPickPoint ?? edge.mid);
      if (!this.addHolePointWorld(world)) return null;
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

  private addHolePointLocal(x: number, y: number): boolean {
    const sk = this.currentSketch();
    if (!sk || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.app.store.change(tr("Add hole position"), (doc) => {
      const target = doc.features.find((f) => f.id === sk.id);
      if (target?.type !== 'sketch') return;
      let n = target.entities.length + 1;
      while (target.entities.some((e) => e.id === `p${n}`)) n++;
      target.entities.push({ id: `p${n}`, t: 'point', x, y });
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
      if (point?.t === 'point') point[axis] = value;
    });
  }

  private removePosition(id: Id) {
    this.app.store.change(tr("Remove hole position"), (doc) => {
      const sk = doc.features.find((f) => f.id === this.f.sketch);
      if (sk?.type === 'sketch') sk.entities = sk.entities.filter((e) => e.id !== id);
    });
    this.renderPositionRows();
    this.syncPlacement();
  }

  private positionCount(): number {
    return this.positionPoints().length;
  }

  private syncPlacement() {
    const count = this.positionCount();
    if (count === 0) this.positionsReady = false;
    this.renderPositionRows();
    if (this.positionsHint) {
      this.positionsHint.textContent = this.positionsReady
        ? tr("Positions confirmed. Click more points to add holes, or set the hole type and end condition.")
        : count
          ? tr("{0} hole position(s). Add more points, then confirm.", [count])
          : tr("Place at least one hole position on a planar face or in a sketch.");
    }
    if (this.confirmPositions) {
      this.confirmPositions.disabled = count === 0;
      this.confirmPositions.hidden = this.positionsReady;
    }
    if (this.addCenterButton) this.addCenterButton.disabled = !this.f.sketch;
    if (this.addExactButton) this.addExactButton.disabled = !this.f.sketch;
    for (const el of this.exactPlacement) el.hidden = !this.f.sketch;
    for (const s of this.parameterSections) s.hidden = !this.positionsReady;
    if (!this.positionsReady && this.positionsBox) this.activate(this.positionsBox);
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
    if (!this.positionsReady) return tr("Confirm the hole positions before creating the hole");
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
  render(): HTMLElement[] {
    const f = this.f;
    const ref = new SelectionBox(this, tr("First reference"), { plane: true, planarOnly: true }, toPlane(this.app), (items) => { f.ref = (items[0]?.data as PlaneRef) ?? null; this.changed(); }, { single: true, icon: 'plane' });
    if (f.ref) ref.setItems([{ item: planeItem(this.app, f.ref), data: f.ref, label: planeLabel(this.app, f.ref) }]);
    const offset = numberField({ label: tr("Offset distance"), icon: 'ruler', value: f.offset, kind: 'length', ctx: this.ctx(), onChange: (v) => { f.offset = v; this.syncOffset(); this.changed(); } });
    this.offsetField = offset;
    return [section(tr("First Reference"), [
      ref.el,
      offset,
      checkbox(tr("Flip offset"), f.flip, (v) => { f.flip = v; this.syncOffset(); this.changed(); }),
    ])];
  }

  private offsetNumber(): number {
    try {
      return this.app.store.evalParam(this.f.offset, 'length');
    } catch {
      return 0;
    }
  }

  private syncOffset() {
    if (this.offsetField) setNumberFieldValue(this.offsetField, this.f.offset, this.ctx());
  }

  /** The signed offset of the plane: the value Fusion shows beside the plane. */
  canvasValue(): CanvasValue | null {
    const f = this.f;
    if (!f.ref) return null;
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

  protected validate() {
    return this.f.ref ? null : tr("Select a plane or planar face");
  }

  onBuild() {
    // Show the resulting plane while editing.
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
    case 'draft': return new DraftPanel(app, f, editing);
    default: return null;
  }
}

/** Creates a new feature panel, pre-filling from the current selection. */
export function startFeature(app: App, type: Feature['type'], opts: { cut?: boolean } = {}): PropertyPanel | null {
  const doc = app.store.doc;
  const id = app.store.nextId('f');
  const size = app.typicalSize();
  const sel = app.selection.items;
  const selSketch = (() => {
    for (const it of sel) if (it.kind === 'feature' && app.store.feature(it.id)?.type === 'sketch') return it.id;
    // Default to the most recent unconsumed sketch.
    const used = new Set(doc.features.flatMap((f) => (f.type === 'extrude' || f.type === 'revolve' || f.type === 'hole' ? [f.sketch] : f.type === 'loft' ? f.profiles : f.type === 'sweep' ? [f.profile, f.path] : [])));
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
    case 'plane': f = newPlane(id, name, app.selectedPlaneRef(), size); break;
    case 'loft': f = newLoft(id, name, sel.filter((it) => it.kind === 'feature' && app.store.feature(it.id)?.type === 'sketch').map((it) => (it as { id: Id }).id), !!opts.cut); break;
    case 'sweep': f = newSweep(id, name, !!opts.cut); break;
    case 'draft': { const x = newDraft(id, name); x.faces = faces; f = x; break; }
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
