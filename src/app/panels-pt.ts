// PropertyManager panels for the power-transmission generators: gears, worm
// drives, belt drives and chain sprockets. The geometry is regenerated from
// the fields below; the sizing block only reports the dimensions and forces
// of the current values.

import type {
  BevelGearFeature, SpurGearFeature, SprocketFeature, SyncBeltFeature, VBeltFeature, WormGearFeature,
} from '../model/types';
import {
  PT_MATERIALS, materialById, sizeBevelGear, sizeBelt, sizeSpurGear, sizeSprocket, sizeSyncBelt, sizeWormGear,
} from '../model/pt';
import { formatNumber } from '../model/units';
import { h } from '../ui/dom';
import { BaseFeaturePanel, numberField, section, selectField } from './pm';
import { tr } from '../i18n';

export type TransmissionFeature = SpurGearFeature | BevelGearFeature | WormGearFeature | VBeltFeature | SyncBeltFeature | SprocketFeature;

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Formats a length without trailing zeros. */
const mm = (v: number, dec: number): string => formatNumber(v, dec);

/**
 * Common chrome of a transmission panel: the load block (material, power,
 * speed, service factor), the editable number fields and the sizing message.
 */
abstract class TransmissionPanel<T extends TransmissionFeature> extends BaseFeaturePanel<T> {
  protected statsEl: HTMLElement = h('div', { class: 'pm-msg info', role: 'status' });

  protected get decimals() {
    return this.app.store.doc.decimals;
  }

  /** A length field in document units. */
  protected length(label: string, value: unknown, onChange: (v: number) => void, min = 1e-6): HTMLElement {
    return numberField({
      label, value: typeof value === 'number' ? value : String(value ?? ''), kind: 'length', ctx: this.ctx(), min, allowExpr: false,
      onChange: (v) => { onChange(n(v)); this.syncStats(); this.changed(); },
    });
  }

  /** A count field (teeth, starts, grooves). */
  protected count(label: string, value: unknown, onChange: (v: number) => void, min = 1): HTMLElement {
    return numberField({
      label, value: typeof value === 'number' ? value : String(value ?? ''), kind: 'count', ctx: this.ctx(), min, allowExpr: false,
      onChange: (v) => { onChange(Math.round(n(v))); this.syncStats(); this.changed(); },
    });
  }

  protected angle(label: string, value: unknown, onChange: (v: number) => void): HTMLElement {
    return numberField({
      label, value: typeof value === 'number' ? value : String(value ?? ''), kind: 'angle', ctx: this.ctx(), allowExpr: false,
      onChange: (v) => { onChange(n(v)); this.syncStats(); this.changed(); },
    });
  }

  /** Material and load fields, plus the check message. */
  protected loadSection(): HTMLElement {
    const f = this.f;
    const material = selectField(tr("Material"), f.material, PT_MATERIALS.map((m) => ({ value: m.id, label: m.name })), (v) => {
      f.material = v;
      this.syncStats();
      this.changed();
    });
    const power = numberField({
      label: tr("Power (kW)"), value: f.power, kind: 'count', ctx: this.ctx(), min: 1e-6, allowExpr: false,
      onChange: (v) => { f.power = n(v); this.syncStats(); this.changed(); },
    });
    const speed = numberField({
      label: tr("Speed (rpm)"), value: f.speed, kind: 'count', ctx: this.ctx(), min: 1e-6, allowExpr: false,
      onChange: (v) => { f.speed = n(v); this.syncStats(); this.changed(); },
    });
    const k = numberField({
      label: tr("Service factor"), value: f.serviceFactor, kind: 'count', ctx: this.ctx(), min: 1e-6, allowExpr: false,
      onChange: (v) => { f.serviceFactor = n(v); this.syncStats(); this.changed(); },
    });
    return section(tr("Loads"), [material, power, speed, k, this.statsEl]);
  }

  /** Text of the sizing block for the current values. */
  protected abstract check(): { text: string; ok: boolean } | null;

