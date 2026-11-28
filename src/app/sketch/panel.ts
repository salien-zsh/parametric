// PropertyManager shown while editing a sketch: definition status, active
// tool options, and the constraints of the selected entities (with buttons
// to add the constraints that apply to the selection, model edges and
// vertices included).

import type { SkDimension } from '../../model/types';
import { isDimension } from '../../model/types';
import { ORIGIN_ID } from '../../sketch/geom';
import { RELATION_LABELS, relationsOf } from '../../sketch/ops';
import { unlinkExternal } from '../../sketch/external';
import { isTargetItem } from './editor';
import { h } from '../../ui/dom';
import { icon, relationGlyph } from '../../ui/icons';
import type { App } from '../app';
import type { SolveResult } from '../../sketch/solver';
import { PropertyPanel, checkbox, numberField, section } from '../pm';
import { tr } from '../../i18n';

const ENTITY_LABELS: Record<string, string> = { point: tr("Point"), line: tr("Line"), circle: tr("Circle"), arc: tr("Arc"), spline: tr("Spline") };

export function sketchDefinitionStatus(st: SolveResult): HTMLElement {
  const cls = st.status === 'over' ? 'error' : st.status === 'full' ? 'info' : '';
  // A redundant relation repeats what others already fix and the sketch still
  // solves; only a conflicting one cannot be met. Saying which keeps a
  // harmless duplicate from reading as a contradiction.
  const conflicts = st.conflicting.size;
  const redundant = [...st.badConstraints].filter((id) => !st.conflicting.has(id)).length;
  const text = st.status === 'over'
    ? conflicts && redundant
      ? `Over defined: ${conflicts} constraint(s) or dimension(s) conflict and ${redundant} are redundant. Delete them or make dimensions driven (shown in red).`
      : conflicts
        ? `Over defined: ${conflicts} constraint(s) or dimension(s) conflict. Delete them or make dimensions driven (shown in red).`
        : `Over defined: ${redundant} constraint(s) or dimension(s) are redundant, already fixed by others. Delete them or make dimensions driven (shown in red).`
    : st.status === 'full' ? tr("Fully defined.") : `Under defined: ${st.dof} degree(s) of freedom remain. Add dimensions or constraints (blue geometry can still move).`;
  return h('div', { class: `pm-msg sketch-definition ${cls}`, role: 'status' }, text);
}

export class SketchPanel extends PropertyPanel {
  title: string;
  confirm = false;

  constructor(private app: App) {
    super();
    const ed = app.sketchEditor!;
    this.title = ed.tool ? ed.tool.label : ed.sketch.name;
    this.icon = ed.tool ? ed.tool.id : 'sketch';
    this.closeLabel = tr("Exit Sketch");
    this.onCloseClick = () => app.exitSketch(true);
  }

  ok() {
    return true;
  }

