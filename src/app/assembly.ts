// Assembly component properties: transform, visibility and name.

import { connectorAxis, movableJoints } from '../model/assembly';
import type { AssemblyAxis, AssemblyJoint, AssemblyJointType, AssemblyMate, AssemblyMateType, ComponentTransform, Id } from '../model/types';
import { h } from '../ui/dom';
import { tr } from '../i18n';
import type { App } from './app';
import { PropertyPanel, checkbox, numberField, section, selectField } from './pm';

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

export class AssemblyJointPanel extends PropertyPanel {
  readonly title: string;
  icon = 'revolve';
  editingId: Id | null;
  private draft: AssemblyJoint;
  private readonly original: string;

  constructor(private app: App, joint?: AssemblyJoint) {
    super();
    if (joint) {
      this.draft = structuredClone(joint);
      this.editingId = joint.id;
      this.title = tr("Edit Joint");
    } else {
      const component = app.selection.ofKind('component')[0];
      if (!component) throw new Error(tr("Select one component to add a joint."));
      this.draft = {
        id: app.store.nextId('j'),
        name: tr("Joint{0}", [app.store.doc.joints?.length ? (app.store.doc.joints.length + 1) : 1]),
        type: 'revolute',
        component: component.id,
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

  private changed() {
    this.app.commands.changed();
  }

  render(): HTMLElement[] {
    const d = this.draft;
    const primaryAngle = d.type === 'revolute' || d.type === 'ball';
    const secondaryAngle = jointSecondaryAngle(d.type);
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
    const axis = selectField<AssemblyAxis>(tr("Axis"), d.axis, [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ], (value) => { d.axis = value; this.changed(); });
    const axis2 = selectField<AssemblyAxis>(tr("Secondary axis"), d.axis2 ?? 'y', [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ], (value) => { d.axis2 = value; this.changed(); });
    const ctx = this.app.unitContext();
    const value = numberField({ label: tr("Current value"), value: d.value, kind: primaryAngle ? 'angle' : 'length', ctx, onChange: (v) => { if (typeof v === 'number') d.value = v; this.changed(); } });
    const min = numberField({ label: tr("Minimum"), value: d.min, kind: primaryAngle ? 'angle' : 'length', ctx, onChange: (v) => { if (typeof v === 'number') d.min = v; this.changed(); } });
    const max = numberField({ label: tr("Maximum"), value: d.max, kind: primaryAngle ? 'angle' : 'length', ctx, onChange: (v) => { if (typeof v === 'number') d.max = v; this.changed(); } });
    const value2 = numberField({ label: tr("Secondary value"), value: d.value2 ?? 0, kind: secondaryAngle ? 'angle' : 'length', ctx, onChange: (v) => { if (typeof v === 'number') d.value2 = v; this.changed(); } });
    const min2 = numberField({ label: tr("Secondary minimum"), value: d.min2 ?? -180, kind: secondaryAngle ? 'angle' : 'length', ctx, onChange: (v) => { if (typeof v === 'number') d.min2 = v; this.changed(); } });
    const max2 = numberField({ label: tr("Secondary maximum"), value: d.max2 ?? 180, kind: secondaryAngle ? 'angle' : 'length', ctx, onChange: (v) => { if (typeof v === 'number') d.max2 = v; this.changed(); } });
    const secondary = section(tr("Secondary motion"), [axis2, value2, min2, max2]);
    secondary.hidden = !jointHasSecondary(d.type);
    const primary = section(tr("Motion"), [value, min, max]);
    primary.hidden = d.type === 'rigid';
    return [
      section(tr("Joint"), [
        h('div', { class: 'field-label' }, tr("Joint name")), name,
        h('p', { class: 'field-label' }, tr("Component: {0}", [this.app.component(d.component)?.name ?? d.component])),
        type, axis,
      ]),
      primary, secondary,
    ];
  }

  get edited(): boolean {
    return this.original !== JSON.stringify(this.draft);
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
    if (this.editingId) this.app.replaceJoint(this.draft);
    else this.app.addJoint(this.draft);
    return true;
  }
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
