// Assembly component properties, move/rotate and the joints that constrain
// parts to each other.

import {
  connectorAxis, dominantAxis, frameToLocal, jointPlacement, movableJoints, relativeTransform, rotateAbout, snapJointValue,
} from '../model/assembly';
import type {
  AssemblyAxis, AssemblyJoint, AssemblyJointRef, AssemblyJointType, AssemblyMate, AssemblyMateType, ComponentTransform, Id,
} from '../model/types';
import { cross, dot, perpendicular, type Vec3 } from '../math/vec';
import { h } from '../ui/dom';
import { tr } from '../i18n';
import type { App } from './app';
import { PropertyPanel, checkbox, numberField, section, selectField } from './pm';
import type { VPEvent, ViewportTool } from './viewport';

const CONNECTORS = [
  { value: 'origin' as const, labelKey: 'Origin' },
  { value: 'x' as const, labelKey: 'X axis' },
  { value: 'y' as const, labelKey: 'Y axis' },
  { value: 'z' as const, labelKey: 'Z axis' },
  { value: 'xy' as const, labelKey: 'XY plane' },
  { value: 'xz' as const, labelKey: 'XZ plane' },
  { value: 'yz' as const, labelKey: 'YZ plane' },
];

const connectorOptions = () => CONNECTORS.map((o) => ({ value: o.value, label: tr(o.labelKey) }));
const mateHasValue = (type: AssemblyMateType) => type === 'distance' || type === 'angle' || type === 'flush';
const jointSecondaryAngle = (type: AssemblyJointType) => type === 'cylindrical' || type === 'ball' || type === 'pinSlot';
const jointHasSecondary = (type: AssemblyJointType) => type === 'cylindrical' || type === 'planar' || type === 'ball' || type === 'pinSlot';

const cloneTransform = (t: ComponentTransform): ComponentTransform => ({
  position: [...t.position],
  rotation: [...t.rotation],
});

export class AssemblyComponentPanel extends PropertyPanel {
  readonly title = tr("Component Properties");
  icon = 'part';
  editingId: Id;
  private draft: ComponentTransform;
  private name: string;
  private visible: boolean;
  private fixed: boolean;
  private readonly original: string;

  constructor(private app: App, private componentId: Id) {
    super();
    const component = app.component(componentId);
    if (!component) throw new Error(tr("The component no longer exists."));
    this.editingId = componentId;
    this.draft = cloneTransform(component.transform);
    this.name = component.name;
    this.visible = component.visible;
    this.fixed = component.fixed === true;
    this.original = JSON.stringify([this.name, this.draft, this.visible, this.fixed]);
  }

  private changed() {
    this.app.commands.changed();
  }

  render(): HTMLElement[] {
    const ctx = this.app.unitContext();
    const name = h('input', {
      class: 'input',
      value: this.name,
      'aria-label': tr("Component name"),
      autocomplete: 'off',
    }) as HTMLInputElement;
    name.addEventListener('input', () => {
      this.name = name.value;
      this.changed();
    });
    const position = (axis: 0 | 1 | 2) => numberField({
      label: tr("Position {0}", [axis === 0 ? 'X' : axis === 1 ? 'Y' : 'Z']),
      icon: 'ruler',
      value: this.draft.position[axis],
      kind: 'length',
      ctx,
      onChange: (value) => {
        if (typeof value === 'number') this.draft.position[axis] = value;
        this.changed();
      },
    });
    const rotation = (axis: 0 | 1 | 2) => numberField({
      label: tr("Rotation {0}", [axis === 0 ? 'X' : axis === 1 ? 'Y' : 'Z']),
      icon: 'revolve',
      value: this.draft.rotation[axis],
      kind: 'angle',
      ctx,
      onChange: (value) => {
        if (typeof value === 'number') this.draft.rotation[axis] = value;
        this.changed();
      },
    });
    const reset = h('button', { class: 'btn small', type: 'button' }, tr("Reset placement"));
    reset.addEventListener('click', () => {
      this.draft = { position: [0, 0, 0], rotation: [0, 0, 0] };
      this.app.refreshPanel();
      this.changed();
    });
    const visibility = checkbox(tr("Visible"), this.visible, (checked) => {
      this.visible = checked;
      this.changed();
    });
    const fixed = checkbox(tr("Fix component"), this.fixed, (checked) => {
      this.fixed = checked;
      this.changed();
    });
    return [
      section(tr("Component"), [
        h('div', { class: 'field-label' }, tr("Component name")),
        name,
        visibility,
        fixed,
      ]),
      section(tr("Position"), [position(0), position(1), position(2)]),
      section(tr("Rotation"), [rotation(0), rotation(1), rotation(2), reset]),
    ];
  }

  get edited(): boolean {
    return this.original !== JSON.stringify([this.name, this.draft, this.visible, this.fixed]);
  }

  ok(): boolean {
    if (!this.name.trim()) {
      this.setMessage('error', tr("Enter a component name."));
      return false;
    }
    this.app.updateComponent(this.componentId, {
      name: this.name.trim(),
      transform: cloneTransform(this.draft),
      visible: this.visible,
      fixed: this.fixed,
    });
    return true;
  }
}

export class AssemblyMatePanel extends PropertyPanel {
  readonly title: string;
  icon = 'relation';
  editingId: Id | null;
  private draft: AssemblyMate;
  private readonly original: string;

  constructor(private app: App, mate?: AssemblyMate) {
    super();
    if (mate) {
      this.draft = structuredClone(mate);
      this.editingId = mate.id;
      this.title = tr("Edit Assembly Mate");
    } else {
      const selected = app.selection.ofKind('component');
      if (selected.length !== 2) throw new Error(tr("Select two components to create an assembly mate."));
      this.draft = {
        id: app.store.nextId('m'),
        name: tr("Mate{0}", [app.store.doc.mates?.length ? (app.store.doc.mates.length + 1) : 1]),
        type: 'coincident',
        a: selected[0].id,
        b: selected[1].id,
        axis: 'x',
        value: 0,
      };
      this.editingId = null;
      this.title = tr("Assembly Mate");
    }
    this.original = JSON.stringify(this.draft);
  }