  protected syncStats() {
    const result = this.check();
    if (!result) {
      this.statsEl.className = 'pm-msg warn';
      this.statsEl.textContent = tr("Enter positive dimensions and loads to size this transmission.");
      return;
    }
    this.statsEl.className = `pm-msg ${result.ok ? 'info' : 'error'}`;
    this.statsEl.textContent = result.text;
  }

  /** True when a boolean field was toggled: redraws so its fields show. */
  protected redraw() {
    this.app.refreshPanel();
    this.changed();
  }
}

// ---------- spur gear ----------

export class SpurGearPanel extends TransmissionPanel<SpurGearFeature> {
  get title() {
    return this.editingId ? this.f.name : tr("Spur Gear");
  }

  render(): HTMLElement[] {
    const f = this.f;
    const design = section(tr("Gear"), [
      this.length(tr("Module"), f.module, (v) => { f.module = v; }),
      this.count(tr("Teeth"), f.teeth, (v) => { f.teeth = v; }),
      this.angle(tr("Pressure angle"), f.pressureAngle, (v) => { f.pressureAngle = v; }),
      this.length(tr("Face width"), f.faceWidth, (v) => { f.faceWidth = v; }),
      this.length(tr("Bore diameter"), f.bore, (v) => { f.bore = v; }, 0),
    ]);
    const hub = section(tr("Hub"), [
      this.length(tr("Hub diameter"), f.hubDiameter, (v) => { f.hubDiameter = v; }, 0),
      this.length(tr("Hub length"), f.hubLength, (v) => { f.hubLength = v; }, 0),
    ], { collapsed: !(n(f.hubDiameter) > 0) });
    this.syncStats();
    return [design, hub, this.loadSection()];
  }

  protected check() {
    const f = this.f;
    const s = sizeSpurGear(n(f.module), n(f.teeth), n(f.pressureAngle), n(f.faceWidth), n(f.power), n(f.speed), n(f.serviceFactor),
      materialById(f.material).allowableBending);
    if (!s) return null;
    return {
      ok: s.utilization <= 1,
      text: tr("Pitch diameter {0} mm, outer {1} mm, base {2} mm. Tangential force {3} N at {4} m/s; tooth bending {5} MPa ({6}% of allowable).", [
        mm(s.pitchDiameter, this.decimals), mm(s.outerDiameter, this.decimals), mm(s.baseDiameter, this.decimals),
        mm(s.tangentialForce, 0), mm(s.velocity, 2), mm(s.bendingStress, this.decimals), mm(s.utilization * 100, 0),
      ]),
    };
  }

  protected validate() {
    const f = this.f;
    if (!(n(f.module) > 0)) return tr("The module must be greater than zero");
    if (!(n(f.teeth) >= 5 && n(f.teeth) <= 120)) return tr("Teeth must be between 5 and 120");
    if (!(n(f.faceWidth) > 0)) return tr("The face width must be greater than zero");
    if (n(f.hubDiameter) > 0 && !(n(f.hubLength) > 0)) return tr("The hub length must be greater than zero");
    if (n(f.hubDiameter) > 0 && n(f.hubDiameter) <= n(f.bore)) return tr("The hub diameter must be larger than the bore");
    return null;
  }
}

// ---------- bevel gear ----------

export class BevelGearPanel extends TransmissionPanel<BevelGearFeature> {
  get title() {
    return this.editingId ? this.f.name : tr("Bevel Gear");
  }

  render(): HTMLElement[] {
    const f = this.f;
    const design = section(tr("Gear"), [
      this.length(tr("Module"), f.module, (v) => { f.module = v; }),
      this.count(tr("Teeth"), f.teeth, (v) => { f.teeth = v; }),
      this.count(tr("Mating teeth"), f.mateTeeth, (v) => { f.mateTeeth = v; }),
      this.angle(tr("Pressure angle"), f.pressureAngle, (v) => { f.pressureAngle = v; }),
      this.length(tr("Face width"), f.faceWidth, (v) => { f.faceWidth = v; }),
      this.length(tr("Bore diameter"), f.bore, (v) => { f.bore = v; }, 0),
    ]);
    this.syncStats();
    return [design, this.loadSection()];
  }

