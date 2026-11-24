// Command definitions and where they appear: CommandManager tabs, menus,
// context menus and the selection quick-action toolbar.

import type { AxisKind, Feature, Id, PlaneKind, PointKind, SkDimension } from '../model/types';
import { isDimension } from '../model/types';
import { consumedSketches } from '../model/features';
import { VIEWS, type ViewName } from '../render/camera';
import type { DisplayStyle } from '../render/renderer';
import { UNIT_SYSTEMS, formatLength } from '../model/units';
import { assemblyDiagnostics } from '../model/assembly';
import { setThemeChoice, getThemeChoice } from '../platform/theme';
import type { MenuItem } from '../ui/menu';
import { showDialog, toast } from '../ui/overlay';
import { REPO_URL, type RibbonTab } from './shell';
import type { App, AppHooks } from './app';
import type { Command } from './commands';
import { panelFor, startFeature } from './panels';
import { SketchPanel } from './sketch/panel';
import {
  MeasurePanel, OffsetPanel, SectionPanel, aboutDialog, convertEntities, equationsDialog, massPropertiesDialog, materialDialog,
  mirrorSketchEntities, optionsDialog, propertiesDialog, shortcutsDialog,
} from './dialogs';
import type { FileOps } from './fileops';
import { shareDialog } from './share';
import { PropertyPanel, section } from './pm';
import type { SketchEditor, SkTool } from './sketch/editor';
import {
  centerArcTool, circleTool, dimensionTool, extendTool, lineTool, perimeterCircleTool, pointTool, polygonTool, rectangleTool, threePointRectangleTool,
  sketchFilletTool, slotTool, splineTool, tangentArcTool, threePointArcTool, trimTool,
} from './sketch/tools';
import { h } from '../ui/dom';
import type { PlaneRef } from '../model/types';
import { RELATION_LABELS } from '../sketch/ops';
import { CONSTRAINTS, CONSTRAINT_HINTS, runConstraint } from './sketch/constrain';
import { configurationsDialog, projectManagerDialog, publishCurrentPart, resourceCenterDialog } from './workspace-dialogs';
import { tr } from '../i18n';

const SKETCH_TOOLS: Record<string, { label: string; shortcut?: string; desc: string; make: (ed: SketchEditor) => SkTool }> = {
  line: { label: tr("Line"), shortcut: 'L', desc: tr("Sketch straight lines."), make: (ed) => lineTool(ed) },
  centerline: { label: tr("Centerline"), desc: tr("Sketch construction lines used as axes and for symmetry."), make: (ed) => lineTool(ed, true) },
  rectangle: { label: tr("Corner Rectangle"), shortcut: 'R', desc: tr("Sketch a rectangle from two corners."), make: (ed) => rectangleTool(ed) },
  centerRectangle: { label: tr("Center Rectangle"), desc: tr("Sketch a rectangle from its centre."), make: (ed) => rectangleTool(ed, true) },
  rectangle3Point: { label: tr("Three Point Rectangle"), desc: tr("Sketch a rectangle from one edge and its width."), make: (ed) => threePointRectangleTool(ed) },
  circle: { label: tr("Circle"), shortcut: 'C', desc: tr("Sketch a circle from its centre and radius."), make: (ed) => circleTool(ed) },
  perimeterCircle: { label: tr("Perimeter Circle"), desc: tr("Sketch a circle through three points."), make: (ed) => perimeterCircleTool(ed) },
  centerArc: { label: tr("Centerpoint Arc"), desc: tr("Sketch an arc from its centre, start and end."), make: (ed) => centerArcTool(ed) },
  tangentArc: { label: tr("Tangent Arc"), shortcut: 'A', desc: tr("Sketch an arc tangent to the end of a line or arc."), make: (ed) => tangentArcTool(ed) },
  arc3: { label: tr("3 Point Arc"), desc: tr("Sketch an arc through its ends and a point on it."), make: (ed) => threePointArcTool(ed) },
  polygon: { label: tr("Polygon"), desc: tr("Sketch a regular polygon."), make: (ed) => polygonTool(ed) },
  slot: { label: tr("Straight Slot"), desc: tr("Sketch a slot with rounded ends."), make: (ed) => slotTool(ed) },
  slotOverall: { label: tr("Overall Slot"), desc: tr("Sketch a slot from its two overall ends."), make: (ed) => slotTool(ed, 'overall') },
  slotCenter: { label: tr("Center Point Slot"), desc: tr("Sketch a slot from its centre and one end."), make: (ed) => slotTool(ed, 'center') },
  spline: { label: tr("Spline"), desc: tr("Sketch a smooth curve through points."), make: (ed) => splineTool(ed) },
  point: { label: tr("Point"), desc: tr("Sketch points, for example to place holes."), make: (ed) => pointTool(ed) },
  smartDimension: { label: tr("Smart Dimension"), shortcut: 'D', desc: tr("Add a dimension; its type depends on what you select and where you place it."), make: (ed) => dimensionTool(ed) },
  sketchFillet: { label: tr("Sketch Fillet"), desc: tr("Round the corner between two lines."), make: (ed) => sketchFilletTool(ed) },
  trim: { label: tr("Trim Entities"), shortcut: 'T', desc: tr("Remove parts of curves up to their intersections."), make: (ed) => trimTool(ed) },
  extend: { label: tr("Extend Entities"), desc: tr("Extend a line to the next curve."), make: (ed) => extendTool(ed) },
};