  private changed() {
    this.app.commands.changed();
  }

  render(): HTMLElement[] {
    const d = this.draft;
    const name = h('input', { class: 'input', value: d.name, 'aria-label': tr("Mate name"), autocomplete: 'off' }) as HTMLInputElement;
    name.addEventListener('input', () => { d.name = name.value; this.changed(); });
    const a = this.app.component(d.a)?.name ?? d.a;
    const b = this.app.component(d.b)?.name ?? d.b;
    const type = selectField<AssemblyMateType>(tr("Mate type"), d.type, [
      { value: 'coincident', label: tr("Coincident") },
      { value: 'distance', label: tr("Distance") },
      { value: 'angle', label: tr("Angle") },
      { value: 'parallel', label: tr("Parallel") },
      { value: 'perpendicular', label: tr("Perpendicular") },
      { value: 'flush', label: tr("Flush") },
    ], (value) => { d.type = value; this.app.refreshPanel(); this.changed(); });
    const aRef = selectField(tr("Reference connector"), d.aRef ?? 'origin', connectorOptions(), (value) => {
      d.aRef = value;
      const axis = connectorAxis(value);
      if (axis) d.axis = axis;
      this.changed();
    });
    const bRef = selectField(tr("Driven connector"), d.bRef ?? 'origin', connectorOptions(), (value) => {
      d.bRef = value;
      const axis = connectorAxis(value);
      if (axis) d.axis = axis;
      this.changed();
    });
    const axis = selectField<AssemblyAxis>(tr("Axis"), d.axis, [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ], (value) => { d.axis = value; this.changed(); });
    const value = numberField({
      label: d.type === 'angle' ? tr("Angle") : tr("Distance"),
      icon: 'ruler',
      value: d.value,
      kind: d.type === 'angle' ? 'angle' : 'length',
      ctx: this.app.unitContext(),
      onChange: (next) => { if (typeof next === 'number') d.value = next; this.changed(); },
    });
    value.hidden = !mateHasValue(d.type);
    const originCoincident = d.type === 'coincident' && (d.aRef ?? 'origin') === 'origin' && (d.bRef ?? 'origin') === 'origin';
    axis.hidden = originCoincident || d.type === 'distance' || d.type === 'flush';
    return [
      section(tr("Definition"), [
        h('p', { class: 'field-label' }, tr("This is a legacy mate between component origins and axes. New constraints use picked faces or edges: use Joint (Assembly Mate) instead.")),
        h('div', { class: 'field-label' }, tr("Mate name")), name,
        h('p', { class: 'field-label' }, tr("{0} is driven from {1}.", [b, a])),
        aRef, bRef, type, axis, value,
      ]),
    ];
  }

  get edited(): boolean {
    return this.original !== JSON.stringify(this.draft);
  }

  ok(): boolean {
    if (!this.draft.name.trim()) { this.setMessage('error', tr("Enter a mate name.")); return false; }
    if (this.draft.type !== 'distance' && this.draft.type !== 'angle' && this.draft.type !== 'flush') this.draft.value = 0;
    this.draft.name = this.draft.name.trim();
    if (this.editingId) this.app.replaceMate(this.draft);
    else this.app.addMate(this.draft);
    return true;
  }
}

/**
 * Fusion's Joint: select the geometry where the two parts meet (their origin,
 * a planar face or an edge) and the joint type. The driven part is placed
 * where the joint puts it and follows the reference from then on.
 */
export class AssemblyJointPanel extends PropertyPanel {
  icon = 'relation';
  editingId: Id | null;
  private draft: AssemblyJoint;
  private readonly original: string;
  /** Two components were selected: a joint between picked geometry. */
  private pair: { a: Id; b: Id } | null = null;
  private aChoice = 'origin';
  private bChoice = 'origin';
  private mate = true;

  constructor(private app: App, joint?: AssemblyJoint) {
    super();
    if (joint) {
      this.draft = structuredClone(joint);
      this.editingId = joint.id;
      this.title = tr("Edit Joint");
      this.aChoice = connectorKey(app, joint.aRef);
      this.bChoice = connectorKey(app, joint.bRef);
      this.mate = joint.flip !== true;
    } else {
      const selected = app.selection.ofKind('component');
      if (selected.length >= 2) {
        // Fusion: pick the reference part first, the moving part second.
        this.pair = { a: selected[0].id, b: selected[1].id };
        this.aChoice = 'origin';
        this.bChoice = 'origin';
      }
      const component = selected[0];
      if (!component) throw new Error(tr("Select one or two components to add a joint."));
      this.draft = {
        id: app.store.nextId('j'),
        name: tr("Joint{0}", [app.store.doc.joints?.length ? (app.store.doc.joints.length + 1) : 1]),
        type: this.pair ? 'rigid' : 'revolute',
        component: this.pair ? this.pair.b : component.id,
        relativeTo: this.pair?.a,
        axis: 'z',
        axis2: 'y',
        value: 0,
        min: -180,
        max: 180,
        value2: 0,
        min2: -180,
        max2: 180,
      };
      this.editingId = null;
      this.title = tr("Joint");
    }
    this.original = JSON.stringify(this.draft);
  }

  readonly title: string;

  private changed() {
    this.app.commands.changed();
  }