  protected check() {
    const f = this.f;
    const s = sizeBevelGear(n(f.module), n(f.teeth), n(f.mateTeeth), n(f.faceWidth), n(f.pressureAngle), n(f.power), n(f.speed),
      n(f.serviceFactor), materialById(f.material).allowableBending);
    if (!s) return null;
    return {
      ok: s.utilization <= 1 && n(f.faceWidth) <= s.maxFaceWidth + 1e-9,
      text: tr("Pitch cone {0}°, cone distance {1} mm, ratio {2}:1. Mean pitch diameter {3} mm, tangential force {4} N; tooth bending {5} MPa ({6}% of allowable).", [
        mm(s.coneAngle, 1), mm(s.coneDistance, this.decimals), mm(s.ratio, 2), mm(s.meanPitchDiameter, this.decimals),
        mm(s.tangentialForce, 0), mm(s.bendingStress, this.decimals), mm(s.utilization * 100, 0),
      ]),
    };
  }

  protected validate() {
    const f = this.f;
    if (!(n(f.module) > 0)) return tr("The module must be greater than zero");
    if (!(n(f.teeth) >= 5 && n(f.teeth) <= 100) || !(n(f.mateTeeth) >= 5 && n(f.mateTeeth) <= 100)) return tr("Teeth must be between 5 and 100");
    if (!(n(f.faceWidth) > 0)) return tr("The face width must be greater than zero");
    const coneDistance = (n(f.module) / 2) * Math.hypot(n(f.teeth), n(f.mateTeeth));
    if (n(f.faceWidth) > coneDistance / 3) return tr("The face width cannot be more than a third of the cone distance");
    return null;
  }
}

// ---------- worm gear ----------

export class WormGearPanel extends TransmissionPanel<WormGearFeature> {
  get title() {
    return this.editingId ? this.f.name : tr("Worm Gear");
  }

  render(): HTMLElement[] {
    const f = this.f;
    const design = section(tr("Worm and Wheel"), [
      this.length(tr("Module"), f.module, (v) => { f.module = v; }),
      this.count(tr("Worm starts"), f.wormStarts, (v) => { f.wormStarts = v; }),
      this.count(tr("Wheel teeth"), f.wheelTeeth, (v) => { f.wheelTeeth = v; }),
      this.length(tr("Worm diameter"), f.wormDiameter, (v) => { f.wormDiameter = v; }),
      this.length(tr("Worm length"), f.wormLength, (v) => { f.wormLength = v; }),
      this.length(tr("Face width"), f.faceWidth, (v) => { f.faceWidth = v; }),
      this.length(tr("Bore diameter"), f.bore, (v) => { f.bore = v; }, 0),
    ]);
    this.syncStats();
    return [design, this.loadSection()];
  }

  protected check() {
    const f = this.f;
    const s = sizeWormGear(n(f.module), n(f.wormStarts), n(f.wheelTeeth), n(f.wormDiameter), n(f.wormLength), n(f.faceWidth),
      n(f.power), n(f.speed), n(f.serviceFactor));
    if (!s) return null;
    return {
      ok: s.leadAngle >= 2 && s.leadAngle <= 45,
      text: tr("Ratio {0}:1, lead angle {1}°, centre distance {2} mm. Sliding speed {3} m/s; wheel torque {4} N·m.", [
        mm(s.ratio, 2), mm(s.leadAngle, 2), mm(s.centerDistance, this.decimals), mm(s.slidingSpeed, 2), mm(s.wheelTorque, 1),
      ]),
    };
  }