  render(): HTMLElement[] {
    const app = this.app;
    const ed = app.sketchEditor!;
    const sk = ed.sketch;
    const out: HTMLElement[] = [];
    const st = ed.solve;
    if (st) out.push(sketchDefinitionStatus(st));
    if (ed.tool?.options) {
      const options = section(`${ed.tool.label} Options`, ed.tool.options());
      options.classList.add('sketch-tool-options');
      out.push(options);
    }
    if (ed.tool) out.push(h('div', { class: 'pm-msg' }, ed.tool.hint));

    const ids = ed.selectedIds(['sk']);
    const dims = ed.selectedIds(['skdim']).map((id) => sk.constraints.find((c) => c.id === id)).filter((c): c is SkDimension => !!c && isDimension(c));
    const targets = app.selection.items.filter(isTargetItem);
    if (targets.length) {
      const names = targets.map((it) => {
        if (it.kind === 'edge') return tr("Model edge");
        if (it.kind === 'vertex') return tr("Model vertex");
        if (it.id === ORIGIN_ID) return tr("Origin");
        const e = sk.entities.find((x) => x.id === it.id);
        return `${ENTITY_LABELS[e?.t ?? 'point']} ${it.id}${e?.ext ? tr(" (projected)") : ''}`;
      });
      out.push(section(tr("Selected Entities"), [h('div', { class: 'selbox' }, names.map((n) => h('div', { class: 'item' }, n)))]));
      const rels = ids.length ? relationsOf(sk, ids) : [];
      const existing = h('div', { class: 'relations-list' });
      const linked = sk.entities.filter((e) => e.ext && ids.includes(e.id));
      for (const e of linked) {
        const lost = ed.lostExternal.has(e.id);
        const label = lost ? tr("Projected: model edge not found") : e.ext!.kind === 'vertex' ? tr("Projected from a model vertex") : tr("Projected from a model edge");
        const unlink = h('button', { class: 'btn small', type: 'button', title: tr("Keep this geometry where it is, no longer linked to the model") }, tr("Unlink"));
        unlink.addEventListener('click', () => ed.edit(tr('Unlink projected geometry'), (s2, newId) => { unlinkExternal(s2, [e.id], newId); }));
        existing.append(h('div', { class: 'rel-btn', style: { cursor: 'default', color: lost ? 'var(--danger)' : '' } },
          icon('convertEntities', 16), h('span', { class: 'grow' }, label), unlink));
      }
      if (!rels.length && !linked.length) existing.append(h('div', { class: 'field-label' }, ids.length ? tr("No constraints") : tr("Not in the sketch yet: adding a constraint projects it, linked to the model.")));
      for (const r of rels) {
        const label = isDimension(r) ? `${r.name} (${r.type})${r.driven ? ', driven' : ''}` : `${RELATION_LABELS[r.type]}${st?.conflicting.has(r.id) ? tr(" (conflict)") : st?.badConstraints.has(r.id) ? tr(" (redundant)") : ''}`;
        const del = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${label}` }, icon('trash', 14));
        del.addEventListener('click', () => ed.edit('Delete constraint', (s2) => { s2.constraints = s2.constraints.filter((c) => c.id !== r.id); }));
        existing.append(h('div', { class: 'rel-btn', style: { cursor: 'default', color: st?.badConstraints.has(r.id) ? 'var(--danger)' : '' } },
          isDimension(r) ? icon('smartDimension', 16) : relationGlyph(r.type, 14), h('span', { class: 'grow' }, label), del));
      }
      out.push(section(tr("Existing Constraints"), [existing]));
      const avail = ed.selectionRelations();
      if (avail.length) {
        const list = h('div', { class: 'relations-list' });
        for (const t of avail) {
          const b = h('button', { class: 'rel-btn', type: 'button' }, relationGlyph(t, 14), RELATION_LABELS[t]);
          b.addEventListener('click', () => ed.addRelation(t, targets));
          list.append(b);
        }
        out.push(section(tr("Add Constraints"), [list]));
      }
      const curves = ids.map((id) => sk.entities.find((e) => e.id === id)).filter((e) => e && e.t !== 'point');
      if (curves.length) {
        out.push(section(tr("Options"), [checkbox(tr("For construction"), curves.every((c) => c!.construction), () => ed.toggleConstruction())]));
      }
    } else if (dims.length === 1) {
      const d = dims[0];
      out.push(section(`Dimension ${d.name}`, [
        d.driven ? h('div', { class: 'field-label' }, tr("Driven (reference) dimension")) : h('div', { class: 'sketch-dimension-field' }, numberField({
          label: tr("Value"), value: d.value, kind: d.type === 'angle' ? 'angle' : 'length', ctx: app.unitContext(),
          // Like the Modify box: lengths must be positive (a negative one over-defines the sketch).
          min: d.type === 'angle' ? 0 : 1e-6,
          // The angle between two lines is 0 to 180 degrees (the label side picks the sector).
          max: d.type === 'angle' ? 180 : undefined,
          onChange: (v) => {
            // Removing a focused field can emit change before detaching it.
            // The field must still own this dimension, not a deleted or replaced one.
            if (!ed.sketch?.constraints.includes(d)) return;
            ed.edit(tr("Change dimension"), (s2) => { (s2.constraints.find((c) => c.id === d.id) as SkDimension).value = v; }, { keepNumberField: true });
          },
        })),
        checkbox(tr("Driven (reference only)"), !!d.driven, (v) => ed.setDriven(d.id, v)),
      ]));
    } else if (!ed.tool) {
      const counts = new Map<string, number>();
      for (const e of sk.entities) counts.set(e.t, (counts.get(e.t) ?? 0) + 1);
      const summary = [...counts].filter(([t]) => t !== 'point').map(([t, n]) => `${n} ${ENTITY_LABELS[t].toLowerCase()}${n > 1 ? 's' : ''}`).join(', ') || tr("Empty sketch");
      out.push(section(tr("Sketch"), [
        h('div', { class: 'field-label' }, summary),
        h('div', { class: 'field-label' }, `${sk.constraints.filter((c) => !isDimension(c)).length} constraints, ${sk.constraints.filter(isDimension).length} dimensions`),
        h('p', { class: 'field-label' }, tr("Pick a constraint in the Constrain group of the Sketch tab, then click the geometry it applies to. Or select geometry first (Shift-click to add model edges and vertices) to see the constraints that fit. Drag geometry to see how it is constrained. Double-click a dimension to change it.")),
      ]));
    }
    const model = app.selection.items.filter((it) => it.kind === 'edge' || it.kind === 'face' || it.kind === 'vertex').length;
    if (model) out.push(h('div', { class: 'pm-msg info' }, tr('{0} model item(s) selected. Use Convert Entities to project them into this sketch, linked to the model.', [model])));
    const lost = sk.entities.filter((e) => e.ext && ed.lostExternal.has(e.id)).length;
    if (lost) out.push(h('div', { class: 'pm-msg error' }, tr('{0} projected entities (red) lost their model edge and stay where they were. Delete or unlink them, or project the edge again.', [lost])));
    // Fusion-style sketch palette: the plane grid can be shown and snapped to
    // while the sketch is edited.
    // Point magnet strength: Fusion's snap feels stronger or softer per user.
    const snap = h('select', { class: 'input', 'aria-label': tr("Point snap strength") }) as HTMLSelectElement;
    for (const [value, label] of [['weak', tr("Weak")], ['normal', tr("Standard")], ['strong', tr("Strong")]] as const) {
      snap.append(h('option', { value }, label));
    }
    snap.value = app.settings.snapStrength;
    snap.addEventListener('change', () => app.changeSettings({ snapStrength: snap.value as 'weak' | 'normal' | 'strong' }));
    out.push(section(tr("Grid"), [
      checkbox(tr("Show grid"), app.settings.showGrid, (v) => app.changeSettings({ showGrid: v })),
      checkbox(tr("Snap to grid"), app.settings.snapToGrid, (v) => app.changeSettings({ snapToGrid: v })),
      h('div', { class: 'row' }, h('span', { class: 'field-label grow' }, tr("Point snap strength")), h('div', { class: 'grow' }, snap)),
    ]));
    return out;
  }
}