  render(): HTMLElement[] {
    const d = this.draft;
    const name = h('input', { class: 'input', value: d.name, 'aria-label': tr("Joint name"), autocomplete: 'off' }) as HTMLInputElement;
    name.addEventListener('input', () => { d.name = name.value; this.changed(); });
    const type = selectField<AssemblyJointType>(tr("Joint type"), d.type, [
      { value: 'rigid', label: tr("Rigid") },
      { value: 'revolute', label: tr("Revolute") },
      { value: 'prismatic', label: tr("Slider") },
      { value: 'cylindrical', label: tr("Cylindrical") },
      { value: 'planar', label: tr("Planar") },
      { value: 'ball', label: tr("Ball") },
      { value: 'pinSlot', label: tr("Pin-Slot") },
    ], (value) => {
      d.type = value;
      const angle = value === 'revolute' || value === 'ball';
      d.min = angle ? -180 : -100;
      d.max = angle ? 180 : 100;
      d.value = Math.max(d.min, Math.min(d.max, d.value));
      this.app.refreshPanel();
      this.changed();
    });
    if (this.pair) {
      const aOptions = jointConnectors(this.app, this.pair.a);
      const bOptions = jointConnectors(this.app, this.pair.b);
      const aRef = selectField(tr("Reference geometry"), this.aChoice, aOptions, (value) => { this.aChoice = value; this.changed(); });
      const bRef = selectField(tr("Driven geometry"), this.bChoice, bOptions, (value) => { this.bChoice = value; this.changed(); });
      const mate = checkbox(tr("Mate the picked faces"), this.mate, (checked) => { this.mate = checked; this.changed(); });
      const a = this.app.component(this.pair.a)?.name ?? this.pair.a;
      const b = this.app.component(this.pair.b)?.name ?? this.pair.b;
      return [
        section(tr("Joint"), [
          h('div', { class: 'field-label' }, tr("Joint name")), name,
          h('p', { class: 'field-label' }, tr("{0} is driven from {1}.", [b, a])),
          type,
        ]),
        section(tr("Geometry"), [aRef, bRef, mate]),
        d.type === 'rigid'
          ? section(tr("Rigid"), [h('p', { class: 'field-label' }, tr("A rigid joint locks the two parts together."))])
          : section(tr("Motion"), [this.valueField(d), ...this.rangeFields(d)]),
      ];
    }
    const component = this.app.component(d.component);
    const axis = selectField<AssemblyAxis>(tr("Axis"), d.axis, [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ], (value) => { d.axis = value; this.changed(); });
    const axis2 = selectField<AssemblyAxis>(tr("Secondary axis"), d.axis2 ?? 'y', [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ], (value) => { d.axis2 = value; this.changed(); });
    const secondaryAngle = jointSecondaryAngle(d.type);
    const value2 = numberField({ label: tr("Secondary value"), value: d.value2 ?? 0, kind: secondaryAngle ? 'angle' : 'length', ctx: this.app.unitContext(), onChange: (v) => { if (typeof v === 'number') d.value2 = v; this.changed(); } });
    const min2 = numberField({ label: tr("Secondary minimum"), value: d.min2 ?? -180, kind: secondaryAngle ? 'angle' : 'length', ctx: this.app.unitContext(), onChange: (v) => { if (typeof v === 'number') d.min2 = v; this.changed(); } });
    const max2 = numberField({ label: tr("Secondary maximum"), value: d.max2 ?? 180, kind: secondaryAngle ? 'angle' : 'length', ctx: this.app.unitContext(), onChange: (v) => { if (typeof v === 'number') d.max2 = v; this.changed(); } });
    const secondary = section(tr("Secondary motion"), [axis2, value2, min2, max2]);
    secondary.hidden = !jointHasSecondary(d.type);
    const primary = section(tr("Motion"), [this.valueField(d), ...this.rangeFields(d)]);
    primary.hidden = d.type === 'rigid';
    return [
      section(tr("Joint"), [
        h('div', { class: 'field-label' }, tr("Joint name")), name,
        h('p', { class: 'field-label' }, tr("Component: {0}", [component?.name ?? d.component])),
        type, axis,
      ]),
      primary, secondary,
    ];
  }

  private valueField(d: AssemblyJoint) {
    const primaryAngle = d.type === 'revolute' || d.type === 'ball';
    return numberField({ label: tr("Current value"), value: d.value, kind: primaryAngle ? 'angle' : 'length', ctx: this.app.unitContext(), onChange: (v) => { if (typeof v === 'number') d.value = v; this.changed(); } });
  }

  private rangeFields(d: AssemblyJoint) {
    const primaryAngle = d.type === 'revolute' || d.type === 'ball';
    return [
      numberField({ label: tr("Minimum"), value: d.min, kind: primaryAngle ? 'angle' : 'length', ctx: this.app.unitContext(), onChange: (v) => { if (typeof v === 'number') d.min = v; this.changed(); } }),
      numberField({ label: tr("Maximum"), value: d.max, kind: primaryAngle ? 'angle' : 'length', ctx: this.app.unitContext(), onChange: (v) => { if (typeof v === 'number') d.max = v; this.changed(); } }),
    ];
  }

  get edited(): boolean {
    return this.original !== JSON.stringify(this.draft) || !!this.pair;
  }

  ok(): boolean {
    if (!this.draft.name.trim()) { this.setMessage('error', tr("Enter a joint name.")); return false; }
    if (this.draft.min > this.draft.max) { this.setMessage('error', tr("The minimum must not exceed the maximum.")); return false; }
    if (jointHasSecondary(this.draft.type) && (this.draft.min2 ?? 0) > (this.draft.max2 ?? 0)) {
      this.setMessage('error', tr("The secondary minimum must not exceed the secondary maximum."));
      return false;
    }
    this.draft.name = this.draft.name.trim();
    this.draft.value = Math.max(this.draft.min, Math.min(this.draft.max, this.draft.value));
    if (this.pair && !this.editingId) {
      const placed = this.makeGeometryJoint();
      if (!placed) return false;
      this.app.addGeometryJoint(placed.joint, placed.placement);
      return true;
    }
    if (this.editingId) this.app.replaceJoint(this.draft);
    else this.app.addJoint(this.draft);
    return true;
  }