export function registerCommands(app: App, files: FileOps) {
  const c = app.commands;
  const inSketch = () => !!app.sketchEditor;
  const noModes = () => !app.panel;
  const hasBody = () => !!app.bbox;
  const isPart = () => !app.isAssembly;
  // A feature panel holds a copy of its feature: OK after a Redo would write
  // that copy back over the redone change, so the panel is cancelled first.
  const redo = () => { if (app.panel?.preview()) void app.closePanel(false); app.store.redo(); };
  const feature = (type: Feature['type'], label: string, iconName: string, desc: string, opts: { cut?: boolean; needsBody?: boolean; shortcut?: string; keywords?: string; id?: string; planeKind?: PlaneKind; axisKind?: AxisKind; pointKind?: PointKind } = {}): Command => ({
    id: opts.id ?? (opts.cut ? `${type}Cut` : type),
    label,
    icon: iconName,
    description: desc,
    shortcut: opts.shortcut,
    keywords: opts.keywords,
    enabled: () => isPart() && (!opts.needsBody || hasBody()),
    run: () => {
      if (app.sketchEditor) {
        // Finish the sketch first; it becomes the profile.
        const id = app.sketchEditor.sketchId;
        app.exitSketch(true);
        app.selection.set([{ kind: 'feature', id }]);
      }
      const needsSketch = (type === 'extrude' || type === 'revolve') && !hasUsableSketch(app);
      if (needsSketch) {
        // No profile yet: sketch first, then continue with this command.
        app.pendingAfterSketch = opts.cut ? `${type}Cut` : type;
        void c.run('sketch');
        return;
      }
      const p = startFeature(app, type, { cut: opts.cut, planeKind: opts.planeKind, axisKind: opts.axisKind, pointKind: opts.pointKind });
      if (p) void app.openPanel(p);
    },
  });

  const view = (name: ViewName, label: string, iconName: string, shortcut?: string): Command => ({
    id: `view${name[0].toUpperCase()}${name.slice(1)}`, label, icon: iconName, shortcut, keywords: tr("view orientation standard"),
    run: () => app.viewport.setView(name),
  });

  const style = (s: DisplayStyle, label: string, iconName: string): Command => ({
    id: `style:${s}`, label, icon: iconName, keywords: tr("display style render"),
    checked: () => app.renderer.displayStyle === s,
    run: () => { app.renderer.displayStyle = s; app.renderer.requestRender(); c.changed(); },
  });

  const toggle = (id: string, label: string, get: () => boolean, set: (v: boolean) => void, desc?: string): Command => ({
    id, label, description: desc, keywords: tr("show hide visibility"),
    checked: get,
    run: () => { set(!get()); app.saveSettings(); },
  });

  const tool = (id: string): Command => {
    const t = SKETCH_TOOLS[id];
    return {
      id: `tool:${id}`, label: t.label, icon: id === 'smartDimension' ? 'smartDimension' : id, shortcut: t.shortcut, description: t.desc, keywords: tr("sketch draw"),
      checked: () => app.sketchEditor?.tool?.id === id || (id === 'line' && app.sketchEditor?.tool?.id === 'line'),
      enabled: () => true,
      run: () => {
        if (!app.sketchEditor) {
          // Start a sketch first, then pick the tool.
          pendingTool = id;
          void c.run('sketch');
          return;
        }
        if (app.panel) void app.closePanel(false);
        const ed = app.sketchEditor;
        if (ed.tool?.id === id) { ed.setTool(null); return; }
        ed.setTool(t.make(ed));
      },
    };
  };
  let pendingTool: string | null = null;

  c.register(
    // ---- file ----
    { id: 'new', label: tr("New"), icon: 'new', shortcut: 'Control+N', description: tr("Start a new part."), enabled: () => !app.inComponentEdit, run: () => { void files.newPart(); } },
    {
      id: 'newAssembly', label: tr("New Assembly"), icon: 'part',
      description: tr("Start an assembly with multiple placed parts."),
      enabled: () => !app.inComponentEdit,
      run: async () => { if (await files.confirmDiscard(tr("start a new assembly"))) app.newAssembly(); },
    },
    { id: 'open', label: tr("Open..."), icon: 'open', shortcut: 'Ctrl+O', description: tr("Open a saved part."), enabled: () => !app.inComponentEdit, run: () => files.open() },
    { id: 'openDevice', label: tr("Open from Device..."), icon: 'upload', description: tr("Open a part file, or a STEP or SolidWorks file, from this device."), enabled: () => !app.inComponentEdit, run: () => files.openFromDevice() },
    { id: 'save', label: tr("Save"), icon: 'save', shortcut: 'Ctrl+S', description: tr("Save the part."), run: () => { void files.save(); } },
    { id: 'saveAs', label: tr("Save As..."), icon: 'save', shortcut: 'Ctrl+Shift+S', enabled: () => !app.inComponentEdit, run: () => files.saveAs() },
    { id: 'downloadPart', label: tr("Download Part File"), icon: 'download', description: tr("Download the part file to this device."), enabled: () => !app.inComponentEdit, run: () => files.exportAs('part') },
    { id: 'exportStep', label: tr("Export STEP..."), icon: 'export', keywords: tr("stp export cad"), description: tr("Export the solid as a STEP file."), enabled: hasBody, run: () => files.exportAs('step') },
    { id: 'exportStl', label: tr("Export STL..."), icon: 'export', keywords: tr("3d print mesh"), description: tr("Export the solid as an STL mesh for 3D printing."), enabled: hasBody, run: () => files.exportAs('stl') },
    { id: 'importStep', label: tr("Import..."), icon: 'import', keywords: tr("stp step sldprt solidworks import"), description: tr("Insert a STEP file or SolidWorks part as a solid body."), enabled: isPart, run: () => files.importStep() },
    { id: 'insertComponent', label: tr("Insert Component..."), icon: 'import', keywords: tr("assembly insert part place component"), description: tr("Place a saved Parametric part in this assembly."), enabled: () => app.isAssembly && !app.inComponentEdit, run: () => files.insertComponent() },
    {
      id: 'replaceComponent', label: tr("Replace Component..."), icon: 'import',
      keywords: tr("replace swap component part assembly"),
      description: tr("Swap the selected component's part for another saved part; its position and constraints stay."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').length === 1,
      run: () => {
        const component = app.selection.ofKind('component')[0];
        if (component) void files.replaceComponent(component.id);
      },
    },
    {
      id: 'newAssemblyPart', label: tr("New Part"), icon: 'part',
      keywords: tr("assembly new part in place empty component"),
      description: tr("Create an empty part in this assembly and open it for editing."),
      enabled: () => app.isAssembly && !app.inComponentEdit,
      run: () => app.newComponentPart(),
    },
    {
      id: 'editComponentPart', label: tr("Edit Part"), icon: 'part',
      keywords: tr("assembly edit part in place component"),
      description: tr("Open the selected component's part for editing in place."),
      enabled: () => app.isAssembly && !app.inComponentEdit && !!app.selection.ofKind('component')[0],
      run: () => { const component = app.selection.ofKind('component')[0]; if (component) app.editComponentPart(component.id); },
    },
    {
      id: 'finishComponentEdit', label: tr("Finish Part"), icon: 'check',
      description: tr("Write the part back into the assembly and return to it."),
      enabled: () => app.inComponentEdit,
      run: () => { app.finishComponentEdit(true); },
    },
    { id: 'cancelComponentEdit', label: tr("Cancel Part"), icon: 'close', enabled: () => app.inComponentEdit, run: () => void app.cancelComponentEdit() },
    { id: 'rename', label: tr("Rename..."), icon: 'edit', run: () => files.rename() },
    {
      id: 'assistant', label: tr("Assistant"), icon: 'assistant', shortcut: 'Ctrl+J', keywords: tr("ai chat copilot design help agent claude"),
      description: tr("Design and change the part by describing what you want."),
      checked: () => app.taskPaneOpen() === 'assistant', run: () => app.toggleTaskPane('assistant'),
    },
    { id: 'share', label: tr("Share..."), icon: 'share', keywords: tr("collaborate invite team access"), description: tr("Let other Puter users view or edit this part."), run: () => shareDialog(app, files) },
    { id: 'properties', label: tr("Part Properties..."), icon: 'part', keywords: tr("units decimals"), description: tr("Name, units and precision."), run: () => propertiesDialog(app) },
    // ---- edit ----
    {
      id: 'undo', label: tr("Undo"), icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => app.canUndo,
      run: () => { if (app.panel) void app.closePanel(false); app.store.undo(); },
    },
    { id: 'redo', label: tr("Redo"), icon: 'redo', shortcut: 'Ctrl+Y', enabled: () => app.store.canRedo, run: () => redo() },
    { id: 'redo2', label: tr("Redo"), hidden: true, shortcut: 'Ctrl+Shift+Z', enabled: () => app.store.canRedo, run: () => redo() },
    { id: 'rebuild', label: tr("Rebuild"), icon: 'rebuild', shortcut: 'Ctrl+B', description: tr("Rebuild the model."), run: () => app.requestRebuild(true) },
    { id: 'forceRebuild', label: tr("Force Rebuild"), icon: 'rebuild', shortcut: 'Control+Q', description: tr("Rebuild every feature from scratch."), run: () => { app.forceRebuild(); } },
    { id: 'repeat', label: tr("Repeat Last Command"), shortcut: 'Enter', hidden: true, enabled: () => !!c.lastRun && !app.panel, run: () => { if (c.lastRun) c.run(c.lastRun); } },
    {
      id: 'delete', label: tr("Delete"), icon: 'trash', shortcut: 'Delete',
      enabled: () => app.selection.items.some((x) => x.kind === 'feature' || x.kind === 'component' || x.kind === 'assemblyMate' || x.kind === 'assemblyJoint' || x.kind.startsWith('sk')),
      run: () => {
        if (!app.sketchEditor?.deleteSelection()) {
          const components = app.selection.ofKind('component').map((x) => x.id);
          const mates = app.selection.ofKind('assemblyMate').map((x) => x.id);
          const joints = app.selection.ofKind('assemblyJoint').map((x) => x.id);
          if (components.length) app.deleteComponents(components);
          else if (mates.length) mates.forEach((id) => app.deleteMate(id));
          else if (joints.length) joints.forEach((id) => app.deleteJoint(id));
          else void app.deleteFeatures(app.selection.ofKind('feature').map((x) => x.id));
        }
      },
    },
    {
      id: 'editFeature', label: tr("Edit Feature"), icon: 'edit', enabled: () => isPart() && !!selectedFeature(app),
      run: () => { const f = selectedFeature(app); if (f) app.editFeature(f.id); },
    },
    {
      id: 'editComponent', label: tr("Component Properties..."), icon: 'part',
      enabled: () => app.isAssembly && !!app.selection.ofKind('component')[0],
      run: () => { const component = app.selection.ofKind('component')[0]; if (component) app.openComponent(component.id); },
    },
    {
      id: 'fixComponent', label: tr("Fix/Float Component"), icon: 'origin',
      enabled: () => app.isAssembly && app.selection.ofKind('component').length >= 1,
      checked: () => {
        const selected = app.selection.ofKind('component');
        return selected.length > 0 && selected.every((c) => !!app.component(c.id)?.fixed);
      },
      run: () => {
        const selected = app.selection.ofKind('component');
        if (!selected.length) return;
        // One component toggles; several are all grounded (or all floated if already grounded).
        if (selected.length === 1) {
          app.updateComponentFixed(selected[0].id, !app.component(selected[0].id)?.fixed);
          return;
        }
        const ground = !selected.every((c) => !!app.component(c.id)?.fixed);
        for (const component of selected) app.updateComponentFixed(component.id, ground);
      },
    },
    {
      id: 'addMate', label: tr("Assembly Mate..."), icon: 'relation',
      keywords: tr("constraint coincident distance angle align assembly face edge mate"),
      description: tr("Constrain two components at picked geometry: the same faces, edges and origins as a joint."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').length === 2,
      run: () => {
        void import('./assembly').then(({ AssemblyJointPanel }) => app.openPanel(new AssemblyJointPanel(app)))
          .catch((e) => toast({ kind: 'error', message: (e as Error).message }));
      },
    },
    {
      id: 'moveComponents', label: tr("Move/Rotate"), icon: 'select',
      keywords: tr("move rotate drag position assembly component"),
      description: tr("Move or rotate the selected components by dragging in the view, or by typing offsets."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').length >= 1,
      run: () => {
        void import('./assembly').then(({ AssemblyMovePanel }) => app.openPanel(new AssemblyMovePanel(app)))
          .catch((e) => toast({ kind: 'error', message: (e as Error).message }));
      },
    },
    {
      id: 'addJoint', label: tr("Joint..."), icon: 'revolve',
      keywords: tr("constraint mate align revolute prismatic hinge slider assembly"),
      description: tr("Join two components at picked geometry: a face, an edge or their origins."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').length >= 1,
      run: () => {
        void import('./assembly').then(({ AssemblyJointPanel }) => app.openPanel(new AssemblyJointPanel(app)))
          .catch((e) => toast({ kind: 'error', message: (e as Error).message }));
      },
    },
    {
      id: 'autoMate', label: tr("Auto Mate"), icon: 'relation',
      keywords: tr("automatic constraint fit face axis smart align assemble"),
      description: tr("Constrain the best fitting faces or axes of the selected components automatically."),
      enabled: () => app.isAssembly && (app.selection.ofKind('component').length >= 2
        || (app.store.doc.components ?? []).some((c) => c.visible && !c.fixed)),
      run: () => {
        void import('./assembly').then(({ autoMateComponents }) => autoMateComponents(app))
          .catch((e) => toast({ kind: 'error', message: (e as Error).message }));
      },
    },
    {
      id: 'componentPattern', label: tr("Component Pattern..."), icon: 'circularPattern',
      keywords: tr("pattern array circular rectangular instance copy assembly"),
      description: tr("Copy the selected components around an axis or along directions, as a component pattern."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').length >= 1,
      run: () => {
        void import('./assembly').then(({ ComponentPatternPanel }) => app.openPanel(new ComponentPatternPanel(app)))
          .catch((e) => toast({ kind: 'error', message: (e as Error).message }));
      },
    },
    {
      id: 'hideComponents', label: tr("Hide"), icon: 'eyeOff',
      keywords: tr("hide components assembly visibility"),
      description: tr("Hide the selected components. Show All Components brings them back."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').some((c) => app.component(c.id)?.visible),
      run: () => app.hideComponents(app.selection.ofKind('component').filter((c) => app.component(c.id)?.visible).map((c) => c.id)),
    },
    {
      id: 'selectAllComponents', label: tr("Select All Components"), icon: 'select',
      keywords: tr("select all components assembly"),
      description: tr("Select every visible component in the assembly."),
      enabled: () => app.isAssembly && (app.store.doc.components ?? []).some((c) => c.visible),
      run: () => app.selection.set((app.store.doc.components ?? []).filter((c) => c.visible).map((c) => ({ kind: 'component' as const, id: c.id }))),
    },
    {
      id: 'duplicateComponent', label: tr("Duplicate Component"), icon: 'copy',
      keywords: tr("copy paste duplicate component assembly instance"),
      description: tr("Copy the selected components, offset so the copies show, and select them."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').length >= 1,
      run: () => app.duplicateComponents(app.selection.ofKind('component').map((c) => c.id)),
    },
    {
      id: 'isolateComponents', label: tr("Isolate"), icon: 'eyeOff',
      keywords: tr("isolate hide others solo component assembly visibility"),
      description: tr("Hide every other component so only the selected ones show."),
      enabled: () => app.isAssembly && app.selection.ofKind('component').length >= 1,
      run: () => app.isolateComponents(app.selection.ofKind('component').map((c) => c.id)),
    },
    {
      id: 'showAllComponents', label: tr("Show All Components"), icon: 'eye',
      keywords: tr("show all unhide components assembly visibility"),
      enabled: () => app.isAssembly && (app.store.doc.components ?? []).some((c) => !c.visible),
      run: () => app.showAllComponents(),
    },
    {
      id: 'mateSuggestions', label: tr("Mate Suggestions..."), icon: 'relation',
      keywords: tr("suggest fit faces axis automatic constraint list assembly"),
      description: tr("List the faces and axes that fit between the components, best first, and apply one."),
      enabled: () => app.isAssembly,
      run: () => {
        void import('./assembly').then(({ MateSuggestionsPanel }) => app.openPanel(new MateSuggestionsPanel(app)))
          .catch((e) => toast({ kind: 'error', message: (e as Error).message }));
      },
    },
    {
      id: 'motionStudy', label: tr("Motion Study"), icon: 'play',
      enabled: () => app.isAssembly && !!(app.store.doc.joints?.length),
      run: () => {
        void import('./assembly').then(({ MotionStudyPanel }) => app.openPanel(new MotionStudyPanel(app)))
          .catch((e) => toast({ kind: 'error', message: (e as Error).message }));
      },
    },
    {
      id: 'interference', label: tr("Interference Check"), icon: 'warning',
      enabled: () => app.isAssembly && hasBody(),
      run: async () => {
        const hits = await app.kernel.checkInterference();
        const body = hits.length
          ? h('div', {}, ...hits.map((hit) => h('p', {}, tr("{0} interferes with {1}: overlap volume {2}", [
            app.component(hit.a)?.name ?? hit.a,
            app.component(hit.b)?.name ?? hit.b,
            formatLength(hit.volume, app.store.doc.units, app.store.doc.decimals, true),
          ]))))
          : h('p', {}, tr("No interference was found between the visible components."));
        await showDialog({
          title: tr("Interference Check"),
          body,
          buttons: [{ label: tr("Close"), value: 'ok', primary: true }],
          wide: true,
        });
      },
    },
    {
      id: 'assemblyDiagnostics', label: tr("Assembly Diagnostics"), icon: 'error',
      enabled: () => app.isAssembly,
      run: async () => {
        const issues = assemblyDiagnostics(app.store.doc);
        const component = (id?: Id) => id ? app.component(id)?.name ?? id : '';
        const message = (issue: (typeof issues)[number]) => {
          switch (issue.code) {
            case 'missing-component':
              return tr("A constraint references a component that no longer exists: {0}.", [component(issue.componentA) || component(issue.componentB)]);
            case 'mate-fixed-conflict':
              return tr("Mate {0} connects two fixed components ({1}, {2}).", [
                app.store.doc.mates?.find((m) => m.id === issue.item)?.name ?? issue.item ?? '',
                component(issue.componentA), component(issue.componentB),
              ]);
            case 'joint-fixed-component':
              return tr("Joint {0} drives a fixed component ({1}).", [
                app.store.doc.joints?.find((j) => j.id === issue.item)?.name ?? issue.item ?? '',
                component(issue.componentA),
              ]);
            case 'invalid-joint-range':
              return tr("Joint {0} has an invalid secondary range.", [app.store.doc.joints?.find((j) => j.id === issue.item)?.name ?? issue.item ?? '']);
            case 'no-ground':
              return tr("The assembly has no fixed component. Mate propagation may be ambiguous.");
          }
        };
        const body = issues.length
          ? h('div', {}, ...issues.map((issue) => h('p', {}, issue.severity === 'error' ? '⛔ ' : '⚠️ ', message(issue))))
          : h('p', {}, tr("Assembly constraints and joints are valid."));
        await showDialog({
          title: tr("Assembly Diagnostics"),
          body,
          buttons: [{ label: tr("Close"), value: 'ok', primary: true }],
          wide: true,
        });
      },
    },
    {
      id: 'suppress', label: tr("Suppress"), icon: 'eyeOff', enabled: () => !!selectedFeature(app),
      run: () => app.toggleSuppress(app.selection.ofKind('feature').map((x) => x.id), true),
    },
    {
      id: 'unsuppress', label: tr("Unsuppress"), icon: 'eye', enabled: () => !!selectedFeature(app)?.suppressed,
      run: () => app.toggleSuppress(app.selection.ofKind('feature').map((x) => x.id), false),
    },
    { id: 'rollToEnd', label: tr("Roll to End"), icon: 'downToLine', enabled: () => app.store.doc.rollback != null, run: () => app.setRollback(null) },
    { id: 'material', label: tr("Edit Material..."), icon: 'material', keywords: tr("density steel aluminum"), enabled: isPart, run: () => materialDialog(app) },
    { id: 'appearance', label: tr("Appearance..."), icon: 'appearance', keywords: tr("color colour"), run: () => app.openTaskPane('appearance') },
    { id: 'equations', label: tr("Equations..."), icon: 'equations', keywords: tr("variables parameters global"), description: tr("Global variables and equations that drive dimensions."), enabled: isPart, run: () => equationsDialog(app) },
    { id: 'configurations', label: tr("Configurations..."), icon: 'files', keywords: tr("configuration variants parameter table"), description: tr("Create named parameter sets and switch the active part configuration."), enabled: isPart, run: () => configurationsDialog(app) },
    { id: 'projectManager', label: tr("Local Project Manager..."), icon: 'files', keywords: tr("projects folder organise parts"), description: tr("Organise locally saved parts into projects."), run: () => projectManagerDialog(app, files) },
    { id: 'resourceCenter', label: tr("Part Resource Center..."), icon: 'part', keywords: tr("library catalogue standard reusable"), description: tr("Browse, open and publish reusable parameterized parts."), run: () => resourceCenterDialog(app, files) },
    { id: 'publishLibrary', label: tr("Publish to Part Library..."), icon: 'part', keywords: tr("library publish reusable"), description: tr("Publish the current parameterized part to the local resource center."), enabled: isPart, run: () => void publishCurrentPart(app) },
    { id: 'options', label: tr("Options..."), icon: 'settings', keywords: tr("settings preferences theme"), run: () => optionsDialog(app) },
    // ---- sketch ----
    {
      id: 'sketch', label: tr("Sketch"), icon: 'sketch', description: tr("Create a new sketch on a plane or planar face, or edit the selected sketch."),
      enabled: isPart,
      checked: inSketch,
      run: () => {
        if (app.sketchEditor) { app.exitSketch(true); return; }
        const sel = app.selection.items[0];
        if (sel?.kind === 'feature' && app.store.feature(sel.id)?.type === 'sketch') { app.editSketch(sel.id); return; }
        const ref = app.selectedPlaneRef();
        const after = () => { if (pendingTool && app.sketchEditor) { const t = pendingTool; pendingTool = null; c.run(`tool:${t}`); } };
        if (ref) { app.startSketchOn(ref); after(); return; }
        void app.openPanel(app.hooks.planePickPanel((r) => { app.startSketchOn(r); after(); }));
      },
    },
    {
      id: 'sketchOnPlane', label: tr("Sketch on This Plane"), icon: 'sketch',
      keywords: tr("new sketch direct plane face start"),
      description: tr("Start a new sketch on the selected reference plane or planar face."),
      enabled: () => isPart() && !inSketch() && !!app.selectedPlaneRef(),
      run: () => { const ref = app.selectedPlaneRef(); if (ref) app.startSketchOn(ref); },
    },
    { id: 'exitSketch', label: tr("Exit Sketch"), icon: 'sketch', enabled: inSketch, run: () => app.exitSketch(true) },
    ...Object.keys(SKETCH_TOOLS).map(tool),
    { id: 'offset', label: tr("Offset Entities"), icon: 'offset', description: tr("Copy selected sketch curves at a distance."), enabled: inSketch, run: () => { void app.openPanel(new OffsetPanel(app)); } },
    { id: 'mirrorEntities', label: tr("Mirror Entities"), icon: 'mirrorEntities', description: tr("Mirror selected sketch entities about a line."), enabled: inSketch, run: () => mirrorSketchEntities(app) },
    {
      id: 'convertEntities', label: tr("Convert Entities"), icon: 'convertEntities', keywords: tr("project projection external geometry use reference model edge vertex link"),
      description: tr("Project model edges, faces or vertices into the sketch. The projected geometry stays linked to the model and follows it when it changes."),
      enabled: inSketch, checked: () => app.sketchEditor?.tool?.id === 'convertEntities', run: () => convertEntities(app),
    },
    { id: 'construction', label: tr("Construction Geometry"), icon: 'construction', shortcut: 'Q', description: tr("Toggle selected sketch entities between normal and construction geometry."), enabled: inSketch, run: () => app.sketchEditor?.toggleConstruction() },
    {
      id: 'addRelation', label: tr("Add Constraint"), icon: 'relation', keywords: tr("relation constrain geometric"), description: tr("Add geometric constraints between selected sketch entities."), enabled: inSketch,
      run: () => { app.sketchEditor?.setTool(null); app.refreshSketchPanel(); app.setStatus(tr("Select geometry; the constraints that fit appear in the PropertyManager. Or pick a constraint in the Constrain group of the Sketch tab.")); },
    },
    ...CONSTRAINTS.map((t): Command => ({
      id: `constraint:${t}`, label: RELATION_LABELS[t], icon: `rel:${t}`, keywords: tr("constraint constrain relation sketch geometric"), description: CONSTRAINT_HINTS[t],
      enabled: inSketch, checked: () => app.sketchEditor?.tool?.id === `constraint:${t}`,
      run: () => {
        if (!app.sketchEditor) return;
        if (app.panel) void app.closePanel(false);
        runConstraint(app.sketchEditor, t);
      },
    })),
    // ---- features ----
    feature('extrude', tr("Extruded Boss"), 'extrude', tr("Extrude a sketch to add material."), { shortcut: 'E', keywords: tr("extrusion pad boss") }),
    feature('revolve', tr("Revolved Boss"), 'revolve', tr("Revolve a sketch around an axis to add material."), { keywords: tr("revolution lathe") }),
    feature('extrude', tr("Extruded Cut"), 'extrudeCut', tr("Extrude a sketch to remove material."), { cut: true, needsBody: true, keywords: tr("pocket cut") }),
    feature('revolve', tr("Revolved Cut"), 'revolveCut', tr("Revolve a sketch to remove material."), { cut: true, needsBody: true }),
    feature('sweep', tr("Swept Boss"), 'sweep', tr("Sweep a profile along a path."), { keywords: 'pipe' }),
    feature('sweep', tr("Swept Cut"), 'sweep', tr("Sweep a profile along a path to remove material."), { cut: true, needsBody: true }),
    feature('coil', tr("Coil"), 'sweep', tr("Sweep a circle into a coil about the profile sketch's origin."), { keywords: tr("spring helix thread spiral") }),
    feature('rib', tr("Rib"), 'extrude', tr("Thicken the sketch lines into ribs along the sketch normal."), { keywords: tr("rib web gusset stiffener") }),
    feature('thread', tr("Thread"), 'hole', tr("Cut a helical thread into a cylindrical face."), { needsBody: true, keywords: tr("thread screw bolt tapped helix") }),
    feature('offsetFace', tr("Offset Face"), 'edit', tr("Push a planar face along its normal to add or remove material."), { needsBody: true, keywords: tr("direct edit push pull face offset") }),
    feature('loft', tr("Lofted Boss"), 'loft', tr("Blend between two or more profiles."), { keywords: 'blend' }),
    feature('loft', tr("Lofted Cut"), 'loft', tr("Blend between profiles to remove material."), { cut: true, needsBody: true }),
    feature('fillet', tr("Fillet"), 'fillet', tr("Round selected edges."), { needsBody: true, keywords: tr("round radius blend") }),
    feature('chamfer', tr("Chamfer"), 'chamfer', tr("Bevel selected edges."), { needsBody: true, keywords: 'bevel' }),
    feature('shell', tr("Shell"), 'shell', tr("Hollow out the part, optionally removing faces."), { needsBody: true, keywords: tr("hollow thickness") }),
  feature('hole', tr("Hole"), 'hole', tr("Simple, counterbored, double-counterbored, countersunk, counterdrilled, spotfaced or tapped holes on a face."), { needsBody: true, keywords: tr("drill counterbore countersink counterdrill spotface tap thread") }),
    feature('draft', tr("Draft"), 'draft', tr("Taper faces relative to a neutral plane."), { needsBody: true, keywords: tr("taper mould") }),
    feature('linearPattern', tr("Linear Pattern"), 'linearPattern', tr("Repeat features along one or two directions."), { needsBody: true, keywords: tr("array repeat") }),
    feature('circularPattern', tr("Circular Pattern"), 'circularPattern', tr("Repeat features around an axis."), { needsBody: true, keywords: tr("polar array") }),
    feature('mirror', tr("Mirror"), 'mirror', tr("Mirror features or the body about a plane."), { needsBody: true, keywords: 'symmetry' }),
    feature('plane', tr("Offset Plane"), 'plane', tr("Create a reference plane offset from a plane or face."), { planeKind: 'offset', keywords: tr("reference geometry datum") }),
    feature('plane', tr("Midplane"), 'plane', tr("Create a reference plane halfway between two parallel planes or faces."), { id: 'planeMidplane', planeKind: 'midplane', keywords: tr("reference geometry datum middle symmetry") }),
    feature('plane', tr("Plane at Angle"), 'plane', tr("Create a reference plane rotated about an edge from a plane or face."), { id: 'planeAngle', planeKind: 'angle', keywords: tr("reference geometry datum angle rotate axis") }),
    feature('plane', tr("Tangent Plane"), 'plane', tr("Create a reference plane tangent to a curved face at a point."), { id: 'planeTangent', planeKind: 'tangent', keywords: tr("reference geometry datum tangent cylinder cone sphere") }),
    feature('plane', tr("Plane Through Two Edges"), 'plane', tr("Create a reference plane through two straight edges."), { id: 'planeTwoEdges', planeKind: 'twoEdges', keywords: tr("reference geometry datum two edges") }),
    feature('plane', tr("Plane Through Three Points"), 'plane', tr("Create a reference plane through three points."), { id: 'planeThreePoints', planeKind: 'threePoints', keywords: tr("reference geometry datum three points vertices") }),
    feature('shaft', tr("Shaft Design"), 'shaft', tr("Design a stepped shaft with segments, end chamfers and a keyway, and check its torsional sizing."), { keywords: tr("mechanical shaft axis step keyway torque power speed") }),
    feature('spurGear', tr("Spur Gear Design"), 'spurGear', tr("Design an involute spur gear from its module, tooth count and face width, and check the tooth bending stress."), { keywords: tr("mechanical gear involute module teeth transmission") }),
    feature('bevelGear', tr("Bevel Gear Design"), 'bevelGear', tr("Design a straight bevel gear on a 90-degree shaft angle from its module and tooth counts."), { keywords: tr("mechanical bevel cone gear transmission") }),
    feature('wormGear', tr("Worm Gear Design"), 'wormGear', tr("Design a worm and wheel pair and check its lead angle and sliding speed."), { keywords: tr("mechanical worm wheel helical transmission") }),
    feature('vBelt', tr("V-Belt Design"), 'vBelt', tr("Design a two-sheave V-belt drive with grooved sheaves and the belt around them."), { keywords: tr("mechanical belt pulley sheave transmission") }),
    feature('syncBelt', tr("Synchronous Belt Design"), 'syncBelt', tr("Design a two-pulley synchronous belt drive and check its belt length and teeth in mesh."), { keywords: tr("mechanical timing belt pulley transmission") }),
    feature('sprocket', tr("Sprocket Design"), 'sprocket', tr("Design a roller chain sprocket and check its pitch diameter and chain speed."), { keywords: tr("mechanical chain sprocket transmission") }),
    feature('axis', tr("Axis of a Cylinder"), 'axis', tr("Create a construction axis along the axis of a cylindrical or conical face."), { id: 'axisCylinder', axisKind: 'cylinder', keywords: tr("reference geometry datum axis cylinder cone") }),
    feature('axis', tr("Axis Through Two Points"), 'axis', tr("Create a construction axis through two points."), { id: 'axisTwoPoints', axisKind: 'twoPoints', keywords: tr("reference geometry datum axis two points") }),
    feature('axis', tr("Axis Along an Edge"), 'axis', tr("Create a construction axis along a straight or circular edge."), { id: 'axisEdge', axisKind: 'edge', keywords: tr("reference geometry datum axis edge") }),
    feature('axis', tr("Axis Perpendicular to a Plane"), 'axis', tr("Create a construction axis perpendicular to a plane through a point."), { id: 'axisPerpendicular', axisKind: 'perpendicular', keywords: tr("reference geometry datum axis normal plane point") }),
    feature('point', tr("Point at a Vertex"), 'point', tr("Create a construction point at a vertex."), { id: 'pointVertex', pointKind: 'vertex', keywords: tr("reference geometry datum point vertex") }),
    feature('point', tr("Point at an Edge Midpoint"), 'point', tr("Create a construction point at the midpoint of a straight edge."), { id: 'pointMidpoint', pointKind: 'midpoint', keywords: tr("reference geometry datum point midpoint") }),
    feature('point', tr("Point at a Centre"), 'point', tr("Create a construction point at the centre of a circular edge."), { id: 'pointCenter', pointKind: 'center', keywords: tr("reference geometry datum point centre circle") }),
    feature('point', tr("Point at a Face Centre"), 'point', tr("Create a construction point at the centre of a face."), { id: 'pointFaceCenter', pointKind: 'faceCenter', keywords: tr("reference geometry datum point face centre") }),
    feature('point', tr("Point at an Intersection"), 'point', tr("Create a construction point where a straight edge meets a plane."), { id: 'pointIntersection', pointKind: 'intersection', keywords: tr("reference geometry datum point intersection") }),
    // ---- evaluate ----
    { id: 'measure', label: tr("Measure"), icon: 'measure', keywords: tr("distance length angle area"), description: tr("Measure distances, lengths, angles and areas."), enabled: hasBody, run: () => { void app.openPanel(new MeasurePanel(app)); } },
    { id: 'massProperties', label: tr("Mass Properties"), icon: 'massProperties', keywords: tr("volume weight inertia center of mass"), description: tr("Volume, mass, centre of mass and inertia."), enabled: hasBody, run: () => massPropertiesDialog(app) },
    {
      id: 'sectionView', label: tr("Section View"), icon: 'sectionView', keywords: tr("cut clip"), description: tr("Show the part cut by a plane."),
      checked: () => !!app.renderer.section,
      run: () => {
        if (app.renderer.section && !(app.panel instanceof SectionPanel)) { app.renderer.section = null; app.renderer.requestRender(); c.changed(); return; }
        void app.openPanel(new SectionPanel(app));
      },
    },
    // ---- view ----
    {
      id: 'zoomToSelection', label: tr("Zoom to Selection"), icon: 'zoomIn',
      keywords: tr("zoom selection frame component face"),
      description: tr("Frame the selected faces, edges, vertices or components."),
      enabled: () => app.selection.items.length > 0,
      run: () => app.viewport.zoomToSelection(),
    },
    { id: 'zoomFit', label: tr("Zoom to Fit"), icon: 'zoomFit', shortcut: 'F', run: () => (app.inDrawing ? app.drawing.fit() : app.viewport.zoomToFit()) },
    // ---- drawing ----
    { id: 'openDrawing', label: tr("Make Drawing"), icon: 'file', keywords: tr("drawing sheet 2d views print pdf"), description: tr("Open the 2D drawing of this part with standard views."), enabled: () => hasBody() || !!app.store.doc.drawing, run: () => app.openDrawing() },
    { id: 'backToModel', label: tr("Back to Model"), icon: 'part', enabled: () => app.inDrawing, run: () => app.closeDrawing() },
    { id: 'drawing:arrange', label: tr("Standard Views"), icon: 'viewOrientation', description: tr("Arrange front, top, right and isometric views at a fitting scale."), enabled: () => app.inDrawing && hasBody(), run: () => app.drawing.relayout() },
    ...(['front', 'top', 'right', 'left', 'back', 'bottom', 'isometric'] as const).map((k): Command => ({
      id: `drawing:add:${k}`, label: `${k[0].toUpperCase()}${k.slice(1)} View`, icon: k === 'isometric' ? 'viewIso' : `view${k[0].toUpperCase()}${k.slice(1)}`, enabled: () => app.inDrawing && hasBody(), run: () => app.drawing.addView(k),
    })),
    { id: 'drawing:pdf', label: tr("Export PDF"), icon: 'download', keywords: tr("print drawing"), enabled: () => !!app.store.doc.drawing && app.inDrawing, run: () => app.drawing.exportPdf() },
    { id: 'drawing:svg', label: tr("Export SVG"), icon: 'download', enabled: () => !!app.store.doc.drawing && app.inDrawing, run: () => app.drawing.exportSvg() },
    { id: 'zoomIn', label: tr("Zoom In"), icon: 'zoomIn', shortcut: 'Shift+Z', run: () => app.viewport.zoomBy(0.8) },
    { id: 'zoomOut', label: tr("Zoom Out"), icon: 'zoomOut', shortcut: 'Z', run: () => app.viewport.zoomBy(1.25) },
    // No shortcut: Ctrl+Shift+Z is Redo.
    { id: 'previousView', label: tr("Previous View"), icon: 'previousView', run: () => app.viewport.previousView() },
    view('front', tr("Front"), 'viewFront', 'Ctrl+1'),
    view('back', tr("Back"), 'viewBack', 'Ctrl+2'),
    view('left', tr("Left"), 'viewLeft', 'Ctrl+3'),
    view('right', tr("Right"), 'viewRight', 'Ctrl+4'),
    view('top', tr("Top"), 'viewTop', 'Ctrl+5'),
    view('bottom', tr("Bottom"), 'viewBottom', 'Ctrl+6'),
    view('isometric', tr("Isometric"), 'viewIso', 'Ctrl+7'),
    view('trimetric', tr("Trimetric"), 'viewIso'),
    view('dimetric', tr("Dimetric"), 'viewIso'),
    {
      id: 'normalTo', label: tr("Normal To"), icon: 'normalTo', shortcut: 'Ctrl+8', description: tr("Look straight at the selected plane, face or the sketch plane."),
      run: () => {
        const ref = app.selectedPlaneRef();
        const fr = ref ? app.frameOfPlane(ref) : app.sketchEditor?.frame ?? null;
        if (fr) app.viewport.normalTo(fr);
        else app.setStatus(tr("Select a plane or planar face first."), true);
      },
    },
    { id: 'viewOrientation', label: tr("View Orientation"), icon: 'viewOrientation', shortcut: 'Space', run: () => app.openViewMenu() },
    { id: 'displayStyle', label: tr("Display Style"), icon: 'shadedEdges', run: () => app.cycleDisplayStyle() },
    { id: 'toggleVisibility', label: tr("Hide/Show Items"), icon: 'eye', run: () => app.openVisibilityMenu() },
    style('shadedEdges', tr("Shaded With Edges"), 'shadedEdges'),
    style('shaded', tr("Shaded"), 'shaded'),
    style('hiddenRemoved', tr("Hidden Lines Removed"), 'hiddenRemoved'),
    style('hiddenVisible', tr("Hidden Lines Visible"), 'hiddenVisible'),
    style('wireframe', tr("Wireframe"), 'wireframe'),
    {
      id: 'perspective', label: tr("Perspective"), icon: 'perspective', checked: () => !app.renderer.camera.ortho,
      run: () => { const cam = app.renderer.camera; cam.ortho = !cam.ortho; cam.onChange(); c.changed(); },
    },
    toggle('showPlanes', tr("Planes"), () => app.viewport.showPlanes, (v) => app.changeSettings({ showPlanes: v })),
    toggle('showOrigin', tr("Origins"), () => app.viewport.showOrigin, (v) => app.changeSettings({ showOrigin: v })),
    toggle('showSketches', tr("Sketches"), () => app.viewport.showSketches, (v) => app.changeSettings({ showSketches: v })),
    toggle('showGrid', tr("Grid"), () => app.settings.showGrid, (v) => app.changeSettings({ showGrid: v })),
    toggle('snapGrid', tr("Snap to grid"), () => app.settings.snapToGrid, (v) => app.changeSettings({ snapToGrid: v })),
    toggle('showRelations', tr("Sketch Constraints"), () => app.settings.showRelations, (v) => app.changeSettings({ showRelations: v })),
    toggle('showDimensions', tr("Sketch Dimensions"), () => app.settings.showDimensions, (v) => app.changeSettings({ showDimensions: v })),
    { id: 'theme:system', label: tr("System Theme"), icon: 'system', checked: () => getThemeChoice() === 'system', run: () => { setThemeChoice('system'); c.changed(); } },
    { id: 'theme:light', label: tr("Light Theme"), icon: 'light', checked: () => getThemeChoice() === 'light', run: () => { setThemeChoice('light'); c.changed(); } },
    { id: 'theme:dark', label: tr("Dark Theme"), icon: 'dark', checked: () => getThemeChoice() === 'dark', run: () => { setThemeChoice('dark'); c.changed(); } },
    { id: 'toggleTree', label: tr("Design Tree"), icon: 'panelLeft', run: () => app.toggleLeftPane() },
    { id: 'shortcutBar', label: tr("Shortcut Bar"), icon: 'more', shortcut: 'S', description: tr("Show the most used commands at the cursor."), run: () => app.openShortcutBar() },
    // ---- help ----
    { id: 'shortcuts', label: tr("Keyboard Shortcuts"), icon: 'keyboard', shortcut: 'Shift+?', run: () => shortcutsDialog(app) },
    { id: 'shortcutsF1', label: tr("Keyboard Shortcuts"), hidden: true, shortcut: 'F1', run: () => shortcutsDialog(app) },
    { id: 'github', label: tr("Source Code on GitHub"), icon: 'github', run: () => { window.open(REPO_URL, '_blank', 'noopener'); } },
    { id: 'about', label: tr("About Parametric"), icon: 'info', run: () => aboutDialog() },
  );
  void noModes;
  void VIEWS;
}

function hasUsableSketch(app: App): boolean {
  const sel = app.selection.items[0];
  if (sel?.kind === 'feature' && app.store.feature(sel.id)?.type === 'sketch') return true;
  const doc = app.store.doc;
  const used = new Set(doc.features.flatMap((f) => (f.type === 'extrude' || f.type === 'revolve' || f.type === 'hole' ? [f.sketch] : [])));
  return doc.features.slice(0, app.store.builtCount).some((f) => f.type === 'sketch' && !used.has(f.id) && f.entities.length > 0);
}

function selectedFeature(app: App): Feature | undefined {
  const it = app.selection.items.find((x) => x.kind === 'feature') as { id: Id } | undefined;
  if (it) return app.store.feature(it.id);
  const face = app.selection.items.find((x) => x.kind === 'face') as { index: number } | undefined;
  if (face) return app.store.feature(app.faces[face.index]?.feature ?? '');
  return undefined;
}

// ---------- layout ----------

export const RIBBON: RibbonTab[] = [
  {
    id: 'features', label: tr("Features"),
    groups: [
      [{ cmd: 'extrude' }, { cmd: 'revolve' }, { stack: [{ cmd: 'sweep' }, { cmd: 'loft' }, { cmd: 'coil' }, { cmd: 'rib' }] }],
      [{ cmd: 'extrudeCut' }, { cmd: 'revolveCut' }, { stack: [{ cmd: 'sweepCut' }, { cmd: 'loftCut' }] }],
      [{ cmd: 'hole', menu: ['hole', 'thread'] }, { cmd: 'fillet', menu: ['fillet', 'chamfer'] }, { cmd: 'linearPattern', menu: ['linearPattern', 'circularPattern', 'mirror'] }],
      [{ stack: [{ cmd: 'chamfer' }, { cmd: 'shell' }, { cmd: 'draft' }, { cmd: 'offsetFace' }] }, { stack: [{ cmd: 'circularPattern' }, { cmd: 'mirror' }] }],
      [{ cmd: 'plane', menu: ['plane', 'planeMidplane', 'planeAngle', 'planeTangent', 'planeTwoEdges', 'planeThreePoints'] },
        { cmd: 'axisCylinder', menu: ['axisCylinder', 'axisTwoPoints', 'axisEdge', 'axisPerpendicular'] },
        { cmd: 'pointVertex', menu: ['pointVertex', 'pointMidpoint', 'pointCenter', 'pointFaceCenter', 'pointIntersection'] },
        { cmd: 'importStep' }],
      [{ cmd: 'newAssembly' }, { cmd: 'newAssemblyPart' }, { cmd: 'insertComponent' }, { cmd: 'editComponent' }, { cmd: 'editComponentPart' }, { cmd: 'openDrawing' }],
      [{ cmd: 'fixComponent' }, { cmd: 'duplicateComponent' }, { cmd: 'isolateComponents' }, { cmd: 'moveComponents' }, { cmd: 'componentPattern' }, { stack: [{ cmd: 'addJoint' }, { cmd: 'autoMate' }] }, { cmd: 'mateSuggestions' }, { cmd: 'motionStudy' }],
      [{ cmd: 'interference' }, { cmd: 'assemblyDiagnostics' }],
    ],
  },
  {
    id: 'sketch', label: tr("Sketch"),
    groups: [
      [{ cmd: 'sketch' }, { cmd: 'sketchOnPlane' }],
      [
        { stack: [{ cmd: 'tool:line' }, { cmd: 'tool:centerline' }, { cmd: 'tool:point' }] },
        { stack: [{ cmd: 'tool:rectangle' }, { cmd: 'tool:centerRectangle' }, { cmd: 'tool:rectangle3Point' }, { cmd: 'tool:polygon' }] },
        { stack: [{ cmd: 'tool:circle' }, { cmd: 'tool:perimeterCircle' }, { cmd: 'tool:slot', menu: ['tool:slot', 'tool:slotOverall', 'tool:slotCenter'] }] },
        { stack: [{ cmd: 'tool:centerArc' }, { cmd: 'tool:tangentArc' }, { cmd: 'tool:arc3' }] },
        { stack: [{ cmd: 'tool:spline' }, { cmd: 'tool:sketchFillet' }] },
      ],
      [{ stack: [{ cmd: 'tool:trim' }, { cmd: 'tool:extend' }, { cmd: 'offset' }] }, { stack: [{ cmd: 'mirrorEntities' }, { cmd: 'convertEntities' }, { cmd: 'construction' }] }],
      [
        { cmd: 'tool:smartDimension' },
        { stack: [{ cmd: 'constraint:coincident' }, { cmd: 'constraint:horizontal' }, { cmd: 'constraint:vertical' }] },
        { stack: [{ cmd: 'constraint:parallel' }, { cmd: 'constraint:perpendicular' }, { cmd: 'constraint:tangent' }] },
        { stack: [{ cmd: 'constraint:equal' }, { cmd: 'constraint:concentric' }, { cmd: 'constraint:midpoint' }] },
        { stack: [{ cmd: 'constraint:collinear' }, { cmd: 'constraint:symmetric' }, { cmd: 'constraint:fix' }] },
      ],
    ],
    labels: [tr("Sketch"), tr("Draw"), tr("Modify"), tr("Constrain")],
  },
  {
    id: 'mechanical', label: tr("Mechanical"),
    groups: [
      [{ cmd: 'spurGear' }, { cmd: 'bevelGear' }, { cmd: 'wormGear' }],
      [{ cmd: 'vBelt' }, { cmd: 'syncBelt' }, { cmd: 'sprocket' }],
      [{ cmd: 'shaft' }],
    ],
    labels: [tr("Gears"), tr("Belts and Chains"), tr("Shaft")],
  },
  {
    id: 'evaluate', label: tr("Evaluate"),
    groups: [
      [{ cmd: 'measure' }, { cmd: 'massProperties' }, { cmd: 'sectionView' }],
      [{ cmd: 'equations' }, { cmd: 'configurations' }, { cmd: 'material' }],
      [{ cmd: 'projectManager' }, { cmd: 'resourceCenter' }, { cmd: 'publishLibrary' }],
    ],
  },
  {
    id: 'drawing', label: tr("Drawing"),
    groups: [
      [{ cmd: 'drawing:arrange' }, { stack: [{ cmd: 'drawing:add:front' }, { cmd: 'drawing:add:top' }, { cmd: 'drawing:add:right' }] }, { stack: [{ cmd: 'drawing:add:isometric' }, { cmd: 'drawing:add:left' }, { cmd: 'drawing:add:back' }] }],
      [{ cmd: 'drawing:pdf' }, { cmd: 'drawing:svg' }],
      [{ cmd: 'zoomFit' }, { cmd: 'backToModel' }],
    ],
  },
  {
    id: 'view', label: tr("View"),
    groups: [
      [{ cmd: 'zoomToSelection' }, { cmd: 'zoomFit' }, { cmd: 'normalTo' }],
      [{ stack: [{ cmd: 'viewFront' }, { cmd: 'viewTop' }, { cmd: 'viewRight' }] }, { stack: [{ cmd: 'viewBack' }, { cmd: 'viewBottom' }, { cmd: 'viewLeft' }] }, { cmd: 'viewIsometric' }],
      [{ stack: [{ cmd: 'style:shadedEdges' }, { cmd: 'style:shaded' }, { cmd: 'style:wireframe' }] }, { stack: [{ cmd: 'style:hiddenRemoved' }, { cmd: 'style:hiddenVisible' }, { cmd: 'perspective' }] }],
    ],
  },
];

export function buildMenus(app: App): { label: string; items: () => MenuItem[] }[] {
  const c = app.commands;
  const m = (id: string, extra: Partial<MenuItem> = {}): MenuItem => {
    const cmd = c.get(id)!;
    return { label: cmd.label, icon: cmd.icon, shortcut: cmd.shortcut, disabled: !c.isEnabled(id), checked: cmd.checked ? c.isChecked(id) : undefined, run: () => c.run(id), ...extra };
  };
  const sep: MenuItem = { separator: true };
  return [
    {
      label: tr("File"), items: () => [
        m('new'), m('newAssembly'), m('open'), m('openDevice'), { label: tr("Recent"), icon: 'files', submenu: () => app.recentMenu() }, sep,
        m('projectManager'), m('resourceCenter'), m('publishLibrary'), sep,
        m('save'), m('saveAs'), m('downloadPart'), sep, m('importStep'), m('insertComponent'), m('exportStep'), m('exportStl'), sep, m('openDrawing'), m('drawing:pdf'), sep, m('share'), m('rename'), m('properties'),
      ],
    },
    {
      label: tr("Edit"), items: () => [
        { ...m('undo'), label: app.canUndo ? tr('Undo {0}', [app.store.undoLabel]) : tr("Undo") },
        { ...m('redo'), label: app.store.canRedo ? tr('Redo {0}', [app.store.redoLabel]) : tr("Redo") }, sep,
        m('rebuild'), m('forceRebuild'), sep, m('editFeature'), m('delete'), m('suppress'), m('unsuppress'), m('rollToEnd'), sep, m('appearance'), m('material'),
      ],
    },
    {
      label: tr("View"), items: () => [
        { label: tr("Display"), icon: 'shadedEdges', submenu: () => ['shadedEdges', 'shaded', 'hiddenRemoved', 'hiddenVisible', 'wireframe'].map((s) => ({ ...m(`style:${s}`), radio: true })) },
        { label: tr("Orientation"), icon: 'viewOrientation', submenu: () => app.viewMenuItems() },
        m('zoomFit'), m('zoomIn'), m('zoomOut'), m('previousView'), m('perspective'), m('sectionView'), sep,
        { label: tr("Hide/Show"), icon: 'eye', submenu: () => ['showPlanes', 'showOrigin', 'showSketches', 'showGrid', 'snapGrid', 'showRelations', 'showDimensions'].map((id) => m(id)) },
        { label: tr("Theme"), icon: 'system', submenu: () => [m('theme:system', { radio: true }), m('theme:light', { radio: true }), m('theme:dark', { radio: true })] },
        m('toggleTree'),
      ],
    },
    {
      label: tr("Insert"), items: () => [
        m('sketch'), m('insertComponent'), m('newAssemblyPart'), m('addJoint'), m('autoMate'), m('mateSuggestions'), sep,
        { label: tr("Boss/Base"), icon: 'extrude', submenu: () => [m('extrude'), m('revolve'), m('sweep'), m('loft')] },
        { label: tr("Cut"), icon: 'extrudeCut', submenu: () => [m('extrudeCut'), m('revolveCut'), m('sweepCut'), m('loftCut')] },
        { label: tr("Features"), icon: 'fillet', submenu: () => [m('fillet'), m('chamfer'), m('hole'), m('shell'), m('draft'), m('shaft')] },
        { label: tr("Pattern/Mirror"), icon: 'linearPattern', submenu: () => [m('linearPattern'), m('circularPattern'), m('mirror')] },
        { label: tr("Reference Geometry"), icon: 'plane', submenu: () => [m('plane'), m('planeMidplane'), m('planeAngle'), m('planeTangent'), m('planeTwoEdges'), m('planeThreePoints')] },
        { label: tr("Axis"), icon: 'axis', submenu: () => [m('axisCylinder'), m('axisTwoPoints'), m('axisEdge'), m('axisPerpendicular')] },
        { label: tr("Point"), icon: 'point', submenu: () => [m('pointVertex'), m('pointMidpoint'), m('pointCenter'), m('pointFaceCenter'), m('pointIntersection')] },
        sep, m('importStep'),
      ],
    },
    {
      label: tr("Tools"), items: () => [
        { label: tr("Sketch Entities"), icon: 'line', submenu: () => ['line', 'centerline', 'rectangle', 'centerRectangle', 'rectangle3Point', 'circle', 'perimeterCircle', 'centerArc', 'tangentArc', 'arc3', 'polygon', 'slot', 'slotOverall', 'slotCenter', 'spline', 'point'].map((t) => m(`tool:${t}`)) },
        { label: tr("Sketch Tools"), icon: 'trim', submenu: () => [m('tool:sketchFillet'), m('tool:trim'), m('tool:extend'), m('offset'), m('mirrorEntities'), m('convertEntities'), m('construction')] },
        { label: tr("Dimensions and Constraints"), icon: 'smartDimension', submenu: () => [m('tool:smartDimension'), sep, ...CONSTRAINTS.map((t) => m(`constraint:${t}`))] },
        { label: tr("Evaluate"), icon: 'measure', submenu: () => [m('measure'), m('massProperties'), m('sectionView')] },
        sep, m('fixComponent'), m('motionStudy'), m('interference'), m('assemblyDiagnostics'), sep,
        m('equations'), m('configurations'), m('material'), m('projectManager'), m('resourceCenter'), m('options'),
      ],
    },
    {
      label: tr("Help"), items: () => [m('shortcuts'), { label: tr("Getting Started"), icon: 'help', run: () => app.showGettingStarted() }, sep, m('github'), m('about')],
    },
  ];
}

/** Context menu items. */
export function contextItems(app: App, target: 'viewport' | 'feature' | 'reference' | 'component' | 'assemblyMate' | 'assemblyJoint', id?: Id): MenuItem[] {
  const c = app.commands;
  const m = (cid: string, extra: Partial<MenuItem> = {}): MenuItem => {
    const cmd = c.get(cid)!;
    return { label: cmd.label, icon: cmd.icon, shortcut: cmd.shortcut, disabled: !c.isEnabled(cid), run: () => c.run(cid), ...extra };
  };
  const sep: MenuItem = { separator: true };
  const ed = app.sketchEditor;
  if (ed && id) {
    // Dimension or relation in the sketch.
    const con = ed.sketch.constraints.find((x) => x.id === id);
    if (con && isDimension(con)) {
      const d = con as SkDimension;
      return [
        { label: tr("Modify Value..."), icon: 'edit', disabled: !!d.driven, run: () => ed.openModify(id) },
        { label: d.driven ? tr("Make Driving") : tr("Make Driven (reference)"), icon: 'smartDimension', run: () => ed.setDriven(id, !d.driven) },
        sep, { label: tr("Delete Dimension"), icon: 'trash', run: () => ed.edit(tr("Delete dimension"), (sk) => { sk.constraints = sk.constraints.filter((k) => k.id !== id); }) },
      ];
    }
    if (con) return [{ label: tr("Delete Constraint"), icon: 'trash', run: () => ed.edit(tr("Delete constraint"), (sk) => { sk.constraints = sk.constraints.filter((k) => k.id !== id); }) }];
  }
  if (ed) {
    const items: MenuItem[] = [];
    const ids = ed.selectedIds();
    const fits = ed.selectionRelations();
    if (fits.length) {
      const sel = [...app.selection.items];
      items.push({ label: tr("Add Constraint"), icon: 'relation', submenu: () => fits.map((t) => ({ label: RELATION_LABELS[t], icon: `rel:${t}`, run: () => ed.addRelation(t, sel) })) });
    }
    if (ids.length) items.push(m('construction'), m('delete'), sep);
    else if (fits.length) items.push(sep);
    items.push(m('tool:smartDimension'), m('tool:line'), m('tool:rectangle'), m('tool:circle'), sep, m('convertEntities'), m('exitSketch'), sep, m('zoomFit'), m('normalTo'));
    return items;
  }
  if (target === 'component' && id) {
    const component = app.component(id);
    if (!component) return [];
    const picked = app.assemblyPick;
    const pickedHere = picked && picked.componentId === id ? picked : null;
    const pickedItems: MenuItem[] = pickedHere
      ? [
        { label: pickedHere.kind === 'face' ? tr("Auto Mate This Face") : tr("Auto Mate This Edge"), icon: 'relation', run: () => { void import('./assembly').then(({ autoMateFromPick }) => autoMateFromPick(app)); } },
        { label: tr("Joint From This Geometry..."), icon: 'revolve', run: () => { void import('./assembly').then(({ openJointFromPick }) => openJointFromPick(app)); } },
        sep,
      ]
      : [];
    return [
      ...pickedItems,
      { label: tr("Move/Rotate"), icon: 'select', run: () => c.run('moveComponents') },
      { label: tr("Component Pattern..."), icon: 'circularPattern', run: () => c.run('componentPattern') },
      { label: tr("Replace Component..."), icon: 'import', disabled: !c.isEnabled('replaceComponent'), run: () => c.run('replaceComponent') },
      { label: tr("Duplicate Component"), icon: 'copy', run: () => c.run('duplicateComponent') },
      { label: tr("Hide"), icon: 'eyeOff', run: () => c.run('hideComponents') },
      { label: tr("Isolate"), icon: 'eyeOff', run: () => c.run('isolateComponents') },
      { label: tr("Show All Components"), icon: 'eye', disabled: !c.isEnabled('showAllComponents'), run: () => c.run('showAllComponents') },
      sep,
      { label: tr("Auto Mate"), icon: 'relation', disabled: !c.isEnabled('autoMate'), run: () => c.run('autoMate') },
      { label: tr("Joint..."), icon: 'revolve', run: () => c.run('addJoint') },
      { label: tr("Mate Suggestions..."), icon: 'relation', run: () => c.run('mateSuggestions') },
      { label: tr("Fix/Float"), icon: 'origin', run: () => c.run('fixComponent') },
      sep,
      { label: tr("Component Properties..."), icon: 'part', run: () => app.openComponent(id) },
      { label: tr("Edit Part"), icon: 'part', run: () => app.editComponentPart(id) },
      {
        label: component.visible ? tr("Hide") : tr("Show"),
        icon: component.visible ? 'eyeOff' : 'eye',
        run: () => app.updateComponent(id, { visible: !component.visible }),
      },
      sep,
      { label: tr("Delete"), icon: 'trash', shortcut: 'Delete', run: () => app.deleteComponents([id]) },
    ];
  }
  if (target === 'assemblyMate' && id) {
    const mate = app.store.doc.mates?.find((m) => m.id === id);
    if (!mate) return [];
    return [
      { label: tr("Edit Assembly Mate..."), icon: 'relation', run: () => app.openMate(id) },
      { label: tr("Delete"), icon: 'trash', shortcut: 'Delete', run: () => app.deleteMate(id) },
    ];
  }
  if (target === 'assemblyJoint' && id) {
    const joint = app.store.doc.joints?.find((j) => j.id === id);
    if (!joint) return [];
    return [
      { label: tr("Edit Joint..."), icon: 'revolve', run: () => app.openJoint(id) },
      { label: tr("Motion Study"), icon: 'play', run: () => c.run('motionStudy') },
      sep,
      { label: tr("Delete"), icon: 'trash', shortcut: 'Delete', run: () => app.deleteJoint(id) },
    ];
  }
  if (target === 'feature' && id) {
    const f = app.store.feature(id)!;
    const idx = app.store.indexOf(id);
    const ids = app.tree.targets(id);
    // The sketches a feature was built from stay editable from the feature itself.
    const used = sketchesOf(app, f);
    return [
      f.type === 'sketch' ? { label: tr("Edit Sketch"), icon: 'sketch', run: () => app.editSketch(id) } : { label: tr("Edit Feature"), icon: 'edit', run: () => app.editFeature(id) },
      ...used.map((sk): MenuItem => ({ label: used.length === 1 ? tr("Edit Sketch") : `Edit ${sk.name}`, icon: 'sketch', run: () => app.editSketch(sk.id) })),
      { label: tr("Rename"), icon: 'text', shortcut: 'F2', run: () => app.tree.startRename(id) },
      sep,
      ...(f.type === 'sketch' || f.type === 'plane' ? [{ label: f.hidden ? tr("Show") : tr("Hide"), icon: f.hidden ? 'eye' : 'eyeOff', run: () => app.toggleHidden([id]) } as MenuItem] : []),
      { label: f.suppressed ? tr("Unsuppress") : tr("Suppress"), icon: f.suppressed ? 'eye' : 'eyeOff', run: () => app.toggleSuppress(ids, !f.suppressed) },
      { label: tr("Roll Back to Here"), icon: 'upToLine', run: () => app.setRollback(idx) },
      { label: tr("Roll to End"), icon: 'downToLine', disabled: app.store.doc.rollback == null, run: () => app.setRollback(null) },
      ...(f.type === 'sketch' || f.type === 'plane' ? [{ label: tr("Normal To"), icon: 'normalTo', run: () => { const fr = f.type === 'sketch' ? app.frameOfSketch(f) : app.frameOfPlane({ kind: 'feature', id }); if (fr) app.viewport.normalTo(fr); } } as MenuItem] : []),
      sep,
      { label: tr("Delete"), icon: 'trash', shortcut: 'Delete', run: () => void app.deleteFeatures(ids) },
    ];
  }
  const sel = app.selection.items[0];
  const items: MenuItem[] = [];
  if (sel) {
    const plane = app.selectedPlaneRef();
    if (plane) items.push(m('sketchOnPlane'), m('normalTo'), m('plane', { label: tr("Offset Plane") }), m('planeMidplane'), m('planeAngle'), m('planeTangent'), m('planeTwoEdges'), m('planeThreePoints'), sep);
    if (sel?.kind === 'face') items.push({ label: tr("Axis of This Face"), icon: 'axis', run: () => c.run('axisCylinder') }, { label: tr("Point at This Face's Centre"), icon: 'point', run: () => c.run('pointFaceCenter') });
    if (sel?.kind === 'edge') items.push({ label: tr("Axis Along This Edge"), icon: 'axis', run: () => c.run('axisEdge') }, { label: tr("Point at the Edge Midpoint"), icon: 'point', run: () => c.run('pointMidpoint') });
    if (sel.kind === 'face') {
      const owner = app.store.feature(app.faces[sel.index]?.feature ?? '');
      if (owner) items.push({ label: `Edit ${owner.name}`, icon: 'edit', run: () => app.editFeature(owner.id) });
      if (owner) for (const sk of sketchesOf(app, owner)) items.push({ label: `Edit ${sk.name}`, icon: 'sketch', run: () => app.editSketch(sk.id) });
      items.push(m('fillet'), m('chamfer'), m('shell'), m('measure'), sep);
    }
    if (sel.kind === 'edge') items.push(m('fillet'), m('chamfer'), m('measure'), sep);
  }
  if (app.isAssembly) {
    const components = app.selection.ofKind('component');
    const pick = app.assemblyPick;
    if (pick) {
      items.push(
        { label: pick.kind === 'face' ? tr("Auto Mate This Face") : tr("Auto Mate This Edge"), icon: 'relation', run: () => { void import('./assembly').then(({ autoMateFromPick }) => autoMateFromPick(app)); } },
        { label: tr("Joint From This Geometry..."), icon: 'revolve', run: () => { void import('./assembly').then(({ openJointFromPick }) => openJointFromPick(app)); } },
        sep,
      );
    }
    const assemblyItems: MenuItem[] = components.length
      ? [m('moveComponents'), m('componentPattern'), m('replaceComponent'), m('hideComponents'), m('isolateComponents'), m('showAllComponents'), m('autoMate'), m('addJoint'), m('fixComponent'), sep]
      : [m('insertComponent'), m('newAssemblyPart'), m('autoMate'), m('mateSuggestions'), m('showAllComponents'), m('motionStudy'), m('interference'), sep];
    items.push(...assemblyItems);
  }
  items.push(m('zoomToSelection'), m('zoomFit'), { label: tr("View Orientation"), icon: 'viewOrientation', submenu: () => app.viewMenuItems() }, { label: tr("Display Style"), icon: 'shadedEdges', submenu: () => app.displayMenuItems() });
  if (target === 'reference') items.unshift({ label: tr("Show/Hide Planes"), icon: 'plane', run: () => c.run('showPlanes') }, sep);
  return items;
}

/** The sketches a feature consumes (profile, path, hole centres), in order, without repeats. */
function sketchesOf(app: App, f: Feature): Feature[] {
  const out: Feature[] = [];
  for (const sid of consumedSketches(f)) {
    const sk = app.store.feature(sid);
    if (sk && sk.type === 'sketch' && !out.includes(sk)) out.push(sk);
  }
  return out;
}

export function quickActions(app: App): { cmd: string }[] {
  if (app.isAssembly) {
    const components = app.selection.ofKind('component');
    if (app.selection.ofKind('assemblyJoint').length) return [{ cmd: 'motionStudy' }, { cmd: 'interference' }, { cmd: 'zoomFit' }];
    if (components.length === 2) return [{ cmd: 'autoMate' }, { cmd: 'addJoint' }, { cmd: 'mateSuggestions' }, { cmd: 'openDrawing' }];
    return components.length
      ? [{ cmd: 'editComponent' }, { cmd: 'moveComponents' }, { cmd: 'componentPattern' }, { cmd: 'addJoint' }, { cmd: 'zoomToSelection' }, { cmd: 'fixComponent' }, { cmd: 'hideComponents' }, { cmd: 'isolateComponents' }]
      : [{ cmd: 'newAssemblyPart' }, { cmd: 'insertComponent' }, { cmd: 'selectAllComponents' }, { cmd: 'autoMate' }, { cmd: 'mateSuggestions' }, { cmd: 'zoomFit' }];
  }
  const it = app.selection.items[0];
  if (!it) return [];
  if (it.kind === 'face') {
    const f = app.faces[it.index];
    return f?.type === 'plane' ? [{ cmd: 'sketch' }, { cmd: 'normalTo' }, { cmd: 'editFeature' }, { cmd: 'extrudeCut' }, { cmd: 'hole' }, { cmd: 'fillet' }, { cmd: 'measure' }] : [{ cmd: 'editFeature' }, { cmd: 'fillet' }, { cmd: 'measure' }];
  }
  if (it.kind === 'edge') return [{ cmd: 'fillet' }, { cmd: 'chamfer' }, { cmd: 'measure' }];
  if (it.kind === 'plane') return [{ cmd: 'sketch' }, { cmd: 'normalTo' }, { cmd: 'plane' }];
  return [];
}

/** PropertyManager asking for a sketch plane. */
export class PlanePickPanel extends PropertyPanel {
  title = tr("Sketch");
  icon = 'sketch';
  confirm = false;
  constructor(private app: App, private done: (ref: PlaneRef) => void) {
    super();
    app.setPlanePicking(true);
  }

  filter() {
    return { plane: true, planarOnly: true, face: true };
  }

  render() {
    return [section(tr("Select a Plane"), [
      h('p', { class: 'field-label' }, tr("Select one of the planes shown, or a planar face of the model, to sketch on.")),
    ])];
  }

  onPick(item: import('./selection').SelItem): boolean {
    let ref: PlaneRef | null = null;
    if (item.kind === 'plane') ref = item.ref;
    else if (item.kind === 'face') {
      const f = this.app.faces[item.index];
      if (f?.type === 'plane') ref = { kind: 'face', face: { name: f.name, sig: { type: f.type, c: f.center, n: f.normal, area: f.area } } };
    }
    if (!ref) return false;
    const r = ref;
    void this.app.closePanel(false).then(() => this.done(r));
    return true;
  }

  ok() { return true; }

  dispose() {
    this.app.setPlanePicking(false);
  }
}

export function makeHooks(app: App): AppHooks {
  return {
    ribbonTabs: RIBBON,
    menus: buildMenus(app),
    sketchPanel: () => new SketchPanel(app),
    editFeaturePanel: (f) => panelFor(app, f, true),
    planePickPanel: (done) => new PlanePickPanel(app, done),
    contextItems: (t, id) => contextItems(app, t, id),
    quickActions: () => quickActions(app),
  };
}

export const unitLabel = (u: keyof typeof UNIT_SYSTEMS) => UNIT_SYSTEMS[u].label;
export { toast };