  protected validate() {
    const f = this.f;
    if (!(n(f.module) > 0)) return tr("The module must be greater than zero");
    if (!(n(f.wormStarts) >= 1 && n(f.wormStarts) <= 4)) return tr("The worm must have 1 to 4 starts");
    if (!(n(f.wheelTeeth) >= 8 && n(f.wheelTeeth) <= 120)) return tr("The wheel teeth must be between 8 and 120");
    if (!(n(f.wormDiameter) > 0)) return tr("The worm diameter must be greater than zero");
    if (!(n(f.wormLength) >= 2 * Math.PI * n(f.module))) return tr("The worm length must cover at least one turn of thread");
    return null;
  }
}

// ---------- V-belt ----------

export class VBeltPanel extends TransmissionPanel<VBeltFeature> {
  get title() {
    return this.editingId ? this.f.name : tr("V-Belt Drive");
  }

  render(): HTMLElement[] {
    const f = this.f;
    const design = section(tr("Pulleys"), [
      this.length(tr("Pulley 1 diameter"), f.pulley1, (v) => { f.pulley1 = v; }),
      this.length(tr("Pulley 2 diameter"), f.pulley2, (v) => { f.pulley2 = v; }),
      this.length(tr("Center distance"), f.centerDistance, (v) => { f.centerDistance = v; }),
    ]);
    const belt = section(tr("Belt"), [
      this.length(tr("Belt width"), f.beltWidth, (v) => { f.beltWidth = v; }),
      this.length(tr("Belt thickness"), f.beltThickness, (v) => { f.beltThickness = v; }),
      this.count(tr("Grooves"), f.grooves, (v) => { f.grooves = v; }),
    ]);
    this.syncStats();
    return [design, belt, this.loadSection()];
  }

  protected check() {
    const f = this.f;
    const s = sizeBelt(n(f.pulley1), n(f.pulley2), n(f.centerDistance), n(f.beltWidth), n(f.beltThickness), n(f.power), n(f.speed), n(f.serviceFactor));
    if (!s) return null;
    return {
      ok: s.wrap1 >= 120,
      text: tr("Ratio {0}:1, belt length {1} mm, wrap angle {2}° on the small pulley. Belt speed {3} m/s, design torque {4} N·m.", [
        mm(s.ratio, 2), mm(s.length, this.decimals), mm(s.wrap1, 1), mm(s.beltSpeed, 2), mm(s.designTorque, 1),
      ]),
    };
  }

  protected validate() {
    const f = this.f;
    if (!(n(f.pulley1) > 0) || !(n(f.pulley2) > 0)) return tr("Pulley diameters must be greater than zero");
    if (!(n(f.centerDistance) > (n(f.pulley1) + n(f.pulley2)) / 2)) return tr("The centre distance must clear both pulleys");
    if (!(n(f.beltWidth) > 0) || !(n(f.beltThickness) > 0)) return tr("The belt width and thickness must be greater than zero");
    if (!(n(f.grooves) >= 1 && n(f.grooves) <= 12)) return tr("The groove count must be between 1 and 12");
    return null;
  }
}

// ---------- synchronous belt ----------

export class SyncBeltPanel extends TransmissionPanel<SyncBeltFeature> {
  get title() {
    return this.editingId ? this.f.name : tr("Synchronous Belt");
  }

  render(): HTMLElement[] {
    const f = this.f;
    const design = section(tr("Pulleys"), [
      this.length(tr("Tooth pitch"), f.toothPitch, (v) => { f.toothPitch = v; }),
      this.count(tr("Pulley 1 teeth"), f.pulley1, (v) => { f.pulley1 = v; }),
      this.count(tr("Pulley 2 teeth"), f.pulley2, (v) => { f.pulley2 = v; }),
      this.length(tr("Center distance"), f.centerDistance, (v) => { f.centerDistance = v; }),
    ]);
    const belt = section(tr("Belt"), [
      this.length(tr("Belt width"), f.beltWidth, (v) => { f.beltWidth = v; }),
      this.length(tr("Belt thickness"), f.beltThickness, (v) => { f.beltThickness = v; }),
    ]);
    this.syncStats();
    return [design, belt, this.loadSection()];
  }