  /** Computes where the driven component goes so the picked geometry meets. */
  private makeGeometryJoint(): { joint: AssemblyJoint; placement: ComponentTransform } | null {
    const pair = this.pair!;
    const a = this.app.component(pair.a);
    const b = this.app.component(pair.b);
    const aFrame = connectorFrame(this.app, pair.a, this.aChoice);
    const bFrame = connectorFrame(this.app, pair.b, this.bChoice);
    if (!a || !b || !aFrame || !bFrame) {
      this.setMessage('error', tr("Pick reference geometry on both components."));
      return null;
    }
    if (a.fixed && b.fixed) {
      this.setMessage('error', tr("Both components are grounded. Float one of them first."));
      return null;
    }
    const mate = this.mate;
    const placement = jointPlacement(
      { transform: a.transform, p: aFrame.p, d: aFrame.d },
      { transform: b.transform, p: bFrame.p, d: bFrame.d },
      { mate, offset: 0 },
    );
    const joint: AssemblyJoint = {
      ...this.draft,
      component: pair.b,
      relativeTo: pair.a,
      offset: relativeTransform(a.transform, placement),
      aRef: { kind: aFrame.kind, name: aFrame.name, ...frameToLocal(a.transform, { p: aFrame.p, d: aFrame.d }) },
      bRef: { kind: bFrame.kind, name: bFrame.name },
      axis: dominantAxis(aFrame.d),
      flip: !mate,
    };
    if (joint.type === 'revolute' || joint.type === 'ball') {
      joint.min = -180; joint.max = 180;
    } else if (joint.type !== 'rigid' && joint.type !== 'planar') {
      joint.min = -100; joint.max = 100;
    }
    joint.value = 0;
    return { joint, placement };
  }
}

/** "origin", "face:<index>" or "edge:<index>" for a connector as stored. */
function connectorKey(app: App, ref?: AssemblyJointRef | null): string {
  if (!ref) return 'origin';
  if (ref.kind === 'origin') return 'origin';
  if (ref.kind === 'face') {
    const i = app.faces.findIndex((f) => f.name === ref.name);
    return i >= 0 ? `face:${i}` : 'origin';
  }
  const i = app.edges.findIndex((e) => e.name === ref.name);
  return i >= 0 ? `edge:${i}` : 'origin';
}

/** The geometry a joint can grip on one component, as select options. */
function jointConnectors(app: App, componentId: Id): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [{ value: 'origin', label: tr("Origin") }];
  let faces = 0, edges = 0;
  const owned = (owner: string | undefined) => owner === componentId || !!owner?.startsWith(`${componentId}/`);
  app.faces.forEach((face, i) => {
    if (owned(face.component) && face.type === 'plane') {
      out.push({ value: `face:${i}`, label: tr("Face {0}", [++faces]) });
    }
  });
  app.edges.forEach((edge, i) => {
    if (!owned(edge.component)) return;
    if (edge.type === 'circle' || edge.type === 'line') out.push({ value: `edge:${i}`, label: tr("Edge {0}", [++edges]) });
  });
  return out;
}

/** Contact point and direction of a picked connector, in world space. */
function connectorFrame(app: App, componentId: Id, value: string): { p: Vec3; d: Vec3; kind: AssemblyJointRef['kind']; name?: string } | null {
  if (value === 'origin') {
    const component = app.component(componentId);
    return component ? { p: [...component.transform.position], d: [0, 0, 1], kind: 'origin' } : null;
  }
  const [kind, raw] = value.split(':');
  const index = Number(raw);
  if (kind === 'face') {
    const face = app.faces[index];
    const owner = face?.component ?? '';
    if (!face || !face.normal || (owner !== componentId && !owner.startsWith(`${componentId}/`))) return null;
    return { p: [...face.center], d: [...face.normal], kind: 'face', name: face.name };
  }
  const edge = app.edges[index];
  const owner = edge?.component ?? '';
  if (!edge || (owner !== componentId && !owner.startsWith(`${componentId}/`))) return null;
  const p = edge.type === 'circle' ? edge.center : edge.mid;
  const d = edge.type === 'circle' ? edge.axis : edge.dir;
  if (!p || !d) return null;
  return { p: [...p], d: [...d], kind: 'edge', name: edge.name };
}

export class MotionStudyPanel extends PropertyPanel {
  readonly title = tr("Motion Study");
  icon = 'play';
  confirm = false;
  closeLabel = tr("Stop");
  private jointId: Id | null;
  private timer = 0;

  constructor(private app: App) {
    super();
    const selected = app.selection.items.find((item) => item.kind === 'assemblyJoint');
    const joints = movableJoints(app.store.doc);
    this.jointId = selected?.kind === 'assemblyJoint'
      ? selected.id
      : joints[0]?.id ?? null;
    this.onCloseClick = () => {
      this.app.stopJointMotion();
      void this.app.closePanel(false);
    };
  }

  render(): HTMLElement[] {
    const joints = movableJoints(this.app.store.doc);
    if (!joints.length) {
      return [section(tr("Motion Study"), [h('p', { class: 'field-label' }, tr("Add a joint to a floating component first."))])];
    }
    this.jointId = joints.some((j) => j.id === this.jointId) ? this.jointId : joints[0].id;
    const joint = joints.find((j) => j.id === this.jointId)!;
    const primaryAngle = joint.type === 'revolute' || joint.type === 'ball';
    const selector = selectField(tr("Joint"), joint.id, joints.map((j) => ({ value: j.id, label: j.name })), (id) => {
      this.jointId = id;
      this.app.setJointMotionValue(id, this.app.jointMotionValue(id));
      this.app.refreshPanel();
    });
    const range = h('input', {
      type: 'range', min: String(joint.min), max: String(joint.max), step: primaryAngle ? '0.5' : '0.1',
      value: String(this.app.jointMotionValue(joint.id)), 'aria-label': tr("Joint position"),
    }) as HTMLInputElement;
    const value = h('output', { class: 'field-label' }, `${this.app.jointMotionValue(joint.id).toFixed(2)}${primaryAngle ? '°' : ' mm'}`);
    range.addEventListener('input', () => {
      this.app.setJointMotionValue(joint.id, Number(range.value));
      value.textContent = `${Number(range.value).toFixed(2)}${primaryAngle ? '°' : ' mm'}`;
    });
    const secondaryAngle = jointSecondaryAngle(joint.type);
    const secondaryMin = joint.min2 ?? -180;
    const secondaryMax = joint.max2 ?? 180;
    const range2 = h('input', {
      type: 'range', min: String(secondaryMin), max: String(secondaryMax), step: secondaryAngle ? '0.5' : '0.1',
      value: String(this.app.jointMotionValue2(joint.id)), 'aria-label': tr("Secondary motion"),
    }) as HTMLInputElement;
    const value2 = h('output', { class: 'field-label' }, `${this.app.jointMotionValue2(joint.id).toFixed(2)}${secondaryAngle ? '°' : ' mm'}`);
    range2.addEventListener('input', () => {
      this.app.setJointMotionValue2(joint.id, Number(range2.value));
      value2.textContent = `${Number(range2.value).toFixed(2)}${secondaryAngle ? '°' : ' mm'}`;
    });
    const secondary = h('div', {}, h('div', { class: 'field-label' }, tr("Secondary motion")), range2, value2);
    secondary.hidden = !jointHasSecondary(joint.type);
    const play = h('button', { class: 'btn small', type: 'button' }, this.app.motionRunning ? tr("Pause") : tr("Play"));
    play.addEventListener('click', () => {
      if (this.app.motionRunning) this.app.stopJointMotion();
      else this.app.startJointMotion(joint.id);
      play.textContent = this.app.motionRunning ? tr("Pause") : tr("Play");
    });
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      const current = this.app.jointMotionValue(joint.id);
      range.value = String(current);
      value.textContent = `${current.toFixed(2)}${primaryAngle ? '°' : ' mm'}`;
      const current2 = this.app.jointMotionValue2(joint.id);
      range2.value = String(current2);
      value2.textContent = `${current2.toFixed(2)}${secondaryAngle ? '°' : ' mm'}`;
      if (play.isConnected) play.textContent = this.app.motionRunning ? tr("Pause") : tr("Play");
    }, 100);
    return [section(tr("Motion Study"), [selector, range, value, secondary, play])];
  }

  ok(): boolean {
    return true;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.timer = 0;
  }
}

/**
 * Fusion's Move: drag a component in the view to move it (Shift-drag to
 * rotate), or type offsets. A component joined to another moves by its joint
 * value instead, like dragging a jointed part in Fusion.
 */
export class AssemblyMovePanel extends PropertyPanel implements ViewportTool {
  icon = 'select';
  private ids: Id[] = [];
  private start = new Map<Id, ComponentTransform>();
  private offset: Vec3 = [0, 0, 0];
  private spinAxis: AssemblyAxis = 'z';
  private spinAngle = 0;
  private fields: Record<'x' | 'y' | 'z', HTMLElement> | null = null;
  private angleField: HTMLElement | null = null;
  private dragFrom: { x: number; y: number; rotate: boolean } | null = null;
  private jointDrag: { id: Id; from: number; base: number; perPixel: number } | null = null;
  private rangeOut: HTMLElement | null = null;
  private gizmoDrag: { axis: 'x' | 'y' | 'z'; sx: number; sy: number; ux: number; uy: number; worldPerPx: number } | null = null;
  /** Transforms and joint values when the handle drag started. */
  private gizmoBase: Map<Id, ComponentTransform> = new Map();
  private gizmoJointBase: Map<Id, number> = new Map();
  private ringDrag: { axis: 'x' | 'y' | 'z'; u: Vec3; v: Vec3; start: number; pivot: Vec3 } | null = null;
  private batching = false;

  constructor(private app: App) {
    super();
    this.ids = app.selection.ofKind('component')
      .map((it) => it.id)
      .filter((id) => !!app.component(id) && !app.component(id)!.fixed);
    for (const id of this.ids) {
      const component = app.component(id);
      if (component) this.start.set(id, { position: [...component.transform.position], rotation: [...component.transform.rotation] });
    }
  }

  get title() {
    return tr("Move/Rotate");
  }

  private jointOf(id: Id): AssemblyJoint | undefined {
    return (this.app.store.doc.joints ?? []).find((j) => j.component === id && j.type !== 'rigid');
  }

  private attachTool() {
    if (this.ids.length) this.app.viewport.tool = this;
  }

  mount(): HTMLElement {
    const el = super.mount();
    this.attachTool();
    this.app.visualJointId = this.jointOf(this.ids[0])?.id ?? null;
    this.app.showGizmo = true;
    this.app.viewport.drawReferenceGeometry();
    return el;
  }