  protected check() {
    const f = this.f;
    const s = sizeSyncBelt(n(f.toothPitch), n(f.pulley1), n(f.pulley2), n(f.centerDistance), n(f.beltWidth), n(f.beltThickness),
      n(f.power), n(f.speed), n(f.serviceFactor));
    if (!s) return null;
    return {
      ok: s.teethInMesh >= 6,
      text: tr("Pitch diameters {0} / {1} mm, ratio {2}:1. Belt length {3} mm ({4} teeth), {5} teeth in mesh. Belt speed {6} m/s.", [
        mm(s.pitch1, this.decimals), mm(s.pitch2, this.decimals), mm(s.ratio, 2), mm(s.length, this.decimals),
        String(s.beltTeeth), String(s.teethInMesh), mm(s.beltSpeed, 2),
      ]),
    };
  }

  protected validate() {
    const f = this.f;
    if (!(n(f.toothPitch) > 0)) return tr("The tooth pitch must be greater than zero");
    if (!(n(f.pulley1) >= 8 && n(f.pulley2) >= 8)) return tr("Synchronous pulleys need at least 8 teeth");
    const p1 = (n(f.toothPitch) * n(f.pulley1)) / Math.PI;
    const p2 = (n(f.toothPitch) * n(f.pulley2)) / Math.PI;
    if (!(n(f.centerDistance) > (p1 + p2) / 2)) return tr("The centre distance must clear both pulleys");
    return null;
  }
}

// ---------- sprocket ----------

export class SprocketPanel extends TransmissionPanel<SprocketFeature> {
  get title() {
    return this.editingId ? this.f.name : tr("Sprocket");
  }

  render(): HTMLElement[] {
    const f = this.f;
    const design = section(tr("Sprocket"), [
      this.length(tr("Chain pitch"), f.pitch, (v) => { f.pitch = v; }),
      this.count(tr("Teeth"), f.teeth, (v) => { f.teeth = v; }),
      this.length(tr("Roller diameter"), f.rollerDiameter, (v) => { f.rollerDiameter = v; }),
      this.length(tr("Tooth width"), f.toothWidth, (v) => { f.toothWidth = v; }),
      this.length(tr("Bore diameter"), f.bore, (v) => { f.bore = v; }, 0),
    ]);
    const hub = section(tr("Hub"), [
      this.length(tr("Hub diameter"), f.hubDiameter, (v) => { f.hubDiameter = v; }, 0),
      this.length(tr("Hub length"), f.hubLength, (v) => { f.hubLength = v; }, 0),
    ], { collapsed: !(n(f.hubDiameter) > 0) });
    this.syncStats();
    return [design, hub, this.loadSection()];
  }

  protected check() {
    const f = this.f;
    const s = sizeSprocket(n(f.pitch), n(f.teeth), n(f.rollerDiameter), n(f.power), n(f.speed), n(f.serviceFactor));
    if (!s) return null;
    return {
      ok: s.chainSpeed <= 15,
      text: tr("Pitch diameter {0} mm, outer {1} mm, root {2} mm. Chain speed {3} m/s, tangential force {4} N.", [
        mm(s.pitchDiameter, this.decimals), mm(s.outerDiameter, this.decimals), mm(s.rootDiameter, this.decimals),
        mm(s.chainSpeed, 2), mm(s.tangentialForce, 0),
      ]),
    };
  }

  protected validate() {
    const f = this.f;
    if (!(n(f.pitch) > 0)) return tr("The chain pitch must be greater than zero");
    if (!(n(f.teeth) >= 6 && n(f.teeth) <= 120)) return tr("Teeth must be between 6 and 120");
    if (!(n(f.rollerDiameter) > 0) || !(n(f.rollerDiameter) < n(f.pitch))) return tr("The roller diameter must be smaller than the chain pitch");
    if (!(n(f.toothWidth) >= n(f.rollerDiameter) * 0.5)) return tr("The tooth width must be at least half the roller diameter");
    if (n(f.hubDiameter) > 0 && !(n(f.hubLength) > 0)) return tr("The hub length must be greater than zero");
    return null;
  }
}