  render(): HTMLElement[] {
    this.attachTool();
    if (!this.ids.length) {
      return [section(tr("Move/Rotate"), [h('p', { class: 'field-label' }, tr("Select a component to move. A grounded component cannot be moved."))])];
    }
    const ctx = this.app.unitContext();
    const names = this.ids.map((id) => this.app.component(id)?.name ?? id).join(', ');
    const joint = this.jointOf(this.ids[0]);
    const offsetField = (axis: 0 | 1 | 2, key: 'x' | 'y' | 'z') => numberField({
      label: tr("Move {0}", [key.toUpperCase()]), value: this.offset[axis], kind: 'length', ctx, allowExpr: false,
      onChange: (v) => { if (typeof v === 'number') { this.offset[axis] = v; this.apply(); } },
    });
    const fields = { x: offsetField(0, 'x'), y: offsetField(1, 'y'), z: offsetField(2, 'z') };
    this.fields = fields;
    const angle = numberField({
      label: tr("Rotate"), value: this.spinAngle, kind: 'angle', ctx, allowExpr: false,
      onChange: (v) => { if (typeof v === 'number') { this.spinAngle = v; this.spinAxis = this.spinAxis; this.apply(); } },
    });
    this.angleField = angle;
    const axis = selectField<AssemblyAxis>(tr("Rotation axis"), this.spinAxis, [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ], (v) => { this.spinAxis = v; this.apply(); });
    const reset = h('button', { class: 'btn small', type: 'button' }, tr("Reset"));
    reset.addEventListener('click', () => {
      this.offset = [0, 0, 0];
      this.spinAngle = 0;
      for (const [id, start] of this.start) {
        this.app.setComponentTransforms(new Map([[id, start]]), tr("Reset placement"));
      }
      this.app.refreshPanel();
    });
    const slider = joint ? this.jointSlider(joint) : null;
    return [
      section(tr("Components"), [h('p', { class: 'field-label' }, names)]),
      section(tr("Move"), [fields.x, fields.y, fields.z, reset]),
      section(tr("Rotate"), [axis, angle]),
      joint ? section(tr("Joint"), [
        h('p', { class: 'field-label' }, tr("{0} drives this component.", [joint.name])),
        slider,
      ]) : section(tr("Free Move"), [h('p', { class: 'field-label' }, tr("Drag the component to move it. Hold Shift while dragging to rotate it."))]),
    ];
  }

  /** A jointed component moves by its joint value, like dragging it in Fusion. */
  private jointSlider(joint: AssemblyJoint): HTMLElement {
    const angle = joint.type === 'revolute' || joint.type === 'ball';
    const range = h('input', {
      type: 'range', min: String(joint.min), max: String(joint.max), step: angle ? '0.5' : '0.1',
      value: String(joint.value), 'aria-label': tr("Joint position"),
    }) as HTMLInputElement;
    const out = h('output', { class: 'field-label' }, `${Number(joint.value).toFixed(2)}${angle ? '°' : ' mm'}  (${joint.min} … ${joint.max})`);
    this.rangeOut = out;
    range.addEventListener('input', () => {
      out.textContent = `${Number(range.value).toFixed(2)}${angle ? '°' : ' mm'}`;
      this.setJointValue(joint.id, Number(range.value));
    });
    return h('div', {}, range, out);
  }

  private setJointValue(id: Id, value: number) {
    this.beginBatch();
    this.app.store.change(tr("Move component by joint"), (doc) => {
      const joint = doc.joints?.find((j) => j.id === id);
      if (joint) joint.value = Math.max(joint.min, Math.min(joint.max, value));
    });
    this.app.requestRebuild();
  }

  private beginBatch() {
    if (this.batching) return;
    this.batching = true;
    this.app.store.beginBatch(tr("Move components"));
  }

  private endBatch(keep: boolean) {
    if (!this.batching) return;
    this.batching = false;
    if (keep) this.app.store.endBatch();
    else this.app.store.cancelBatch();
  }

  /** Applies the typed offsets and rotation to every selected component. */
  private apply() {
    if (!this.ids.length) return;
    this.beginBatch();
    const transforms = new Map<Id, ComponentTransform>();
    const axis: Vec3 = this.spinAxis === 'x' ? [1, 0, 0] : this.spinAxis === 'y' ? [0, 1, 0] : [0, 0, 1];
    for (const id of this.ids) {
      const start = this.start.get(id);
      if (!start) continue;
      const moved: ComponentTransform = {
        position: [start.position[0] + this.offset[0], start.position[1] + this.offset[1], start.position[2] + this.offset[2]],
        rotation: [...start.rotation],
      };
      transforms.set(id, this.spinAngle ? rotateAbout(moved, startedPivot(start), axis, this.spinAngle) : moved);
    }
    this.app.setComponentTransforms(transforms);
  }

  /** The axis handle under a canvas pixel, with its screen direction and world scale. */
  private gizmoPick(x: number, y: number): { axis: 'x' | 'y' | 'z'; sx: number; sy: number; ux: number; uy: number; worldPerPx: number } | null {
    const g = this.app.gizmoGeometry();
    if (!g) return null;
    const o = this.app.viewport.project(g.o);
    for (const axis of ['x', 'y', 'z'] as const) {
      const d: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      const tip = this.app.viewport.project([g.o[0] + d[0] * g.size, g.o[1] + d[1] * g.size, g.o[2] + d[2] * g.size]);
      if (screenSegDist(x, y, o[0], o[1], tip[0], tip[1]) > 12) continue;
      const dx = tip[0] - o[0], dy = tip[1] - o[1];
      const len = Math.hypot(dx, dy);
      if (len < 4) continue;
      return { axis, sx: x, sy: y, ux: dx / len, uy: dy / len, worldPerPx: g.size / len };
    }
    return null;
  }

  /** Point on the plane through `pivot` facing `normal` under a canvas pixel. */
  private planePointAt(x: number, y: number, pivot: Vec3, normal: Vec3): Vec3 | null {
    const ray = this.app.renderer.camera.ray(x, y);
    const den = ray.d[0] * normal[0] + ray.d[1] * normal[1] + ray.d[2] * normal[2];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((pivot[0] - ray.o[0]) * normal[0] + (pivot[1] - ray.o[1]) * normal[1] + (pivot[2] - ray.o[2]) * normal[2]) / den;
    return [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
  }

  /** The rotation ring under a canvas pixel, with the plane it turns in. */
  private ringPick(x: number, y: number): { axis: 'x' | 'y' | 'z'; u: Vec3; v: Vec3; pivot: Vec3; start: number } | null {
    const g = this.app.gizmoGeometry();
    if (!g) return null;
    const radius = g.size * 0.78;
    for (const axis of ['x', 'y', 'z'] as const) {
      const n: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      const u = perpendicular(n);
      const v = cross(n, u);
      let best = Infinity;
      let prev: [number, number] | null = null;
      for (let i = 0; i <= 48; i++) {
        const a = (Math.PI * 2 * i) / 48;
        const p = this.app.viewport.project([
          g.o[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * radius,
          g.o[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * radius,
          g.o[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * radius,
        ]);
        if (prev) best = Math.min(best, screenSegDist(x, y, prev[0], prev[1], p[0], p[1]));
        prev = p;
      }
      if (best > 10) continue;
      const hit = this.planePointAt(x, y, g.o, n);
      if (!hit) continue;
      const rel: Vec3 = [hit[0] - g.o[0], hit[1] - g.o[1], hit[2] - g.o[2]];
      const start = Math.atan2(dot(rel, v), dot(rel, u));
      return { axis, u, v, pivot: g.o, start };
    }
    return null;
  }

  /** Turns the selected components about the handle origin around one axis. */
  private applyRing(deltaDeg: number) {
    const drag = this.ringDrag!;
    const dir: Vec3 = drag.axis === 'x' ? [1, 0, 0] : drag.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    this.beginBatch();
    const transforms = new Map<Id, ComponentTransform>();
    for (const id of this.ids) {
      const component = this.app.component(id);
      const base = this.gizmoBase.get(id);
      if (!component || !base) continue;
      const joint = this.jointOf(id);
      if (joint && joint.relativeTo && (joint.type === 'revolute' || joint.type === 'ball')) {
        const from = this.gizmoJointBase.get(joint.id) ?? joint.value;
        this.setJointValue(joint.id, snapJointValue(joint, from + deltaDeg));
        continue;
      }
      transforms.set(id, rotateAbout(base, drag.pivot, dir, deltaDeg));
    }
    if (transforms.size) this.app.setComponentTransforms(transforms);
  }

  /** Moves the selected components along a world axis by `delta` millimetres. */
  private applyGizmo(delta: number) {
    const axis = this.gizmoDrag!.axis;
    const dir: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    this.beginBatch();
    const transforms = new Map<Id, ComponentTransform>();
    for (const id of this.ids) {
      const component = this.app.component(id);
      const base = this.gizmoBase.get(id);
      if (!component || !base) continue;
      const joint = this.jointOf(id);
      if (joint && joint.relativeTo) {
        // A jointed part moves by its joint value, along the joint's own axis.
        const world = this.app.jointRangeVisual()?.id === joint.id ? this.app.jointRangeVisual()! : null;
        const jd = world?.d ?? dir;
        const along = (jd[0] * dir[0] + jd[1] * dir[1] + jd[2] * dir[2]) * delta;
        const from = this.gizmoJointBase.get(joint.id) ?? joint.value;
        this.setJointValue(joint.id, snapJointValue(joint, from + along));
        continue;
      }
      transforms.set(id, {
        position: [base.position[0] + dir[0] * delta, base.position[1] + dir[1] * delta, base.position[2] + dir[2] * delta],
        rotation: [...base.rotation],
      });
    }
    if (transforms.size) this.app.setComponentTransforms(transforms);
  }

  pointerDown = (e: VPEvent): boolean => {
    // A handle grabbed first: drag along that world axis (arrows) or turn a ring.
    const ring = this.ringPick(e.x, e.y);
    if (ring) {
      this.beginBatch();
      this.ringDrag = ring;
      this.gizmoBase.clear();
      this.gizmoJointBase.clear();
      for (const id of this.ids) {
        const component = this.app.component(id);
        if (component) this.gizmoBase.set(id, { position: [...component.transform.position], rotation: [...component.transform.rotation] });
        const joint = this.jointOf(id);
        if (joint) this.gizmoJointBase.set(joint.id, joint.value);
      }
      return true;
    }
    const handle = this.gizmoPick(e.x, e.y);
    if (handle) {
      this.beginBatch();
      this.gizmoDrag = handle;
      this.gizmoBase.clear();
      this.gizmoJointBase.clear();
      for (const id of this.ids) {
        const component = this.app.component(id);
        if (component) this.gizmoBase.set(id, { position: [...component.transform.position], rotation: [...component.transform.rotation] });
        const joint = this.jointOf(id);
        if (joint) this.gizmoJointBase.set(joint.id, joint.value);
      }
      return true;
    }
    const item = this.app.viewport.pickItem(e.x, e.y, { face: true, edge: true });
    const component = this.app.componentOfItem(item);
    if (!component || !this.ids.includes(component.id)) return false;
    this.app.selection.set([{ kind: 'component', id: component.id }]);
    const joint = this.jointOf(component.id);
    this.jointDrag = joint
      ? { id: joint.id, from: e.y, base: joint.value, perPixel: joint.type === 'revolute' || joint.type === 'ball' ? 0.6 : Math.max(0.01, this.app.renderer.camera.pixelSize) }
      : null;
    this.dragFrom = { x: e.x, y: e.y, rotate: e.shift };
    this.beginBatch();
    return true;
  };

  pointerMove = (e: VPEvent, dragging: boolean): void => {
    if (!dragging && !this.dragFrom && !this.gizmoDrag && !this.ringDrag) {
      // Hover feedback for the handle arrows and rings.
      const handle = this.gizmoPick(e.x, e.y);
      const ring = handle ? null : this.ringPick(e.x, e.y);
      const axis = handle?.axis ?? null;
      const ringAxis = ring?.axis ?? null;
      if (axis !== this.app.gizmoAxis || ringAxis !== this.app.gizmoRing) {
        this.app.gizmoAxis = axis;
        this.app.gizmoRing = ringAxis;
        this.app.viewport.drawReferenceGeometry();
      }
      return;
    }
    // A ring drag turns the selected components about the handle origin.
    if (this.ringDrag && dragging) {
      const drag = this.ringDrag;
      const axis: Vec3 = drag.axis === 'x' ? [1, 0, 0] : drag.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      const hit = this.planePointAt(e.x, e.y, drag.pivot, axis);
      if (hit) {
        const rel: Vec3 = [hit[0] - drag.pivot[0], hit[1] - drag.pivot[1], hit[2] - drag.pivot[2]];
        const angle = Math.atan2(dot(rel, drag.v), dot(rel, drag.u));
        let delta = ((angle - drag.start) * 180) / Math.PI;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        this.applyRing(delta);
        this.app.setStatus(`${drag.axis.toUpperCase()}: ${delta.toFixed(1)}°`);
      }
      return;
    }
    // A handle drag carries on without a component drag being open.
    if (this.gizmoDrag && dragging) {
      const g = this.gizmoDrag;
      const along = ((e.x - g.sx) * g.ux + (e.y - g.sy) * g.uy) * g.worldPerPx;
      this.applyGizmo(along);
      this.app.setStatus(`${g.axis.toUpperCase()}: ${along.toFixed(2)} mm`);
      return;
    }
    const from = this.dragFrom;
    if (!from || !dragging) return;
    if (this.jointDrag) {
      const joint = (this.app.store.doc.joints ?? []).find((j) => j.id === this.jointDrag!.id);
      if (!joint) return;
      const raw = this.jointDrag.base + (from.y - e.y) * this.jointDrag.perPixel;
      const value = snapJointValue(joint, raw);
      const angle = joint.type === 'revolute' || joint.type === 'ball';
      this.setJointValue(joint.id, value);
      if (this.rangeOut) this.rangeOut.textContent = `${value.toFixed(2)}${angle ? '°' : ' mm'}  (${joint.min} … ${joint.max})`;
      this.app.setStatus(`${joint.name}: ${value.toFixed(2)}${angle ? '°' : ' mm'}  (${joint.min} … ${joint.max})`);
      this.dragFrom = { ...from, y: e.y };
      return;
    }
    if (from.rotate) {
      const angle = (e.x - from.x) * 0.6;
      const cam = this.app.renderer.camera;
      this.rotateLive = { axis: cam.back, angle };
    } else {
      const cam = this.app.renderer.camera;
      const s = cam.pixelSize;
      const dx = (e.x - from.x) * s;
      const dy = (from.y - e.y) * s;
      this.offset = [this.offset[0] + dx * cam.right[0] + dy * cam.up[0], this.offset[1] + dx * cam.right[1] + dy * cam.up[1], this.offset[2] + dx * cam.right[2] + dy * cam.up[2]];
    }
    this.dragFrom = { ...from, x: e.x, y: e.y };
    this.applyLive();
  };

  pointerUp = (): void => {
    this.dragFrom = null;
    this.jointDrag = null;
    this.rotateLive = null;
    this.gizmoDrag = null;
    this.ringDrag = null;
    this.gizmoBase.clear();
    this.gizmoJointBase.clear();
    // Keep what the drag produced as one undo step.
    this.endBatch(true);
  };

  private rotateLive: { axis: Vec3; angle: number } | null = null;

  /** Drag updates bypass the typed fields: apply straight onto the components. */
  private applyLive() {
    const transforms = new Map<Id, ComponentTransform>();
    for (const id of this.ids) {
      const start = this.start.get(id);
      if (!start) continue;
      let t: ComponentTransform = {
        position: [start.position[0] + this.offset[0], start.position[1] + this.offset[1], start.position[2] + this.offset[2]],
        rotation: [...start.rotation],
      };
      if (this.rotateLive) t = rotateAbout(t, startedPivot(start), this.rotateLive.axis, this.rotateLive.angle);
      transforms.set(id, t);
    }
    this.app.setComponentTransforms(transforms);
  }

  /** Numbers refresh after a drag, without rebuilding the panel while dragging. */
  onBuild(): void {
    if (this.dragFrom) return;
    if (this.fields) {
      const ctx = this.app.unitContext();
      setField(this.fields.x, this.offset[0], ctx);
      setField(this.fields.y, this.offset[1], ctx);
      setField(this.fields.z, this.offset[2], ctx);
    }
    if (this.angleField) setField(this.angleField, this.spinAngle, this.app.unitContext());
  }

  get edited(): boolean {
    return !!this.offset.some((v) => Math.abs(v) > 1e-9) || Math.abs(this.spinAngle) > 1e-9;
  }

  cancel(): void {
    this.endBatch(false);
  }

  ok(): boolean {
    this.endBatch(true);
    return true;
  }

  dispose(): void {
    if (this.app.viewport.tool === this) this.app.viewport.tool = null;
    this.app.visualJointId = null;
    this.app.showGizmo = false;
    this.app.gizmoAxis = null;
    this.app.gizmoRing = null;
    this.app.setStatus(tr("Ready"));
    this.app.viewport.drawReferenceGeometry();
    this.endBatch(false);
  }
}

/** A component's start position, used as the pivot of its rotation. */
const startedPivot = (start: ComponentTransform): Vec3 => [...start.position];

/** Writes a value into a number field without firing its change handler. */
function setField(field: HTMLElement, value: number, ctx: ReturnType<App['unitContext']>) {
  const input = field.querySelector<HTMLInputElement>('input');
  if (input && document.activeElement !== input) input.value = String(Math.round(value * 1000) / 1000);
  void ctx;
}

/** Distance from a point to a screen-space segment. */
function screenSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
