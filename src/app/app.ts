// The application hub: document store, geometry worker, renderer, viewport,
// selection, PropertyManager panels, sketch mode and the rebuild loop.

import type { BuildResult, EdgeInfo, FaceInfo, FeatureStatus } from '../kernel/protocol';
import { KernelClient, KernelRestartError } from '../kernel/client';
import type { Frame, Vec3 } from '../math/vec';
import { DocStore, configurationVariables, isAssembly, newAssembly as newAssemblyDocument, newDocument } from '../model/document';
import { assemblyTransforms, composeTransform, frameToWorld, jointValue, movableJoints, patternDir, patternSteps, patternsOf, rotateAbout } from '../model/assembly';
import { evaluateVariables } from '../model/expr';
import { consumedSketches, defaultName, dependencies, newSketch } from '../model/features';
import { BASE_FRAMES, BASE_PLANE_NAMES } from '../model/planes';
import type {
  AssemblyComponent, AssemblyJoint, AssemblyMate, BasePlane, ComponentTransform, Feature, Id, PartDocument, PlaneRef, SkEntity, SketchFeature,
} from '../model/types';
import { UNIT_SYSTEMS, formatLength } from '../model/units';
import { Renderer, type Theme } from '../render/renderer';
import { VIEWS } from '../render/camera';
import { cssColor, parseColor } from '../platform/theme';
import { closeMenus, openMenu, type MenuItem } from '../ui/menu';
import { attachTooltip, confirmDialog, dialogOpen, toast } from '../ui/overlay';
import { announce, formatShortcut, h, isTextInput } from '../ui/dom';
import { icon } from '../ui/icons';
import { selectTabs, syncTabStops, tabKeys } from '../ui/tabs';
import { type FocusRegion, cycleRegion, firstTabStop, trackRegionFocus } from '../ui/regions';
import { CommandRegistry } from './commands';
import { type PickFilter, PropertyPanel, retireNumberFields, type UnitContext } from './pm';
import { Selection, faceRef, remapItem, type SelItem } from './selection';
import { type Shell, buildShell, renderRibbon, syncCommandButtons, type RibbonTab } from './shell';
import { SketchEditor } from './sketch/editor';
import { sketchDefinitionStatus } from './sketch/panel';
import { FeatureTree } from './tree';
import { DrawingPanel, DrawingWorkspace } from './drawing';
import { Viewport, type VPEvent } from './viewport';
import { CanvasValueHandle } from './canvas-value';
import { type Location } from '../platform/files';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './settings';
import { tr } from '../i18n';
export { DEFAULT_SETTINGS, type Settings } from './settings';

export interface Colors {
  sketchUnder: number[];
  sketchFull: number[];
  sketchOver: number[];
  sketchConstruction: number[];
  sketchExternal: number[];
  sketchSelected: number[];
  hover: number[];
  dimension: number[];
  dimensionDriven: number[];
}

/** Controls whose own keyboard activation must win over global shortcuts. */
const ACTIVATES_ON_ENTER = 'button, a[href], summary, [role="button"], [role="link"], [role="tab"], [role="option"], [role="menuitem"], [role="treeitem"]';
const ACTIVATES_ON_SPACE = 'input[type="checkbox"], input[type="radio"], select, [role="checkbox"], [role="switch"], [role="radio"]';

/** Hooks implemented by the feature/command modules (set up in main). */
export interface AppHooks {
  ribbonTabs: RibbonTab[];
  menus: { label: string; items: () => MenuItem[] }[];
  sketchPanel: () => PropertyPanel;
  editFeaturePanel: (f: Feature) => PropertyPanel | null;
  planePickPanel: (onPick: (ref: PlaneRef) => void) => PropertyPanel;
  contextItems: (target: 'viewport' | 'feature' | 'reference' | 'component' | 'assemblyMate' | 'assemblyJoint', id?: Id) => MenuItem[];
  quickActions: () => { cmd: string }[];
  afterLoad?: () => void;
  recent?: () => MenuItem[];
  gettingStarted?: () => void;
  saveSettings?: (s: Settings) => void;
}

export class App {
  readonly store = new DocStore();
  readonly kernel: KernelClient;
  readonly selection = new Selection();
  readonly commands = new CommandRegistry();
  shell!: Shell;
  renderer!: Renderer;
  viewport!: Viewport;
  tree!: FeatureTree;
  hooks!: AppHooks;
  panel: PropertyPanel | null = null;
  /** The command panel is a floating dialog over the graphics area (Fusion), not a left-pane sheet. */
  private panelFloating = false;
  /** Fusion-style value box beside the feature being edited. */
  private valueHandle: CanvasValueHandle | null = null;
  /** An assembly component whose part is open for editing (Fusion's in-place part edit). */
  componentEdit: {
    assembly: import('../model/types').PartDocument;
    location: Location | null;
    componentId: Id;
    created: boolean;
    assemblyDirty: boolean;
  } | null = null;
  private componentBanner: HTMLElement | null = null;
  sketchEditor: SketchEditor | null = null;
  location: Location | null = null;
  private documentLifetime = new AbortController();
  /** Invalidated on document replacement, but preserved through edits and Undo. */
  get documentSignal(): AbortSignal { return this.documentLifetime.signal; }
  settings: Settings = { ...DEFAULT_SETTINGS };
  private settingChanges = new Map<keyof Settings, number>();
  private settingsLoad = 0;
  faces: FaceInfo[] = [];
  edges: EdgeInfo[] = [];
  frames: Record<Id, Frame> = {};
  /** Construction axes and points from the last rebuild. */
  axes: Record<Id, { p: Vec3; d: Vec3 }> = {};
  points: Record<Id, Vec3> = {};
  /** Sketches with projected model geometry, as the last rebuild placed it. */
  linkedSketches: NonNullable<BuildResult['sketches']> = {};
  bbox: { min: Vec3; max: Vec3 } | null = null;
  /** Bodies in the part after the last rebuild (1 unless new bodies were kept). */
  bodyCount = 1;
  colors!: Colors;
  kernelReady = false;
  private statuses = new Map<Id, FeatureStatus>();
  private resolveErrors = new Map<Id, string>();
  private rebuildQueued = false;
  private lastBuildKey = '';
  private vertices: Float32Array = new Float32Array(0);
  private leftTab: 'tree' | 'pm' = 'tree';
  private ribbonTab = 'features';
  private loadingEl: HTMLElement | null = null;
  private statusTimer = 0;
  /** Planes shown while picking a sketch plane. */
  private showAllBasePlanes = false;
  /** Command to resume after leaving a sketch started for it. */
  pendingAfterSketch: string | null = null;
  onDocumentChanged: (reason: string) => void = () => {};
  private simulationValues: Record<Id, number> = {};
  private simulationValues2: Record<Id, number> = {};
  private simulationJoint: Id | null = null;
  private simulationDirection = 1;
  private simulationSpeed = 1;
  private simulationFrame = 0;
  private simulationClock = 0;

  constructor() {
    this.kernel = new KernelClient();
  }

  mount(container: HTMLElement, hooks: AppHooks) {
    this.hooks = hooks;
    this.shell = buildShell(this.commands, hooks.menus);
    container.replaceChildren(this.shell.root);
    this.viewport = new Viewport(this, this.shell.viewport);
    try {
      this.renderer = new Renderer(this.viewport.canvas, this.readTheme());
    } catch (e) {
      this.shell.viewport.append(h('div', { class: 'viewport-empty' }, h('div', { class: 'pm-msg error' }, `3D graphics are not available: ${(e as Error).message}. Try another browser or enable hardware acceleration.`)));
      throw e;
    }
    this.renderer.onFrame = () => this.onFrame();
    this.renderer.onCamera = () => this.onCameraChange();
    this.colors = this.readColors();
    this.viewport.init();
    this.drawing = new DrawingWorkspace(this);
    this.buildSheetTabs();
    this.tree = new FeatureTree(this);
    this.flyout = new FeatureTree(this, true);
    this.buildFlyout();
    this.buildLeftTabs();
    this.buildRibbonTabs();
    this.buildHud();
    this.buildTaskPane();
    this.bindShell();
    this.store.on((reason) => this.onStoreChange(reason));
    this.selection.on((hoverOnly) => this.onSelectionChange(hoverOnly));
    this.commands.onChange(() => this.syncChrome());
    window.addEventListener('themechange', () => this.applyTheme());
    window.addEventListener('keydown', (e) => this.onKey(e));
    trackRegionFocus(() => this.focusRegions());
    // Whether focus last arrived from a click/tap (toolbar buttons keep focus
    // after a click) or from the keyboard.
    window.addEventListener('pointerdown', () => { this.pointerInput = true; }, true);
    window.addEventListener('keydown', () => { this.pointerInput = false; }, true);
    window.addEventListener('focusin', () => { this.focusByPointer = this.pointerInput; }, true);
    // A double click on OK closes the panel with its first click; the second
    // lands on what was under the panel (the part's name opens Part
    // Properties, a face edits its feature) and must not double-click that.
    // Tree rows are redrawn on click, so they are compared by their key.
    const clickTarget = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-key]')?.getAttribute('data-key') ?? t : null);
    let firstClick: unknown = null;
    window.addEventListener('mousedown', (e) => { if (e.detail <= 1) firstClick = clickTarget(e.target); }, true);
    window.addEventListener('dblclick', (e) => { if (clickTarget(e.target) !== firstClick) e.stopPropagation(); }, true);
    this.renderer.camera.setState(this.renderer.camera.fitState([0, 0, 0], 60));
    this.showLoading(true);
    this.bindKernelRecovery();
    this.kernel.ready.then(() => {
      this.kernelReady = true;
      this.showLoading(false);
      this.requestRebuild();
    }).catch((e) => {
      this.showLoading(false);
      toast({ kind: 'error', title: tr("Geometry engine failed to start"), message: `${(e as Error).message}. Reload the page to try again.`, timeout: 0 });
    });
    this.refreshAll();
  }

  private crashedBuildKey: string | null = null;
  private closeStallToast: (() => void) | null = null;

  /** Offers a restart when the geometry worker stops answering, and rebuilds on a restarted one. */
  private bindKernelRecovery() {
    this.kernel.onStall = (stalled) => {
      const close = this.closeStallToast;
      this.closeStallToast = null;
      close?.();
      if (!stalled) return;
      this.closeStallToast = toast({
        kind: 'warning', title: tr("The geometry engine is taking a long time"),
        message: tr("Large imports can take a few minutes. If it has stopped responding, restart it; your part is kept."),
        actions: [{ label: tr("Restart engine"), primary: true, run: () => this.kernel.restart() }, { label: tr("Keep waiting"), run: () => {} }],
      });
    };
    this.kernel.onRestart = (reason, building) => {
      toast({ kind: 'warning', title: tr("Geometry engine restarted"), message: `It was restarted because ${reason}. Rebuilding the part.` });
      // A rebuild cut short is retried by rebuild(); after anything else
      // (measure, export...) the new worker still needs the model.
      if (!building) this.requestRebuild(true);
    };
  }

  // ---------- theme ----------

  readTheme(): Theme {
    const c = (n: string) => cssColor(n);
    return {
      background: c('--viewport'), model: c('--model'), edge: c('--edge'), wire: c('--wire'), hiddenEdge: c('--hidden-edge'), selection: c('--selection'),
      hover: c('--hover-3d'), preview: c('--preview'), previewCut: c('--preview-cut'), cap: c('--cap'),
    };
  }

  readColors(): Colors {
    const c = (n: string) => cssColor(n);
    return {
      sketchUnder: c('--sketch-under'), sketchFull: c('--sketch-full'), sketchOver: c('--sketch-over'), sketchConstruction: c('--sketch-construction'), sketchExternal: c('--sketch-external'),
      sketchSelected: c('--sketch-selected'), hover: c('--hover-3d'), dimension: c('--dimension'), dimensionDriven: c('--dimension-driven'),
    };
  }

  applyTheme() {
    this.renderer.theme = this.readTheme();
    this.colors = this.readColors();
    this.applyModelColor();
    this.viewport.refreshStates();
    this.sketchEditor?.render();
    this.renderer.requestRender();
  }

  applyModelColor() {
    const c = this.store.doc.color;
    this.renderer.modelColor = c ? parseColor(c) : null;
    this.renderer.requestRender();
  }

  // ---------- chrome ----------

  private buildLeftTabs() {
    const tabs: [string, string, string][] = [['tree', 'tree', tr("Design tree")], ['pm', 'settings', tr("PropertyManager")]];
    // The tablist holds only the tabs; the phone sheet's close button sits beside it.
    const list = h('div', { class: 'lp-tablist', role: 'tablist', 'aria-label': tr("Panels") });
    for (const [id, ic, label] of tabs) {
      const b = h('button', { role: 'tab', type: 'button', 'aria-selected': String(id === this.leftTab), 'aria-controls': 'left-panel', 'aria-label': label, title: label, 'data-tab': id }, icon(ic, 16));
      b.addEventListener('click', () => this.showLeft(id as 'tree' | 'pm'));
      list.append(b);
    }
    tabKeys(list);
    this.shell.lpTabs.append(list, h('span', { class: 'grow' }));
    // Phones: the sheet can shrink to its tabs, title and OK/Cancel so the
    // preview of a feature being edited is visible above it.
    const peek = h('button', { class: 'icon-btn mobile-only lp-peek', type: 'button', 'aria-label': tr("Expand panel"), 'aria-expanded': 'true', 'aria-controls': 'left-panel' }, icon('chevronDown', 16));
    peek.addEventListener('click', () => this.setLeftPanePeek(!this.shell.leftpane.classList.contains('peek')));
    const close = h('button', { class: 'icon-btn mobile-only', type: 'button', 'aria-label': tr("Close panel") }, icon('close', 16));
    close.addEventListener('click', () => this.toggleLeftPane(false));
    this.shell.lpTabs.append(peek, close);
  }

  private setLeftPanePeek(peek: boolean) {
    this.shell.leftpane.classList.toggle('peek', peek);
    const b = this.shell.lpTabs.querySelector<HTMLElement>('.lp-peek');
    if (!b) return;
    b.setAttribute('aria-expanded', String(!peek));
    b.replaceChildren(icon(peek ? 'chevronUp' : 'chevronDown', 16));
  }

  showLeft(tab: 'tree' | 'pm') {
    this.leftTab = tab;
    selectTabs(this.shell.lpTabs, (b) => b.dataset.tab === tab);
    const body = this.shell.lpBody;
    if (tab === 'tree') {
      body.replaceChildren(this.tree.el);
      this.tree.render();
    } else if (this.panel) {
      if (this.panelFloating) {
        // Fusion floats command dialogs over the graphics area; the tree stays behind.
        this.shell.panelLayer.hidden = false;
        this.shell.panelLayer.replaceChildren(this.floatingElement(this.panel));
        body.replaceChildren(this.tree.el);
        this.tree.render();
        return;
      }
      body.replaceChildren(this.panelElement(this.panel));
    } else {
      body.replaceChildren(h('div', { class: 'pm-msg info', style: { margin: '12px' } }, tr("Start a command to see its properties here.")));
    }
  }

  toggleLeftPane(open?: boolean) {
    const lp = this.shell.leftpane;
    const v = open ?? !lp.classList.contains('open');
    lp.classList.toggle('open', v);
    if (!v) this.setLeftPanePeek(false);
    this.shell.treeToggle.setAttribute('aria-expanded', String(v));
  }

  /** Wraps a panel as a draggable floating command dialog. */
  private floatingElement(p: PropertyPanel): HTMLElement {
    const el = this.panelElement(p);
    el.classList.add('pm-float');
    const head = el.querySelector<HTMLElement>('.pm-head');
    if (head) {
      head.addEventListener('pointerdown', (ev) => {
        if ((ev.target as HTMLElement).closest('button')) return;
        ev.preventDefault();
        head.setPointerCapture(ev.pointerId);
        const layer = this.shell.panelLayer.getBoundingClientRect();
        const start = el.getBoundingClientRect();
        const base = { x: start.x - layer.x, y: start.y - layer.y };
        const move = (e: PointerEvent) => {
          const x = Math.max(0, Math.min(layer.width - 120, base.x + e.clientX - ev.clientX));
          const y = Math.max(0, Math.min(layer.height - 40, base.y + e.clientY - ev.clientY));
          el.style.left = x + 'px';
          el.style.top = y + 'px';
          el.style.right = 'auto';
        };
        const up = () => {
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', up);
          head.removeEventListener('pointercancel', up);
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
        head.addEventListener('pointercancel', up);
      });
    }
    return el;
  }

  private panelElement(p: PropertyPanel): HTMLElement {
    const head = h('div', { class: 'pm-head' }, icon(p.icon, 18), h('div', { class: 'title', role: 'heading', 'aria-level': '2', tabindex: '-1' }, p.title));
    const actions = h('div', { class: 'pm-actions' });
    if (p.confirm) {
      actions.append(
        h('button', { class: 'icon-btn ok', type: 'button', 'aria-label': tr("OK"), title: tr("OK (Enter)"), onclick: () => void this.closePanel(true) }, icon('check', 20)),
        h('button', { class: 'icon-btn cancel', type: 'button', 'aria-label': tr("Cancel"), title: tr("Cancel (Esc)"), onclick: () => void this.closePanel(false) }, icon('close', 20)),
      );
    } else {
      actions.append(h('button', { class: 'btn small', type: 'button', onclick: () => (p.onCloseClick ? p.onCloseClick() : void this.closePanel(false)) }, p.closeLabel));
    }
    const wrap = h('div', { class: 'pm' }, head, actions, p.mount());
    if (p.helpText) wrap.append(h('div', { class: 'pm-msg', style: { margin: '10px' } }, p.helpText));
    return wrap;
  }

  private buildRibbonTabs() {
    for (const t of this.hooks.ribbonTabs) {
      const b = h('button', { role: 'tab', type: 'button', 'aria-selected': String(t.id === this.ribbonTab), 'data-tab': t.id }, t.label);
      b.addEventListener('click', () => this.setRibbonTab(t.id));
      this.shell.cmTabs.append(b);
    }
    // The arrow keys skip the hidden tabs (the Drawing tab in the model, and the reverse).
    tabKeys(this.shell.cmTabs);
    this.setRibbonTab(this.ribbonTab);
  }

  setRibbonTab(id: string) {
    // Assembly commands live on their own tab, as in Fusion.
    if (id === 'assembly' && !this.isAssembly) id = 'features';
    if (id === 'features' && this.isAssembly) id = 'assembly';
    this.ribbonTab = id;
    for (const b of this.shell.cmTabs.querySelectorAll<HTMLElement>('[role="tab"]')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === id));
      // The drawing has its own tab; model tabs are hidden while it is open.
      // The assembly tab only shows for assemblies.
      const drawing = id === 'drawing';
      b.hidden = (b.dataset.tab === 'drawing') !== drawing || (b.dataset.tab === 'assembly' && !this.isAssembly);
    }
    syncTabStops(this.shell.cmTabs);
    const tab = this.hooks.ribbonTabs.find((t) => t.id === id)!;
    renderRibbon(this.shell.cmTools, tab, this.commands);
  }

  private buildHud() {
    const hud = this.shell.hud;
    const b = (cmd: string, extra = '') => {
      const el = this.commandIcon(cmd);
      if (extra) el.classList.add(extra);
      return el;
    };
    const split = (cmd: string, items: () => MenuItem[], label: string) => {
      const main = this.commandIcon(cmd);
      const caret = h('button', { class: 'icon-btn caret', type: 'button', 'aria-label': label, 'aria-haspopup': 'menu' }, icon('chevronDown', 12));
      caret.addEventListener('click', () => {
        const r = caret.getBoundingClientRect();
        openMenu(items(), r.left - 20, r.bottom + 4, { anchor: caret, label });
      });
      return h('div', { class: 'split' }, main, caret);
    };
    hud.append(
      b('zoomFit'), b('previousView', 'hide-mobile'), b('sectionView'),
      h('span', { class: 'sep' }),
      split('viewOrientation', () => this.viewMenuItems(), 'Standard views'),
      split('displayStyle', () => this.displayMenuItems(), 'Display style'),
      split('toggleVisibility', () => this.visibilityMenuItems(), tr("Hide or show items")),
      h('span', { class: 'sep hide-mobile' }),
      b('perspective', 'hide-mobile'), b('normalTo'),
    );
  }

  private commandIcon(cmd: string): HTMLButtonElement {
    const c = this.commands.get(cmd)!;
    const el = h('button', { class: 'icon-btn', type: 'button', 'aria-label': c.label, 'data-cmd': cmd }, icon(c.icon ?? 'settings', 18)) as HTMLButtonElement;
    el.addEventListener('click', () => this.commands.run(cmd));
    attachTooltip(el, c.label, c.shortcut, c.description);
    return el;
  }

  viewMenuItems(): MenuItem[] {
    // The standard view the model is seen from is checked, as the display style is.
    const current = this.renderer.camera.viewName();
    const v = (cmd: string): MenuItem => {
      const c = this.commands.get(cmd)!;
      const name = cmd === 'normalTo' ? null : cmd.slice(4).toLowerCase();
      return { label: c.label, icon: c.icon, shortcut: c.shortcut, ...(name ? { checked: name === current, radio: true } : {}), run: () => this.commands.run(cmd) };
    };
    return [v('viewFront'), v('viewBack'), v('viewLeft'), v('viewRight'), v('viewTop'), v('viewBottom'), { separator: true }, v('viewIsometric'), v('viewTrimetric'), v('viewDimetric'), { separator: true }, v('normalTo')];
  }

  displayMenuItems(): MenuItem[] {
    return ['shadedEdges', 'shaded', 'hiddenRemoved', 'hiddenVisible', 'wireframe'].map((s) => {
      const c = this.commands.get(`style:${s}`)!;
      return { label: c.label, icon: c.icon, checked: this.renderer.displayStyle === s, radio: true, run: () => this.commands.run(`style:${s}`) };
    });
  }

  visibilityMenuItems(): MenuItem[] {
    const t = (cmd: string): MenuItem => {
      const c = this.commands.get(cmd)!;
      return { label: c.label, checked: this.commands.isChecked(cmd), run: () => this.commands.run(cmd) };
    };
    return [t('showPlanes'), t('showOrigin'), t('showSketches'), t('showRelations'), t('showDimensions')];
  }

  flyout!: FeatureTree;
  private flyoutEl!: HTMLElement;
  private flyoutOpen = false;

  /** Compact design tree over the viewport while a PropertyManager is open. */
  private buildFlyout() {
    const toggle = h('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'flyout-tree-body' }, icon('chevronRight', 14), h('span', {}, tr("Part1")));
    const body = h('div', { class: 'ft-body', id: 'flyout-tree-body', hidden: true }, this.flyout.el);
    toggle.addEventListener('click', () => {
      this.flyoutOpen = !this.flyoutOpen;
      body.hidden = !this.flyoutOpen;
      toggle.setAttribute('aria-expanded', String(this.flyoutOpen));
      toggle.firstElementChild?.replaceWith(icon(this.flyoutOpen ? 'chevronDown' : 'chevronRight', 14));
      if (this.flyoutOpen) this.flyout.render();
    });
    this.flyoutEl = h('div', { class: 'flyout-tree', hidden: true }, toggle, body);
    this.shell.viewport.append(this.flyoutEl);
    // In a narrow graphics area the centred view toolbar would cover it.
    const ro = new ResizeObserver(() => this.placeFlyout());
    ro.observe(this.shell.viewport);
    ro.observe(this.shell.hud);
  }

  private placeFlyout() {
    const el = this.flyoutEl;
    if (el.hidden) return;
    el.classList.remove('below-hud');
    const a = el.firstElementChild!.getBoundingClientRect();
    const b = this.shell.hud.getBoundingClientRect();
    if (a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) el.classList.add('below-hud');
  }

  private updateFlyout() {
    const show = !!this.panel;
    this.flyoutEl.hidden = !show;
    const label = this.flyoutEl.querySelector('button > span');
    if (label) label.textContent = this.store.doc.name;
    this.placeFlyout();
    if (show && this.flyoutOpen) this.flyout.render();
  }

  renderTrees() {
    this.tree.render();
    if (this.panel && this.flyoutOpen) this.flyout.render();
  }

  private buildTaskPane() {
    // Filled by the task pane module (see taskpane.ts).
  }

  /** Opens a task pane panel by id (set up by the task pane module). */
  openTaskPane: (id: string) => void = () => {};
  toggleTaskPane: (id: string) => void = () => {};
  /** The open task pane panel, if any. */
  taskPaneOpen: () => string | null = () => null;

  openViewMenu() {
    const m = this.viewport.mouse;
    const r = this.shell.viewport.getBoundingClientRect();
    openMenu(this.viewMenuItems(), (m?.x ?? r.width / 2) + r.left, (m?.y ?? 60) + r.top, { label: tr("View orientation") });
  }

  openVisibilityMenu() {
    const r = this.shell.hud.getBoundingClientRect();
    openMenu(this.visibilityMenuItems(), r.left + r.width / 2, r.bottom + 4, { label: tr("Hide or show items") });
  }

  cycleDisplayStyle() {
    const order = ['shadedEdges', 'shaded', 'hiddenRemoved', 'hiddenVisible', 'wireframe'] as const;
    const i = order.indexOf(this.renderer.displayStyle);
    this.commands.run(`style:${order[(i + 1) % order.length]}`);
  }

  forceRebuild() {
    void this.kernel.reset().then(() => this.requestRebuild(true));
  }

  refreshPanel() {
    if (this.panel) this.showLeft('pm');
    else if (this.inDrawing && this.leftTab === 'pm') this.showDrawingPanel();
  }

  recentMenu(): MenuItem[] {
    return this.hooks.recent?.() ?? [];
  }

  showGettingStarted() {
    this.hooks.gettingStarted?.();
  }

  saveSettings() {
    this.hooks.saveSettings?.(this.settings);
  }

  /** Loads settings saved in the user's Puter account (set by main). */
  loadRemoteSettings: () => Promise<void> | void = () => {};

  /** Local choices take precedence over account reads already in flight. */
  changeSettings(patch: Partial<Settings>) {
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      this.settingChanges.set(key, (this.settingChanges.get(key) ?? 0) + 1);
    }
    this.applySettings(patch);
  }

  async loadSettings(read: () => Promise<unknown>) {
    const load = ++this.settingsLoad;
    const changes = new Map(this.settingChanges);
    const remote = await read();
    if (load !== this.settingsLoad || !remote || typeof remote !== 'object' || Array.isArray(remote)) return;
    const patch: Partial<Settings> = normalizeSettings(remote, this.settings);
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      if (changes.get(key) !== this.settingChanges.get(key)) delete patch[key];
    }
    this.applySettings(patch);
  }

  applySettings(s: unknown) {
    const quality = this.settings.quality;
    const grid = this.settings.showGrid;
    const snapGrid = this.settings.snapToGrid;
    this.settings = normalizeSettings(s, this.settings);
    if (quality !== this.settings.quality) this.requestRebuild();
    // The sketch palette shows both grid switches: keep them in step when the
    // View menu changes them.
    if (this.sketchEditor && (grid !== this.settings.showGrid || snapGrid !== this.settings.snapToGrid)) this.refreshSketchPanel();
    const v = this.viewport;
    v.showPlanes = this.settings.showPlanes;
    v.showOrigin = this.settings.showOrigin;
    v.showSketches = this.settings.showSketches;
    v.showGrid = this.settings.showGrid;
    v.invertZoom = this.settings.invertZoom;
    if (this.sketchEditor) {
      this.sketchEditor.showRelations = this.settings.showRelations;
      this.sketchEditor.showDimensions = this.settings.showDimensions;
      this.sketchEditor.render();
    }
    v.refreshStates();
    this.commands.changed();
  }

  /**
   * Phones: the assistant covers the workspace, so a ribbon command, the design
   * tree or the Model/Drawing tabs, which show something there, uncover it.
   * Only taps do: what the assistant itself opens leaves it open.
   */
  private uncoverWorkspace = (e: Event) => {
    if ((e.target as Element).closest('button') && this.taskPaneOpen() === 'assistant' && window.matchMedia('(max-width: 760px)').matches) this.toggleTaskPane('assistant');
  };

  private bindShell() {
    const s = this.shell;
    s.treeToggle.addEventListener('click', () => this.toggleLeftPane());
    s.treeToggle.addEventListener('click', this.uncoverWorkspace);
    s.cmTools.addEventListener('click', this.uncoverWorkspace);
    // Splitter resize.
    s.splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      s.splitter.setPointerCapture(e.pointerId);
      s.splitter.classList.add('dragging');
      const move = (ev: PointerEvent) => {
        const w = Math.max(200, Math.min(520, ev.clientX - s.leftpane.getBoundingClientRect().left));
        s.leftpane.style.width = `${w}px`;
        s.splitter.setAttribute('aria-valuenow', String(Math.round(w)));
      };
      const up = () => {
        s.splitter.classList.remove('dragging');
        s.splitter.removeEventListener('pointermove', move);
        s.splitter.removeEventListener('pointerup', up);
      };
      s.splitter.addEventListener('pointermove', move);
      s.splitter.addEventListener('pointerup', up);
    });
    s.splitter.addEventListener('keydown', (e) => {
      const w = s.leftpane.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') s.leftpane.style.width = `${Math.max(200, w - 20)}px`;
      if (e.key === 'ArrowRight') s.leftpane.style.width = `${Math.min(520, w + 20)}px`;
      s.splitter.setAttribute('aria-valuenow', String(Math.round(s.leftpane.getBoundingClientRect().width)));
    });
    // Command search.
    let active = 0;
    const results = s.searchResults;
    const show = () => {
      const list = this.commands.search(s.search.value);
      results.textContent = '';
      active = 0;
      list.forEach((c, i) => {
        const opt = h('div', { role: 'option', id: `cmdopt-${i}`, 'aria-selected': String(i === 0), 'aria-disabled': this.commands.isEnabled(c.id) ? null : 'true' },
          icon(c.icon ?? 'settings', 16), h('span', {}, c.label), c.shortcut ? h('span', { class: 'kbd' }, formatShortcut(c.shortcut)) : null);
        opt.addEventListener('pointerdown', (e) => { e.preventDefault(); run(c.id); });
        results.append(opt);
      });
      results.hidden = !list.length;
      s.search.setAttribute('aria-expanded', String(!!list.length));
      if (list.length) s.search.setAttribute('aria-activedescendant', 'cmdopt-0');
      else s.search.removeAttribute('aria-activedescendant');
    };
    const hide = () => {
      results.hidden = true;
      s.search.setAttribute('aria-expanded', 'false');
      s.search.removeAttribute('aria-activedescendant');
    };
    const run = (id: string) => {
      // A disabled result keeps the list open and the status bar says why nothing ran.
      if (!this.commands.isEnabled(id)) { this.setStatus(`${this.commands.get(id)?.label} is not available right now.`, true); return; }
      s.search.value = '';
      hide();
      s.search.blur();
      this.commands.run(id);
    };
    s.search.addEventListener('input', show);
    s.search.addEventListener('blur', () => setTimeout(hide, 120));
    s.search.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const opts = [...results.querySelectorAll<HTMLElement>('[role="option"]')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!opts.length) return;
        if (results.hidden) { show(); return; }
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % Math.max(1, opts.length);
        opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
        s.search.setAttribute('aria-activedescendant', `cmdopt-${active}`);
      } else if (e.key === 'Enter') {
        const list = this.commands.search(s.search.value);
        if (list[active]) run(list[active].id);
      } else if (e.key === 'Escape') {
        s.search.value = '';
        hide();
        s.search.blur();
      }
    });
    s.docTitle.addEventListener('click', () => this.commands.run('rename'));
  }

  // ---------- status ----------

  setStatus(text: string, flash = false) {
    clearTimeout(this.statusTimer);
    this.shell.statusMsg.textContent = text;
    if (flash) this.statusTimer = window.setTimeout(() => { this.shell.statusMsg.textContent = this.defaultStatus(); }, 5000);
  }

  /** Restores the default status, if `text` (when given) is what it shows. */
  clearStatus(text?: string) {
    if (text !== undefined && this.shell.statusMsg.textContent !== text) return;
    this.setStatus(this.defaultStatus());
  }

  private defaultStatus(): string {
    if (this.sketchEditor) return this.sketchEditor.tool?.hint ?? tr("Editing sketch. Select entities or pick a sketch tool.");
    if (this.panel) return this.panel.title;
    return tr("Ready");
  }

  updateSketchStatus() {
    const btn = this.shell.statusSketch;
    const ed = this.sketchEditor;
    if (!ed) { btn.hidden = true; return; }
    btn.hidden = false;
    const st = ed.solve?.status ?? 'under';
    btn.className = `cell status-${st}`;
    btn.textContent = `${ed.statusText()}${st === 'under' && ed.solve ? ` (${ed.solve.dof} DOF)` : ''}`;
    const cur = ed.cursorPt;
    if (cur) {
      const u = UNIT_SYSTEMS[this.store.doc.units];
      this.shell.statusCoords.textContent = `${(cur[0] / u.scale).toFixed(this.store.doc.decimals)}${u.length}  ${(cur[1] / u.scale).toFixed(this.store.doc.decimals)}${u.length}`;
    }
  }

  private syncChrome() {
    syncCommandButtons(this.shell.root, this.commands);
    const doc = this.store.doc;
    this.shell.docTitle.textContent = doc.name;
    this.shell.docTitle.setAttribute('aria-label', `${doc.name}, rename ${this.isAssembly ? tr("assembly") : tr("part")}`);
    this.shell.docState.textContent = this.store.dirty ? tr("Edited") : this.location ? tr("Saved") : '';
    this.shell.statusUnits.textContent = doc.units;
    document.title = `${this.store.dirty ? '* ' : ''}${doc.name} - Parametric`;
  }

  private showLoading(on: boolean) {
    if (on && !this.loadingEl) {
      this.loadingEl = h('div', { class: 'loading-kernel', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), tr("Loading the geometry engine..."));
      this.shell.viewport.append(this.loadingEl);
    } else if (!on && this.loadingEl) {
      this.loadingEl.remove();
      this.loadingEl = null;
    }
  }

  // ---------- document ----------

  newDocument(name?: string) {
    if (this.componentEdit) this.finishComponentEdit(false);
    this.closeDrawing();
    this.stopJointMotion(false);
    this.exitModes();
    const doc = newDocument(name ?? tr("Part1"), this.settings.defaultUnits);
    this.location = null;
    this.store.load(doc);
    this.selection.clear();
    this.renderer.camera.setState(this.renderer.camera.fitState([0, 0, 0], 60));
    this.viewport.setView('trimetric', false);
    this.lastBuildKey = '';
    this.hooks.afterLoad?.();
  }

  newAssembly(name?: string) {
    if (this.componentEdit) this.finishComponentEdit(false);
    this.closeDrawing();
    this.stopJointMotion(false);
    this.exitModes();
    const doc = newAssemblyDocument(name ?? tr("Assembly1"), this.settings.defaultUnits);
    this.location = null;
    this.store.load(doc);
    this.setRibbonTab('assembly');
    this.selection.clear();
    this.renderer.camera.setState(this.renderer.camera.fitState([0, 0, 0], 60));
    this.viewport.setView('trimetric', false);
    this.lastBuildKey = '';
    this.hooks.afterLoad?.();
  }

  get isAssembly(): boolean {
    return isAssembly(this.store.doc);
  }

  component(id: Id): AssemblyComponent | null {
    return this.store.doc.components?.find((c) => c.id === id) ?? null;
  }

  /** The joint whose travel is drawn (set by the Move panel while it is open). */
  visualJointId: Id | null = null;
  /** Geometry last clicked or right-clicked in an assembly, for smart fits. */
  assemblyPick: { kind: 'face' | 'edge'; index: number; componentId: Id } | null = null;
  /** The Move/Rotate panel shows the three-axis handle on the selected components. */
  showGizmo = false;
  /** Axis of the handle under the pointer, for the hover highlight. */
  gizmoAxis: 'x' | 'y' | 'z' | null = null;
  /** Axis of the rotation ring under the pointer, for the hover highlight. */
  gizmoRing: 'x' | 'y' | 'z' | null = null;

  /** Origin and length of the three-axis handle (null while it is hidden). */
  gizmoGeometry(): { o: Vec3; size: number } | null {
    if (!this.isAssembly || !this.showGizmo) return null;
    const ids = this.selection.ofKind('component').map((it) => it.id);
    if (!ids.length) return null;
    const solved = this.solvedComponentTransforms();
    const points = ids.map((id) => solved.get(id)?.position).filter((p): p is Vec3 => !!p);
    if (!points.length) return null;
    const o: Vec3 = [0, 0, 0];
    for (const p of points) { o[0] += p[0] / points.length; o[1] += p[1] / points.length; o[2] += p[2] / points.length; }
    const b = this.bbox;
    const diag = b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 100;
    return { o, size: Math.max(10, diag * 0.22) };
  }

  /** World pivot and direction of a joint plus its travel, for the range display. */
  jointRangeVisual(): { id: Id; p: Vec3; d: Vec3; min: number; max: number; value: number; angle: boolean } | null {
    if (!this.isAssembly) return null;
    const joints = this.store.doc.joints ?? [];
    const selected = this.selection.ofKind('assemblyJoint').map((it) => it.id);
    const joint = joints.find((j) => j.id === this.visualJointId) ?? joints.find((j) => selected.includes(j.id));
    if (!joint) return null;
    const solved = this.solvedComponentTransforms();
    const ref = joint.relativeTo ? solved.get(joint.relativeTo) : undefined;
    const base = ref ?? { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
    if (joint.aRef?.d) {
      const world = frameToWorld(base, { p: joint.aRef.p ?? [0, 0, 0], d: joint.aRef.d });
      return { id: joint.id, p: world.p, d: world.d, min: joint.min, max: joint.max, value: joint.value, angle: joint.type === 'revolute' || joint.type === 'ball' };
    }
    const dir: Vec3 = joint.axis === 'x' ? [1, 0, 0] : joint.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    return { id: joint.id, p: solved.get(joint.component)?.position ?? [0, 0, 0], d: dir, min: joint.min, max: joint.max, value: joint.value, angle: joint.type === 'revolute' || joint.type === 'ball' };
  }

  /** The transforms the assembly solver gives the components right now. */
  solvedComponentTransforms(): Map<Id, ComponentTransform> {
    return this.isAssembly ? assemblyTransforms(this.store.doc, this.jointOverrides()) : new Map();
  }

  /** Remembers the face or edge under the pointer for smart fit commands. */
  rememberAssemblyPick(item: SelItem | null) {
    if (!this.isAssembly || !item || (item.kind !== 'face' && item.kind !== 'edge')) {
      this.assemblyPick = null;
      return;
    }
    const component = this.componentOfItem(item);
    this.assemblyPick = component ? { kind: item.kind, index: item.index, componentId: component.id } : null;
  }

  /** The component a picked face or edge belongs to (assemblies tag them). */
  componentOfItem(item: SelItem | null): AssemblyComponent | null {
    if (!item) return null;
    const id = item.kind === 'face' ? this.faces[item.index]?.component
      : item.kind === 'edge' ? this.edges[item.index]?.component : undefined;
    if (!id) return null;
    // A sub-assembly part carries a path ("c3/c1") and a pattern copy a
    // suffix ("c2#2"): both belong to the top-level component.
    return this.component(id.split('/')[0].split('#')[0]);
  }

  /** True when a built face/edge owner is the component, a part of it or one of its pattern copies. */
  ownsComponent(owner: string | undefined, componentId: Id): boolean {
    return !!owner && owner.split('/')[0].split('#')[0] === componentId;
  }

  /**
   * The parts to build: a sub-assembly is flattened into its parts with their
   * placed transforms, each tagged with its path so picking maps back to the
   * component that was inserted.
   */
  private assemblyBuildComponents(transforms: Map<Id, ComponentTransform> | null): import('../kernel/protocol').AssemblyBuildComponent[] {
    const out: import('../kernel/protocol').AssemblyBuildComponent[] = [];
    const patterns = this.store.doc.componentPatterns ?? [];
    const walk = (
      components: AssemblyComponent[],
      parent: ComponentTransform | null,
      prefix: string,
      levelPatterns: typeof patterns,
      solvedHere: Map<Id, ComponentTransform> | null,
    ) => {
      for (const component of components) {
        if (component.suppressed) continue;
        const placed = !prefix && solvedHere
          ? solvedHere.get(component.id) ?? component.transform
          : parent ? composeTransform(parent, component.transform) : component.transform;
        const id = prefix ? `${prefix}/${component.id}` : component.id;
        // The seed plus one copy per pattern step, so instances need no
        // separate component documents and the BOM can count them.
        const emit = (instanceId: string, transform: ComponentTransform) => {
          const part = component.part;
          if (part.kind === 'assembly') {
            walk(part.components ?? [], transform, instanceId, part.componentPatterns ?? [], null);
            return;
          }
          const partStore = new DocStore(part);
          const partResolved = partStore.resolve();
          out.push({
            id: instanceId,
            name: component.name,
            features: partResolved.features,
            upTo: partStore.builtCount,
            blobs: part.blobs,
            transform,
            visible: component.visible,
          });
        };
        emit(id, placed);
        for (const pattern of patternsOf(levelPatterns, component.id)) {
          const axis = patternDir(pattern.axis ?? 'z');
          patternSteps(pattern).forEach((step, k) => {
            const turned = step.rotation ? rotateAbout(placed, [0, 0, 0], axis, step.rotation) : {
              position: [placed.position[0] + step.offset[0], placed.position[1] + step.offset[1], placed.position[2] + step.offset[2]] as ComponentTransform['position'],
              rotation: [...placed.rotation] as ComponentTransform['rotation'],
            };
            emit(`${id}#${k + 1}`, turned);
          });
        }
      }
    };
    walk(this.store.doc.components ?? [], null, '', patterns, transforms);
    // Exploded view: push every instance away from the assembly centre so the
    // parts separate without touching their stored transforms or joints.
    const explode = Number(this.store.doc.explode ?? 0);
    if (explode > 0 && out.length > 1) {
      const centre: [number, number, number] = [0, 0, 0];
      for (const entry of out) for (let i = 0; i < 3; i++) centre[i] += entry.transform.position[i];
      for (let i = 0; i < 3; i++) centre[i] /= out.length;
      for (const entry of out) {
        const delta: [number, number, number] = [
          entry.transform.position[0] - centre[0],
          entry.transform.position[1] - centre[1],
          entry.transform.position[2] - centre[2],
        ];
        const axis = this.store.doc.explodeAxis;
        const index = axis === 'x' ? 0 : axis === 'y' ? 1 : axis === 'z' ? 2 : -1;
        const length = Math.hypot(delta[0], delta[1], delta[2]);
        // Radial (default) pushes away from the centre; an axis pushes each part
        // to its own positive or negative side of that axis.
        const dir: [number, number, number] = axis
          ? [0, 0, 0]
          : length > 1e-9 ? [delta[0] / length, delta[1] / length, delta[2] / length] : [1, 0, 0];
        if (index === 0 || index === 1 || index === 2) dir[index] = delta[index] < 0 ? -1 : 1;
        entry.transform = {
          ...entry.transform,
          position: [
            entry.transform.position[0] + dir[0] * explode,
            entry.transform.position[1] + dir[1] * explode,
            entry.transform.position[2] + dir[2] * explode,
          ],
        };
      }
    }
    return out;
  }

  /**
   * In an assembly a click on a component's geometry selects the component,
   * like Fusion; panels that grip a face pick the face instead.
   */
  selectionItemFor(item: SelItem | null): SelItem | null {
    if (!this.isAssembly || !item || this.panel) return item;
    const component = this.componentOfItem(item);
    return component ? { kind: 'component', id: component.id } : item;
  }

  /** Faces of the selected and hovered components, for the whole-part highlight. */
  componentHighlightItems(bit: 'selected' | 'hover'): SelItem[] {
    if (!this.isAssembly) return [];
    const out: SelItem[] = [];
    const add = (it: SelItem | null) => {
      if (!it) return;
      if (it.kind === 'component') {
        for (let i = 0; i < this.faces.length; i++) {
          if (this.ownsComponent(this.faces[i].component, it.id)) out.push({ kind: 'face', index: i, name: this.faces[i].name });
        }
        return;
      }
      if (it.kind === 'face' || it.kind === 'edge') {
        const component = this.componentOfItem(it);
        if (!component) return;
        for (let i = 0; i < this.faces.length; i++) if (this.faces[i].component === component.id) out.push({ kind: 'face', index: i, name: this.faces[i].name });
      }
    };
    if (bit === 'selected') for (const it of this.selection.items) add(it);
    else add(this.selection.hover);
    return out;
  }

  openComponent(id: Id) {
    if (!this.component(id)) return;
    void import('./assembly').then(({ AssemblyComponentPanel }) => this.openPanel(new AssemblyComponentPanel(this, id)));
  }

  get inComponentEdit(): boolean {
    return !!this.componentEdit;
  }

  /** Fusion's New Part in an assembly: an empty in-place part, open for sketching. */
  newComponentPart() {
    if (!this.isAssembly || this.componentEdit) return;
    const components = this.store.doc.components ?? [];
    const used = new Set(components.map((c) => c.name));
    let n = 1;
    while (used.has(`Part${n}`)) n++;
    const name = `Part${n}`;
    const id = this.store.nextId('c');
    const part = newDocument(name, this.settings.defaultUnits);
    const wasDirty = this.store.dirty;
    this.store.change(tr("New component part"), (doc) => {
      doc.components ??= [];
      doc.components.push({
        id,
        name,
        part,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        visible: true,
        fixed: doc.components.length === 0,
      });
    });
    this.selection.set([{ kind: 'component', id }]);
    this.editComponentPart(id, true, wasDirty);
    toast({ kind: 'success', message: tr("{0} created. Sketch or build its features, then finish the part.", [name]) });
  }

  /**
   * Opens a component's part for editing on its own (Fusion's Activate Component
   * / Edit Part). The assembly document is kept aside and the part returns to
   * the component when the edit is finished.
   */
  editComponentPart(id: Id, created = false, assemblyDirty = this.store.dirty) {
    if (this.componentEdit || !this.isAssembly) return;
    const component = this.component(id);
    if (!component) return;
    this.closeDrawing();
    this.componentEdit = {
      assembly: this.store.doc,
      location: this.location,
      componentId: id,
      created,
      assemblyDirty,
    };
    this.exitModes();
    this.location = null;
    this.store.load(structuredClone(component.part));
    this.setRibbonTab('features');
    this.selection.clear();
    this.lastBuildKey = '';
    this.fitOnNextBuild = true;
    this.requestRebuild(true);
    this.showComponentBanner();
  }

  /** Returns to the assembly, writing the edited part into its component. */
  finishComponentEdit(apply = true): boolean {
    const edit = this.componentEdit;
    if (!edit) return false;
    this.closeDrawing();
    if (this.sketchEditor) this.exitSketch(true);
    const edited = this.store.doc;
    const partName = edited.name;
    this.componentEdit = null;
    this.hideComponentBanner();
    this.store.load(edit.assembly);
    this.setRibbonTab('assembly');
    this.location = edit.location;
    this.store.dirty = edit.assemblyDirty;
    if (apply) {
      this.store.change(tr("Edit component part"), (doc) => {
        const component = doc.components?.find((c) => c.id === edit.componentId);
        if (component) component.part = edited;
      });
    } else if (edit.created) {
      this.store.change(tr("Discard new part"), (doc) => {
        doc.components = (doc.components ?? []).filter((c) => c.id !== edit.componentId);
      });
      this.store.dirty = edit.assemblyDirty;
    }
    if (apply || !edit.created) this.selection.set([{ kind: 'component', id: edit.componentId }]);
    else this.selection.clear();
    this.lastBuildKey = '';
    this.fitOnNextBuild = true;
    this.requestRebuild(true);
    this.syncChrome();
    this.setStatus(apply ? tr("Finished editing {0} in the assembly.", [partName]) : tr("Discarded changes to {0}.", [partName]));
    return true;
  }

  /** Leaves a component part without writing it back, after confirming unsaved work. */
  async cancelComponentEdit(): Promise<boolean> {
    const edit = this.componentEdit;
    if (!edit) return false;
    if (this.store.dirty) {
      const discard = await confirmDialog(
        tr("Discard changes to {0}?", [this.store.doc.name]),
        tr("The part's changes will not be saved into the assembly."),
        tr("Discard"),
        true,
      );
      if (!discard || !this.componentEdit) return false;
    }
    return this.finishComponentEdit(false);
  }

  private showComponentBanner() {
    this.hideComponentBanner();
    const edit = this.componentEdit;
    if (!edit) return;
    const finish = h('button', { class: 'btn primary small', type: 'button' }, tr("Finish Part"));
    finish.addEventListener('click', () => this.finishComponentEdit(true));
    const cancel = h('button', { class: 'btn small', type: 'button' }, tr("Cancel Part"));
    cancel.addEventListener('click', () => void this.cancelComponentEdit());
    this.componentBanner = h('div', { class: 'component-banner', role: 'status' },
      h('span', { class: 'txt' }, tr("Editing {0} in {1}", [this.store.doc.name, edit.assembly.name])), finish, cancel);
    this.shell.viewport.append(this.componentBanner);
  }

  private hideComponentBanner() {
    this.componentBanner?.remove();
    this.componentBanner = null;
  }

  openMate(id: Id) {
    const mate = this.store.doc.mates?.find((m) => m.id === id);
    if (!mate) return;
    void import('./assembly').then(({ AssemblyMatePanel }) => this.openPanel(new AssemblyMatePanel(this, mate)));
  }

  openJoint(id: Id) {
    const joint = this.store.doc.joints?.find((j) => j.id === id);
    if (!joint) return;
    void import('./assembly').then(({ AssemblyJointPanel }) => this.openPanel(new AssemblyJointPanel(this, joint)));
  }

  updateComponent(id: Id, patch: { name?: string; transform?: ComponentTransform; visible?: boolean; fixed?: boolean }) {
    this.store.change(patch.name ? tr("Rename component") : tr("Move component"), (doc) => {
      const component = doc.components?.find((c) => c.id === id);
      if (!component) return;
      if (patch.name !== undefined) component.name = patch.name;
      if (patch.transform) {
        const delta: [number, number, number] = [
          patch.transform.position[0] - component.transform.position[0],
          patch.transform.position[1] - component.transform.position[1],
          patch.transform.position[2] - component.transform.position[2],
        ];
        component.transform = patch.transform;
        // Contact-set partners follow the same translation.
        const partnerSet = (doc.contactSets ?? []).find((set) => set.includes(id));
        for (const partnerId of partnerSet ?? []) {
          if (partnerId === id) continue;
          const partner = doc.components?.find((c) => c.id === partnerId);
          if (!partner) continue;
          partner.transform = {
            position: [
              partner.transform.position[0] + delta[0],
              partner.transform.position[1] + delta[1],
              partner.transform.position[2] + delta[2],
            ],
            rotation: [...partner.transform.rotation],
          };
        }
      }
      if (patch.visible !== undefined) component.visible = patch.visible;
      if (patch.fixed !== undefined) component.fixed = patch.fixed;
    });
  }

  /** The contact set a component belongs to, if any. */
  contactSetOf(id: Id): Id[] {
    return (this.store.doc.contactSets ?? []).find((set) => set.includes(id)) ?? [];
  }

  /** Puts the selected components into one contact set, so moving one moves them all. */
  createContactSet(ids: Id[]) {
    if (ids.length < 2) return;
    const set = [...new Set(ids)];
    this.store.change(tr("Contact set"), (doc) => {
      const rest = (doc.contactSets ?? []).filter((other) => !other.some((id) => set.includes(id)));
      doc.contactSets = [...rest, set];
    });
    toast({ kind: 'success', message: tr("{0} components move together now.", [String(set.length)]) });
  }

  clearContactSets() {
    if (!this.store.doc.contactSets?.length) return;
    this.store.change(tr("Clear contact sets"), (doc) => { delete doc.contactSets; });
  }

  /**
   * Moves several components at once. Called every frame of a drag inside a
   * batch, so the whole gesture stays one undo step. Contact-set partners of a
   * moving component follow with the same translation.
   */
  setComponentTransforms(transforms: Map<Id, ComponentTransform>, label = tr("Move components")) {
    if (!transforms.size) return;
    this.store.change(label, (doc) => {
      const moving = new Map<Id, ComponentTransform>();
      for (const [id, transform] of transforms) moving.set(id, transform);
      // Drag one member of a contact set and its partners come along.
      for (const [id, transform] of [...moving]) {
        const partnerSet = (doc.contactSets ?? []).find((set) => set.includes(id));
        if (!partnerSet) continue;
        const component = doc.components?.find((c) => c.id === id);
        if (!component) continue;
        const delta: [number, number, number] = [
          transform.position[0] - component.transform.position[0],
          transform.position[1] - component.transform.position[1],
          transform.position[2] - component.transform.position[2],
        ];
        for (const partnerId of partnerSet) {
          if (moving.has(partnerId)) continue;
          const partner = doc.components?.find((c) => c.id === partnerId);
          if (!partner) continue;
          moving.set(partnerId, {
            position: [
              partner.transform.position[0] + delta[0],
              partner.transform.position[1] + delta[1],
              partner.transform.position[2] + delta[2],
            ],
            rotation: [...partner.transform.rotation],
          });
        }
      }
      for (const [id, transform] of moving) {
        const component = doc.components?.find((c) => c.id === id);
        if (component) component.transform = { position: [...transform.position], rotation: [...transform.rotation] };
      }
    });
  }

  /**
   * Adds a joint made between picked geometry: the driven component is placed
   * where the joint puts it and constrained to follow the reference.
   */
  addGeometryJoint(joint: AssemblyJoint, placement: ComponentTransform) {
    this.store.change(tr("Add joint"), (doc) => {
      doc.joints ??= [];
      doc.joints.push(joint);
      const component = doc.components?.find((c) => c.id === joint.component);
      if (component) component.transform = { position: [...placement.position], rotation: [...placement.rotation] };
    });
  }

  deleteComponents(ids: Id[]) {
    if (!ids.length) return;
    const remove = new Set(ids);
    this.store.change(tr("Delete components"), (doc) => {
      doc.components = doc.components?.filter((c) => !remove.has(c.id));
      doc.mates = doc.mates?.filter((m) => !remove.has(m.a) && !remove.has(m.b));
      doc.joints = doc.joints?.filter((j) => !remove.has(j.component) && !(j.relativeTo && remove.has(j.relativeTo)));
    });
    this.selection.clear();
  }

  /** Swaps the part behind a component, keeping its name, position and joints. */
  replaceComponentPart(id: Id, part: PartDocument) {
    this.store.change(tr("Replace component"), (doc) => {
      const component = doc.components?.find((c) => c.id === id);
      if (component) component.part = part;
    });
  }

  /** Copies the given components, offset so the copies are visible, and selects them. */
  duplicateComponents(ids: Id[]) {
    if (!ids.length) return;
    const created: Id[] = [];
    this.store.change(tr("Duplicate components"), (doc) => {
      const used = new Set((doc.components ?? []).map((c) => c.name));
      for (const id of ids) {
        const source = doc.components?.find((c) => c.id === id);
        if (!source) continue;
        const newId = this.store.nextId('c');
        let n = 1;
        while (used.has(`${source.name}${n}`)) n++;
        const name = `${source.name}${n}`;
        used.add(name);
        const offset = 20 * n;
        doc.components ??= [];
        doc.components.push({
          ...structuredClone(source),
          id: newId,
          name,
          fixed: false,
          transform: {
            position: [source.transform.position[0] + offset, source.transform.position[1], source.transform.position[2]],
            rotation: [...source.transform.rotation],
          },
        });
        created.push(newId);
      }
    });
    if (created.length) this.selection.set(created.map((id) => ({ kind: 'component' as const, id })));
  }

  /** Suppresses (or resumes) the given components. */
  setComponentsSuppressed(ids: Id[], suppressed: boolean) {
    if (!ids.length) return;
    const picked = new Set(ids);
    this.store.change(suppressed ? tr("Suppress components") : tr("Unsuppress components"), (doc) => {
      for (const component of doc.components ?? []) {
        if (!picked.has(component.id)) continue;
        if (suppressed) component.suppressed = true;
        else delete component.suppressed;
      }
    });
  }

  /** Whether every given component is suppressed. */
  componentsSuppressed(ids: Id[]): boolean {
    return ids.length > 0 && ids.every((id) => !!this.component(id)?.suppressed);
  }

  /** Hides the given components (Fusion's Hide for a selection). */
  hideComponents(ids: Id[]) {
    if (!ids.length) return;
    const hide = new Set(ids);
    this.store.change(tr("Hide components"), (doc) => {
      for (const component of doc.components ?? []) if (hide.has(component.id)) component.visible = false;
    });
  }

  /** Hides every component except the given ones (Fusion's Isolate). */
  isolateComponents(ids: Id[]) {
    if (!ids.length) return;
    const keep = new Set(ids);
    this.store.change(tr("Isolate components"), (doc) => {
      for (const component of doc.components ?? []) component.visible = keep.has(component.id);
    });
  }

  /** Brings every hidden component back. */
  showAllComponents() {
    if (!(this.store.doc.components ?? []).some((c) => !c.visible)) return;
    this.store.change(tr("Show all components"), (doc) => {
      for (const component of doc.components ?? []) component.visible = true;
    });
  }

  updateComponentFixed(id: Id, fixed: boolean) {
    this.store.change(fixed ? tr("Fix component") : tr("Float component"), (doc) => {
      const component = doc.components?.find((c) => c.id === id);
      if (component) component.fixed = fixed;
    });
  }

  addMate(mate: AssemblyMate) {
    this.store.change(tr("Add assembly mate"), (doc) => {
      doc.mates ??= [];
      doc.mates.push(mate);
    });
  }

  replaceMate(mate: AssemblyMate) {
    this.store.change(tr("Edit assembly mate"), (doc) => {
      const index = doc.mates?.findIndex((m) => m.id === mate.id) ?? -1;
      if (index >= 0) doc.mates![index] = mate;
    });
  }

  deleteMate(id: Id) {
    this.store.change(tr("Delete assembly mate"), (doc) => {
      doc.mates = doc.mates?.filter((m) => m.id !== id);
    });
  }

  addJoint(joint: AssemblyJoint) {
    this.store.change(tr("Add joint"), (doc) => {
      doc.joints ??= [];
      doc.joints.push(joint);
    });
  }

  replaceJoint(joint: AssemblyJoint) {
    this.store.change(tr("Edit joint"), (doc) => {
      const index = doc.joints?.findIndex((j) => j.id === joint.id) ?? -1;
      if (index >= 0) doc.joints![index] = joint;
    });
  }

  deleteJoint(id: Id) {
    if (this.simulationJoint === id) this.stopJointMotion(false);
    this.store.change(tr("Delete joint"), (doc) => {
      doc.joints = doc.joints?.filter((j) => j.id !== id);
    });
    delete this.simulationValues[id];
    delete this.simulationValues2[id];
  }

  jointMotionValue(id: Id): number {
    const joint = this.store.doc.joints?.find((j) => j.id === id);
    if (!joint) return 0;
    return jointValue(joint, this.simulationValues[id]);
  }

  setJointMotionValue(id: Id, value: number) {
    const joint = this.store.doc.joints?.find((j) => j.id === id);
    if (!joint) return;
    this.cancelSimulationFrame();
    this.simulationJoint = null;
    this.simulationValues[id] = Math.max(joint.min, Math.min(joint.max, value));
    this.requestRebuild(true);
    this.commands.changed();
  }

  jointMotionValue2(id: Id): number {
    const joint = this.store.doc.joints?.find((j) => j.id === id);
    if (!joint) return 0;
    return Math.max(joint.min2 ?? -180, Math.min(joint.max2 ?? 180, this.simulationValues2[id] ?? joint.value2 ?? 0));
  }

  setJointMotionValue2(id: Id, value: number) {
    const joint = this.store.doc.joints?.find((j) => j.id === id);
    if (!joint) return;
    this.simulationValues2[id] = Math.max(joint.min2 ?? -180, Math.min(joint.max2 ?? 180, value));
    this.requestRebuild(true);
    this.commands.changed();
  }

  get motionRunning(): boolean {
    return !!this.simulationJoint;
  }

  startJointMotion(id: Id) {
    const joint = this.store.doc.joints?.find((j) => j.id === id);
    if (!joint || joint.max <= joint.min) return;
    if (!movableJoints(this.store.doc).some((j) => j.id === id)) {
      toast({ kind: 'warning', message: tr("Unfix the joint's component before running a motion study.") });
      return;
    }
    this.cancelSimulationFrame();
    this.simulationJoint = id;
    this.simulationValues[id] = jointValue(joint, this.simulationValues[id]);
    this.simulationDirection = this.simulationValues[id] >= joint.max ? -1 : 1;
    const span = Math.max(1e-9, joint.max - joint.min);
    this.simulationSpeed = span / 4;
    this.simulationClock = performance.now();
    const tick = (now: number) => {
      if (this.simulationJoint !== id) return;
      const currentJoint = this.store.doc.joints?.find((j) => j.id === id);
      if (!currentJoint) { this.stopJointMotion(false); return; }
      const dt = Math.min(0.1, Math.max(0, (now - this.simulationClock) / 1000));
      this.simulationClock = now;
      let value = this.simulationValues[id] + this.simulationDirection * this.simulationSpeed * dt;
      if (value >= currentJoint.max) { value = currentJoint.max; this.simulationDirection = -1; }
      else if (value <= currentJoint.min) { value = currentJoint.min; this.simulationDirection = 1; }
      this.simulationValues[id] = value;
      this.requestRebuild(true);
      this.simulationFrame = requestAnimationFrame(tick);
    };
    this.simulationFrame = requestAnimationFrame(tick);
    this.commands.changed();
  }

  stopJointMotion(restore = true) {
    this.cancelSimulationFrame();
    this.simulationJoint = null;
    this.simulationValues = {};
    this.simulationValues2 = {};
    if (restore) this.requestRebuild(true);
    this.commands.changed();
    this.refreshPanel();
  }

  private cancelSimulationFrame() {
    if (this.simulationFrame) cancelAnimationFrame(this.simulationFrame);
    this.simulationFrame = 0;
  }

  private jointOverrides() {
    const out: Record<Id, { value?: number; value2?: number }> = {};
    for (const id of new Set([...Object.keys(this.simulationValues), ...Object.keys(this.simulationValues2)])) {
      out[id] = { value: this.simulationValues[id], value2: this.simulationValues2[id] };
    }
    return out;
  }

  loadDocument(doc: import('../model/types').PartDocument, location: Location | null) {
    if (this.componentEdit) this.finishComponentEdit(false);
    this.closeDrawing();
    this.stopJointMotion(false);
    this.exitModes();
    this.location = location;
    this.store.load(doc);
    this.setRibbonTab(doc.kind === 'assembly' ? 'assembly' : 'features');
    this.selection.clear();
    this.lastBuildKey = '';
    this.fitOnNextBuild = true;
    this.renderer.camera.setState({ ...this.renderer.camera.state(), rot: VIEWS.trimetric });
    this.requestRebuild(true);
    this.hooks.afterLoad?.();
  }

  /** Frame the model once the next rebuild finishes (after opening a part). */
  private fitOnNextBuild = false;

  private onStoreChange(reason: string) {
    const unlinked = this.panel?.syncExpressions();
    if (unlinked != null) {
      this.showLeft('pm');
      if (unlinked.length) toast({ kind: 'warning', title: tr("Some pending equations were replaced by their values"), message: unlinked.join(', '), timeout: 9000 });
    }
    if (reason === 'load') {
      const previous = this.documentLifetime;
      this.documentLifetime = new AbortController();
      previous.abort();
      // A section belongs to the replaced part, not to the next document's geometry.
      this.renderer.section = null;
      this.applyModelColor();
      this.refreshAll();
    }
    if (reason === 'undo' || reason === 'redo') {
      // Rebuilding a focused field can emit change before it is detached.
      // Its pending value belongs to the state that history just replaced.
      for (const field of this.shell.lpBody.querySelectorAll<HTMLElement>('.sketch-dimension-field, .sketch-tool-options')) {
        retireNumberFields(field);
      }
      // Sketch edits undo inside the sketch; anything else leaves the editor in sync.
      if (this.sketchEditor && !this.store.feature(this.sketchEditor.sketchId)) this.exitModes();
      this.sketchEditor?.resolve();
      this.refreshSketchPanel();
    }
    if (reason !== 'sketch') this.requestRebuild();
    else {
      this.syncChrome();
      this.onDocumentChanged(reason);
      return;
    }
    this.renderTrees();
    this.syncChrome();
    this.commands.changed();
    if (this.inDrawing) {
      if (!this.store.doc.drawing) this.closeDrawing();
      else void this.drawing.refresh();
    }
    this.onDocumentChanged(reason);
  }

  refreshAll() {
    this.renderTrees();
    this.showLeft(this.panel ? 'pm' : 'tree');
    this.syncChrome();
    this.commands.changed();
    this.viewport.refreshStates();
  }

  // ---------- rebuild ----------

  requestRebuild(force = false) {
    if (force) this.lastBuildKey = '';
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    queueMicrotask(() => {
      this.rebuildQueued = false;
      this.rebuildsRunning++;
      void this.rebuild().finally(() => {
        if (--this.rebuildsRunning > 0 || this.rebuildQueued) return;
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const w of waiters) w();
      });
    });
  }

  private rebuildsRunning = 0;
  private idleWaiters: (() => void)[] = [];

  /** Resolves once the model shown reflects the document (no rebuild pending or running). */
  async whenBuilt(): Promise<void> {
    await this.kernel.ready.catch(() => undefined);
    if (!this.rebuildQueued && this.rebuildsRunning === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /** Number of features the model shows (rollback, sketch or edit position). */
  buildLimit(): number {
    let n = this.store.builtCount;
    if (this.sketchEditor) n = Math.min(n, this.store.indexOf(this.sketchEditor.sketchId));
    if (this.panel?.editingId) n = Math.min(n, this.store.indexOf(this.panel.editingId));
    return Math.max(0, n);
  }

  private async rebuild() {
    if (!this.kernelReady) return;
    const resolved = this.store.resolve();
    this.resolveErrors = resolved.errors;
    const upTo = this.buildLimit();
    let preview: Feature | null = null;
    if (this.panel) {
      const p = this.panel.preview();
      if (p) {
        // Evaluate preview parameters through a temporary store pass.
        const tmp = new DocStore({ ...this.store.doc, features: [...this.store.doc.features.slice(0, upTo), p] });
        preview = tmp.resolve().features[upTo] ?? p;
      }
    } else if (this.sketchEditor) {
      const sk = resolved.features.find((f) => f.id === this.sketchEditor!.sketchId) ?? null;
      preview = sk;
    }
    const assembly = isAssembly(this.store.doc);
    const transforms = assembly ? assemblyTransforms(this.store.doc, this.jointOverrides()) : null;
    const assemblyComponents = assembly ? this.assemblyBuildComponents(transforms) : undefined;
    const componentKey = assemblyComponents?.map((c) => ({ ...c, blobs: Object.keys(c.blobs) }));
    const key = JSON.stringify([upTo, this.settings.quality, preview, resolved.features.slice(0, upTo), componentKey]);
    if (key === this.lastBuildKey) return;
    this.lastBuildKey = key;
    const t0 = performance.now();
    const documentSignal = this.documentSignal;
    let res: BuildResult;
    try {
      res = await this.kernel.build({
        features: assembly ? [] : resolved.features,
        upTo: assembly ? 0 : upTo,
        blobs: assembly ? {} : this.store.doc.blobs,
        quality: this.settings.quality,
        preview: assembly ? null : preview,
        ...(assemblyComponents ? { components: assemblyComponents } : {}),
      });
      // A build of the part that was open before New or Open finishes first:
      // its body, errors and framing must not be shown for the new part.
      if (documentSignal.aborted) return;
    } catch (e) {
      if (documentSignal.aborted) return;
      if (e instanceof KernelRestartError) {
        // Retry once on the restarted worker; the same model stopping it
        // again is reported instead of restarting in a loop.
        if (this.crashedBuildKey !== key) {
          this.crashedBuildKey = key;
          this.requestRebuild(true);
        } else toast({ kind: 'error', title: tr("Rebuild failed"), message: tr("The geometry engine stopped again while rebuilding this part. Undo the last change or edit the part to try again."), timeout: 0 });
        return;
      }
      toast({ kind: 'error', title: tr("Rebuild failed"), message: (e as Error).message });
      return;
    }
    this.crashedBuildKey = null;
    // Coalesced requests all resolve with the same newest result: show it once.
    if (res === this.lastBuildResult) return;
    this.lastBuildResult = res;
    this.applyBuild(res, performance.now() - t0);
  }

  private lastBuildResult: BuildResult | null = null;

  /** Incremented after every rebuild (drawings re-project when it changes). */
  buildVersion = 0;
  drawing!: DrawingWorkspace;

  get inDrawing(): boolean {
    return !!this.drawing?.active;
  }

  /** Switches to the drawing sheet of this part (creating it if needed). */
  openDrawing() {
    this.exitModes();
    this.selection.clear();
    this.drawing.open();
    this.syncSheetTabs();
    this.setRibbonTab('drawing');
    this.showDrawingPanel();
    this.setStatus(tr("Drawing. Drag views to arrange them; export to PDF or SVG from the Drawing tab."));
    this.commands.changed();
  }

  closeDrawing() {
    if (!this.drawing.active) return;
    this.drawing.close();
    this.syncSheetTabs();
    this.setRibbonTab(this.isAssembly ? 'assembly' : 'features');
    this.showLeft('tree');
    this.setStatus(tr("Ready"));
    this.commands.changed();
  }

  private showDrawingPanel() {
    this.leftTab = 'pm';
    selectTabs(this.shell.lpTabs, (b) => b.dataset.tab === 'pm');
    this.shell.lpBody.replaceChildren(this.panelElement(new DrawingPanel(this, this.drawing)));
  }

  private sheetTabs!: HTMLElement;

  private buildSheetTabs() {
    const mk = (label: string, drawing: boolean) => {
      const b = h('button', { role: 'tab', type: 'button', 'aria-selected': String(!drawing) }, label);
      b.addEventListener('click', () => (drawing ? this.openDrawing() : this.closeDrawing()));
      return b;
    };
    this.sheetTabs = h('div', { class: 'sheet-tabs', role: 'tablist', 'aria-label': tr("Model or drawing") }, mk(tr("Model"), false), mk(tr("Drawing"), true));
    this.sheetTabs.addEventListener('click', this.uncoverWorkspace);
    // Opening the drawing projects the views, so the arrow keys only move focus.
    tabKeys(this.sheetTabs, { activate: false });
    this.shell.statusMsg.before(this.sheetTabs);
  }

  private syncSheetTabs() {
    const drawing = this.sheetTabs.querySelectorAll('[role="tab"]')[1];
    selectTabs(this.sheetTabs, (b) => (b === drawing) === this.inDrawing);
  }

  private applyBuild(res: BuildResult, ms: number) {
    this.buildVersion++;
    this.statuses = new Map(res.status.map((s) => [s.id, s]));
    for (const [id, err] of this.resolveErrors) {
      // A suppressed feature is not built, so its values are not used either.
      if (!this.store.feature(id)?.suppressed && !this.statuses.get(id)?.suppressed) this.statuses.set(id, { id, ok: false, error: err });
    }
    this.faces = res.faces;
    this.edges = res.edges;
    this.frames = res.frames;
    this.axes = res.axes ?? {};
    this.points = res.points ?? {};
    this.linkedSketches = res.sketches ?? {};
    this.bbox = res.bbox;
    this.bodyCount = res.bodies ?? 1;
    if (!res.meshUnchanged) {
      this.vertices = res.mesh?.vertices ?? new Float32Array(0);
      this.renderer.setModel(res.mesh, res.faces.length, res.edges.length);
    }
    if (this.fitOnNextBuild) {
      this.fitOnNextBuild = false;
      if (res.bbox) this.viewport.zoomToFit(false);
    }
    const r = res.bbox ? Math.hypot(res.bbox.max[0] - res.bbox.min[0], res.bbox.max[1] - res.bbox.min[1], res.bbox.max[2] - res.bbox.min[2]) : 100;
    this.renderer.camera.sceneRadius = Math.max(r, 100);
    const isCut = !!this.panel && (this.panel.preview() as { cut?: boolean } | null)?.cut === true;
    this.renderer.setPreview(res.preview, res.previewKind ?? 'tool', isCut);
    if (this.sketchEditor) {
      const fr = res.frames[this.sketchEditor.sketchId];
      if (fr) this.sketchEditor.frame = fr;
      // Projected geometry follows the model: put it where this build found its edges.
      this.sketchEditor.syncExternal(res.sketches?.[this.sketchEditor.sketchId] ?? null);
      this.sketchEditor.render();
    }
    this.selection.revalidate(res.faces, res.edges);
    this.panel?.onBuild(res);
    if (this.panel) this.syncCanvasValue();
    if (this.panel && res.previewError) this.panel.setMessage('error', res.previewError);
    else if (this.panel && res.previewWarning) this.panel.setMessage('warn', res.previewWarning);
    else if (this.panel && !res.previewError) this.panel.setMessage(null);
    this.shell.statusRebuild.textContent = `${Math.round(res.ms)} ms`;
    this.shell.statusRebuild.title = `Rebuild took ${Math.round(res.ms)} ms (${Math.round(ms)} ms including transfer)`;
    this.viewport.refreshStates();
    this.viewport.rehoverSoon();
    this.renderTrees();
    // Expression errors replace the kernel's view of the same feature.
    const errors = res.status.map((s) => this.statuses.get(s.id) ?? s).filter((s) => !s.ok);
    if (errors.length && !this.panel) {
      const f = this.store.feature(errors[0].id);
      this.setStatus(`Rebuild error in ${f?.name ?? tr("a feature")}: ${errors[0].error}`, true);
    }
    this.commands.changed();
    if (this.inDrawing) void this.drawing.refresh();
  }

  featureStatus(id: Id): FeatureStatus | null {
    return this.statuses.get(id) ?? null;
  }

  featureWarning(id: Id): string | null {
    return this.statuses.get(id)?.warning ?? null;
  }

  vertexAt(i: number): Vec3 | null {
    if (i * 3 + 2 >= this.vertices.length) return null;
    return [this.vertices[i * 3], this.vertices[i * 3 + 1], this.vertices[i * 3 + 2]];
  }

  get lastPickPoint(): Vec3 | null {
    return this.viewport.lastPoint;
  }

  get editingFeatureId(): Id | null {
    return this.panel?.editingId ?? this.sketchEditor?.sketchId ?? null;
  }

  // ---------- frames ----------

  frameOfPlane(ref: PlaneRef | null): Frame | null {
    if (!ref) return null;
    if (ref.kind === 'base') return BASE_FRAMES[ref.plane];
    if (ref.kind === 'feature') return this.frames[ref.id] ?? null;
    const f = this.faces.find((x) => x.name === ref.face.name);
    return f?.frame ?? null;
  }

  /**
   * A sketch's geometry as built: projected entities on their model edges as
   * the last rebuild found them. The stored geometry until a rebuild has seen
   * the sketch as it is now.
   */
  builtEntities(f: SketchFeature): SkEntity[] {
    const linked = this.linkedSketches[f.id]?.entities;
    if (!linked || linked.length !== f.entities.length || linked.some((e, i) => e.id !== f.entities[i].id || e.t !== f.entities[i].t)) return f.entities;
    return linked;
  }

  frameOfSketch(f: SketchFeature): Frame | null {
    return this.frames[f.id] ?? (f.plane.kind === 'base' ? BASE_FRAMES[f.plane.plane] : f.frame ?? null);
  }

  basePlaneVisible(k: BasePlane): boolean {
    void k;
    return this.showAllBasePlanes;
  }

  setPlanePicking(on: boolean) {
    this.showAllBasePlanes = on;
    this.viewport.refreshStates();
  }

  // ---------- selection ----------

  pickFilter(): PickFilter {
    if (this.panel) {
      const f = this.panel.filter();
      return { ...f, face: f.face || f.planarOnly, plane: f.plane };
    }
    if (this.sketchEditor) return { edge: true, vertex: true };
    // In an assembly a click picks the component through its surface, so
    // vertices and edges do not steal the click from the part.
    if (this.isAssembly) return { face: true };
    return { face: true, edge: true, vertex: true, plane: true };
  }

  /** Items highlighted because a panel references them. */
  extraHighlights(): SelItem[] {
    const out: SelItem[] = [];
    // Faces and edges are found again by name: the panel listed them before
    // the rebuild it previews (e.g. an edited feature's references) arrived.
    if (this.panel) for (const b of this.panel.boxes) for (const it of b.items) {
      const r = it.item?.kind === 'face' || it.item?.kind === 'edge' ? remapItem(it.item, this.faces, this.edges) : it.item;
      if (r) out.push(r);
    }
    return out;
  }

  private onSelectionChange(hoverOnly = false) {
    this.viewport.refreshStates(hoverOnly);
    // Pre-highlighting only changes the graphics: rebuilding the tree and the
    // PropertyManager on every hover would also throw away a rename or a
    // field being typed in.
    if (hoverOnly) { this.sketchEditor?.queueRender(); return; }
    this.renderTrees();
    this.sketchEditor?.queueRender();
    if (this.sketchEditor) this.refreshSketchPanel();
    this.commands.changed();
    const n = this.selection.items.length;
    if (!this.panel && !this.sketchEditor) {
      if (n === 1) this.setStatus(this.describe(this.selection.items[0]));
      else if (n > 1) this.setStatus(`${n} items selected`);
      else this.setStatus(tr("Ready"));
    }
  }

  describe(it: SelItem): string {
    const units = this.store.doc.units, dec = this.store.doc.decimals;
    switch (it.kind) {
      case 'face': {
        const f = this.faces[it.index];
        if (!f) return tr("Face");
        const owner = this.store.feature(f.feature);
        return tr('Face ({0}) of {1}  Area {2}² equivalent', [
          f.type, owner?.name ?? tr('the part'), formatLength(Math.sqrt(f.area), units, dec),
        ]);
      }
      case 'edge': {
        const e = this.edges[it.index];
        if (!e) return tr("Edge");
        return `Edge (${e.type})  Length ${formatLength(e.length, units, dec, true)}${e.radius ? `  Radius ${formatLength(e.radius, units, dec, true)}` : ''}`;
      }
      case 'vertex': return `Vertex  ${it.p.map((v) => formatLength(v, units, dec)).join(', ')}`;
      case 'plane': return it.ref.kind === 'base' ? BASE_PLANE_NAMES[it.ref.plane] : this.store.feature(it.ref.id)?.name ?? tr("Plane");
      case 'origin': return tr("Origin");
      case 'component': return this.component(it.id)?.name ?? tr("Component");
      case 'assemblyMate': return this.store.doc.mates?.find((m) => m.id === it.id)?.name ?? tr("Assembly Mate");
      case 'assemblyJoint': return this.store.doc.joints?.find((j) => j.id === it.id)?.name ?? tr("Joint");
      case 'feature': return this.store.feature(it.id)?.name ?? '';
      default: return '';
    }
  }

  onViewportClick(e: VPEvent) {
    closeMenus();
    const item = this.viewport.pickItem(e.x, e.y, this.pickFilter());
    this.rememberAssemblyPick(item);
    if (this.panel) {
      if (item && this.panel.onPick(item, e.shift || e.ctrl)) { this.viewport.refreshStates(); return; }
      if (!item) return;
    }
    if (this.sketchEditor) {
      // Model edges/vertices can be selected (e.g. for Convert Entities).
      if (item) {
        if (e.shift || e.ctrl) this.selection.toggle(item); else this.selection.set([item]);
        // With sketch geometry, a model edge or vertex can take constraints (it is projected first).
        this.sketchEditor.showQuickRelations(e);
      } else if (!e.shift && !e.ctrl) this.selection.clear();
      return;
    }
    if (!item) { if (!e.shift && !e.ctrl) this.selection.clear(); return; }
    const picked = this.selectionItemFor(item);
    if (!picked) return;
    if (e.shift || e.ctrl) this.selection.toggle(picked);
    else this.selection.set([picked]);
    if (this.selection.items.length) this.showContextToolbar(e);
  }

  onViewportDoubleClick(e: VPEvent) {
    if (this.panel || this.sketchEditor) return;
    const item = this.viewport.pickItem(e.x, e.y, { face: true, plane: true });
    const component = this.componentOfItem(item);
    if (component && this.isAssembly) {
      // Fusion: a double-click activates the component for in-place editing.
      this.selection.set([{ kind: 'component', id: component.id }]);
      this.editComponentPart(component.id);
      return;
    }
    if (item?.kind === 'face') {
      const f = this.faces[item.index];
      if (f) this.editFeature(f.feature);
    } else if (item?.kind === 'plane' && item.ref.kind === 'feature') this.editFeature(item.ref.id);
  }

  onViewportContextMenu(e: VPEvent, cx: number, cy: number) {
    const raw = this.viewport.pickItem(e.x, e.y, this.pickFilter());
    this.rememberAssemblyPick(raw);
    const item = this.selectionItemFor(raw);
    if (item && !this.selection.has(item) && !this.panel) this.selection.set([item]);
    const items = this.hooks.contextItems('viewport');
    if (items.length) openMenu(items, cx, cy, { label: tr("Context menu") });
  }

  openFeatureMenu(id: Id, x: number, y: number) {
    openMenu(this.hooks.contextItems('feature', id), x, y, { label: tr("Feature menu") });
  }

  openReferenceMenu(item: SelItem, x: number, y: number) {
    void item;
    openMenu(this.hooks.contextItems('reference'), x, y, { label: tr("Reference menu") });
  }

  openComponentMenu(id: Id, x: number, y: number) {
    openMenu(this.hooks.contextItems('component', id), x, y, { label: tr("Component menu") });
  }

  openMateMenu(id: Id, x: number, y: number) {
    openMenu(this.hooks.contextItems('assemblyMate', id), x, y, { label: tr("Assembly mate menu") });
  }

  openJointMenu(id: Id, x: number, y: number) {
    openMenu(this.hooks.contextItems('assemblyJoint', id), x, y, { label: tr("Joint menu") });
  }

  openDimensionMenu(id: Id, x: number, y: number) {
    openMenu(this.hooks.contextItems('viewport', id), x, y, { label: tr("Dimension menu") });
  }

  openRelationMenu(id: Id, x: number, y: number) {
    openMenu(this.hooks.contextItems('viewport', id), x, y, { label: tr("Constraint menu") });
  }

  private ctxToolbar: HTMLElement | null = null;

  /** Small toolbar of likely next commands near the cursor after selecting. */
  private showContextToolbar(e: VPEvent) {
    if (e.pointerType === 'touch') { this.hideContextToolbar(); return; }
    const buttons = this.hooks.quickActions()
      .map((a) => this.commands.get(a.cmd))
      .filter((c): c is NonNullable<typeof c> => !!c && this.commands.isEnabled(c.id))
      .map((c) => ({ icon: c.icon ?? 'settings', label: c.label, run: () => this.commands.run(c.id) }));
    this.showFloatingToolbar(buttons, e.x + 12, e.y - 52, tr("Quick actions"), 4000);
  }

  /**
   * Floating toolbar inside the viewport (context toolbar, shortcut bar,
   * quick relations). Keyboard: arrow keys move, Escape closes.
   */
  showFloatingToolbar(buttons: { icon: string; label: string; run: () => void; glyph?: SVGElement }[], x: number, y: number, label: string, autoHideMs = 0) {
    this.hideContextToolbar();
    if (!buttons.length) return;
    const bar = h('div', { class: 'ctx-toolbar', role: 'toolbar', 'aria-label': label });
    const els: HTMLButtonElement[] = [];
    for (const b of buttons) {
      const el = h('button', { class: 'icon-btn', type: 'button', 'aria-label': b.label, title: b.label, tabindex: els.length ? '-1' : '0' }, b.glyph ?? icon(b.icon, 18)) as HTMLButtonElement;
      el.addEventListener('click', () => { this.hideContextToolbar(); b.run(); });
      els.push(el);
      bar.append(el);
    }
    bar.addEventListener('keydown', (ev) => {
      const i = els.indexOf(document.activeElement as HTMLButtonElement);
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); els[(i + 1) % els.length].focus(); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.hideContextToolbar(); this.viewport.canvas.focus(); }
    });
    this.shell.viewport.append(bar);
    const w = this.shell.viewport.clientWidth, hgt = this.shell.viewport.clientHeight;
    const r = bar.getBoundingClientRect();
    bar.style.left = `${Math.max(4, Math.min(w - r.width - 4, x))}px`;
    bar.style.top = `${Math.max(4, Math.min(hgt - r.height - 4, y))}px`;
    this.ctxToolbar = bar;
    const hide = (ev: PointerEvent) => {
      if (!bar.contains(ev.target as Node)) { this.hideContextToolbar(bar); document.removeEventListener('pointerdown', hide, true); }
    };
    setTimeout(() => document.addEventListener('pointerdown', hide, true), 0);
    if (autoHideMs) setTimeout(() => { if (!bar.contains(document.activeElement)) this.hideContextToolbar(bar); }, autoHideMs);
  }

  /** Shortcut bar (S key): the most used commands for the current mode at the cursor. */
  openShortcutBar() {
    const ids = this.sketchEditor
      ? ['tool:line', 'tool:rectangle', 'tool:circle', 'tool:centerArc', 'tool:tangentArc', 'tool:spline', 'tool:point', 'tool:smartDimension', 'tool:trim', 'offset', 'convertEntities', 'mirrorEntities', 'construction', 'exitSketch']
      : ['sketch', 'extrude', 'extrudeCut', 'revolve', 'fillet', 'chamfer', 'shell', 'hole', 'linearPattern', 'mirror', 'plane', 'measure', 'zoomFit', 'normalTo'];
    const buttons = ids
      .map((id) => this.commands.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c && this.commands.isEnabled(c.id))
      .map((c) => ({ icon: c.icon ?? 'settings', label: c.label, run: () => this.commands.run(c.id) }));
    const m = this.viewport.mouse ?? { x: this.shell.viewport.clientWidth / 2 - 120, y: this.shell.viewport.clientHeight / 2 };
    this.showFloatingToolbar(buttons, m.x - 20, m.y - 20, tr("Shortcut bar"));
    (this.ctxToolbar?.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  hideContextToolbar(only?: HTMLElement) {
    if (only && this.ctxToolbar !== only) return;
    this.ctxToolbar?.remove();
    this.ctxToolbar = null;
  }

  // ---------- camera ----------

  private onFrame() {
    this.viewport.updateTriad();
  }

  onCameraChange() {
    this.sketchEditor?.onCamera();
    this.viewport.onCamera();
    this.valueHandle?.position();
  }

  // ---------- panels ----------

  async openPanel(p: PropertyPanel) {
    if (this.panel) await this.closePanel(false);
    this.hideContextToolbar();
    this.panel = p;
    this.panelFloating = !window.matchMedia('(max-width: 760px)').matches;
    // Opened from the design tree with the keyboard: the panel replaces the
    // tree, so keyboard focus moves to the panel instead of being lost.
    const fromPane = this.shell.leftpane.contains(document.activeElement);
    this.showLeft('pm');
    if (fromPane || document.activeElement === document.body) {
      (this.shell.panelLayer.querySelector<HTMLElement>('.pm-head .title') ?? this.shell.lpBody.querySelector<HTMLElement>('.pm-head .title'))?.focus();
    }
    this.shell.confirm.hidden = !p.confirm;
    this.renderConfirmCorner();
    this.setStatus(p.title);
    this.updateFlyout();
    this.viewport.refreshStates();
    this.toggleLeftPane(true);
    this.requestRebuild(true);
    this.syncCanvasValue();
    this.commands.changed();
  }

  async closePanel(ok: boolean) {
    const p = this.panel;
    if (!p) return;
    const fromPane = this.shell.leftpane.contains(document.activeElement);
    if (ok) {
      if (!p.checkFields()) return;
      let done = false;
      try {
        done = await p.ok();
      } catch (e) {
        p.setMessage('error', (e as Error).message);
        return;
      }
      if (!done) return;
    } else p.cancel();
    p.dispose();
    this.panel = null;
    this.panelFloating = false;
    this.shell.panelLayer.hidden = true;
    this.shell.panelLayer.replaceChildren();
    this.clearCanvasValue();
    if (ok) this.selection.clear();
    this.updateFlyout();
    this.renderer.setPreview(null);
    this.shell.confirm.hidden = !this.sketchEditor;
    this.renderConfirmCorner();
    if (this.sketchEditor) this.refreshSketchPanel();
    else {
      this.showLeft('tree');
      // Keyboard focus returns to the feature in the tree rather than being lost with the panel.
      const id = (p as { f?: Feature }).f?.id ?? p.editingId;
      if (fromPane || document.activeElement === document.body) {
        const item = (id && this.tree.el.querySelector<HTMLElement>(`[data-key="${CSS.escape(id)}"]`)) || this.tree.el.querySelector<HTMLElement>('.ti[tabindex="0"]');
        item?.focus();
      }
    }
    this.setStatus(this.defaultStatus());
    this.requestRebuild(true);
    this.viewport.refreshStates();
    this.commands.changed();
    if (window.matchMedia('(max-width: 760px)').matches) this.toggleLeftPane(false);
  }

  get inSketch(): boolean {
    return !!this.sketchEditor;
  }

  /**
   * Keeps the on-model value box in step with the open panel: shown when the
   * panel offers a value, updated in place (not re-created) so typing in it is
   * not interrupted by a rebuild.
   */
  syncCanvasValue() {
    const spec = this.panel?.canvasValue() ?? null;
    if (!spec) { this.clearCanvasValue(); return; }
    if (!this.valueHandle) this.valueHandle = new CanvasValueHandle(this, spec);
    else this.valueHandle.set(spec);
    this.valueHandle.position();
  }

  clearCanvasValue() {
    this.valueHandle?.dispose();
    this.valueHandle = null;
  }

  private renderConfirmCorner() {
    const c = this.shell.confirm;
    c.textContent = '';
    if (c.hidden) return;
    const sketchOnly = !this.panel && !!this.sketchEditor;
    const ok = h('button', { class: 'ok', type: 'button', 'aria-label': sketchOnly ? tr("Exit sketch") : tr("OK"), title: sketchOnly ? tr("Exit sketch") : tr("OK") }, icon(sketchOnly ? 'sketch' : 'check', 22));
    ok.addEventListener('click', () => { if (this.panel) void this.closePanel(true); else this.exitSketch(true); });
    const cancel = h('button', { class: 'cancel', type: 'button', 'aria-label': sketchOnly ? tr("Discard sketch changes") : tr("Cancel"), title: sketchOnly ? tr("Discard changes and exit sketch") : tr("Cancel") }, icon('close', 22));
    cancel.addEventListener('click', () => { if (this.panel) void this.closePanel(false); else void this.discardSketch(); });
    c.append(ok, cancel);
  }

  // ---------- sketch mode ----------

  private restoreSketch: (() => void) | null = null;
  private sketchLifetime: AbortController | null = null;

  /** Starts a new sketch on a plane or planar face. */
  startSketchOn(ref: PlaneRef) {
    const restore = this.store.restorePoint(tr("Sketch changes"));
    const undoFloor = this.store.undoMark;
    const id = this.store.nextId('s');
    const at = this.store.builtCount;
    const frame = this.frameOfPlane(ref);
    if (!frame) { toast({ kind: 'warning', message: tr("That plane is not available.") }); return; }
    this.store.change(tr("New sketch"), (doc) => {
      const sk = newSketch(id, defaultName(doc, 'sketch'), ref);
      sk.frame = frame;
      doc.features.splice(at, 0, sk);
      if (doc.rollback != null) doc.rollback = at + 1;
    });
    this.editSketch(id, restore, undoFloor);
  }

  /** Where undo stops while a sketch is edited: the steps from before it are out of sight. */
  private sketchUndoFloor = 0;

  /** Undo takes back only the open sketch's own changes (and its creation), not the features after it. */
  get canUndo(): boolean {
    return this.store.canUndo && !(this.sketchEditor && this.store.undoMark <= this.sketchUndoFloor);
  }

  /** Opens sketch editing (rolls the model back to just before the sketch). */
  editSketch(id: Id, restore?: () => void, undoFloor = this.store.undoMark) {
    const sk = this.store.feature<SketchFeature>(id);
    if (!sk) return;
    if (this.panel) void this.closePanel(false);
    if (this.sketchEditor) this.exitSketch(true);
    const frame = this.frameOfSketch(sk) ?? BASE_FRAMES.front;
    this.sketchEditor = new SketchEditor(this, id, frame);
    this.sketchLifetime = new AbortController();
    this.restoreSketch = restore ?? this.store.restorePoint(tr("Sketch changes"));
    this.sketchUndoFloor = undoFloor;
    this.viewport.tool = this.sketchEditor;
    this.selection.clear();
    this.selection.setHover(null);
    this.sketchEditor.showRelations = this.settings.showRelations;
    this.sketchEditor.showDimensions = this.settings.showDimensions;
    this.shell.confirm.hidden = false;
    this.renderConfirmCorner();
    this.setRibbonTab('sketch');
    this.refreshSketchPanel();
    // On phones the sheet would cover the lower half of the sketch (and the
    // OK corner); it slides away, as when a feature panel closes. The Tree
    // button brings the sketch PropertyManager back.
    if (window.matchMedia('(max-width: 760px)').matches) this.toggleLeftPane(false);
    if (this.settings.autoNormalTo) this.viewport.normalTo(frame);
    this.requestRebuild(true);
    this.renderTrees();
    this.commands.changed();
    this.setStatus(tr("Editing sketch. Pick a sketch tool or select entities."));
    announce(`Editing ${sk.name}`);
  }

  refreshSketchPanel(keepNumberField = false) {
    if (!this.sketchEditor || this.panel) return;
    if (this.leftTab !== 'pm' || !this.shell.lpBody.querySelector('.pm')) this.showLeft('pm');
    // A dimension value edit changes geometry and definition status, while
    // its controls stay the same. Keep them mounted through input/change so
    // typing, Tab navigation and clicks on neighboring controls can finish.
    const status = this.shell.lpBody.querySelector('.sketch-definition');
    if (keepNumberField && status && this.sketchEditor.solve) {
      status.replaceWith(sketchDefinitionStatus(this.sketchEditor.solve));
      return;
    }
    const p = this.hooks.sketchPanel();
    this.shell.lpBody.replaceChildren(this.panelElement(p));
  }

  /** Leaves sketch mode. */
  exitSketch(keep: boolean) {
    const ed = this.sketchEditor;
    if (!ed) return;
    // History may already have removed the sketch. Do not finish a pending
    // tool or rebuild its controls against geometry that no longer exists.
    if (this.store.feature(ed.sketchId)) ed.setTool(null);
    else ed.tool = null;
    ed.dispose();
    this.sketchEditor = null;
    this.sketchLifetime?.abort();
    this.sketchLifetime = null;
    this.restoreSketch = null;
    this.viewport.tool = null;
    this.shell.confirm.hidden = true;
    this.renderConfirmCorner();
    this.selection.clear();
    // Finishing a sketch leaves it selected as the profile for the next feature.
    const finished = keep ? this.store.feature(ed.sketchId) : null;
    if (finished) this.selection.set([{ kind: 'feature', id: finished.id }]);
    this.setRibbonTab(this.isAssembly ? 'assembly' : 'features');
    this.showLeft('tree');
    this.updateSketchStatus();
    this.shell.statusCoords.textContent = '';
    this.requestRebuild(true);
    this.commands.changed();
    this.setStatus(tr("Ready"));
    void keep;
    const next = this.pendingAfterSketch;
    this.pendingAfterSketch = null;
    if (next && keep && this.store.feature(ed.sketchId)) {
      this.selection.set([{ kind: 'feature', id: ed.sketchId }]);
      this.commands.run(next);
    }
  }

  /** Exit sketch discarding changes made since entering it. */
  async discardSketch() {
    const ed = this.sketchEditor;
    const signal = this.sketchLifetime?.signal;
    if (!ed || !signal) return;
    const ok = await confirmDialog(tr("Discard changes?"), tr("Leave the sketch and undo the changes made since you started editing it?"), tr("Discard changes"), true, signal);
    if (!ok || signal.aborted || this.sketchEditor !== ed) return;
    const restore = this.restoreSketch;
    this.exitSketch(false);
    restore?.();
  }

  exitModes() {
    if (this.panel) { this.panel.cancel(); this.panel.dispose(); this.panel = null; this.renderer.setPreview(null); }
    this.clearCanvasValue();
    if (this.sketchEditor) this.exitSketch(true);
    this.shell.confirm.hidden = true;
  }

  // ---------- feature operations ----------

  editFeature(id: Id) {
    const f = this.store.feature(id);
    if (!f) return;
    if (f.type === 'sketch') { this.editSketch(id); return; }
    const p = this.hooks.editFeaturePanel(f);
    if (p) void this.openPanel(p);
  }

  renameFeature(id: Id, name: string) {
    this.store.change(tr("Rename"), (doc) => {
      const f = doc.features.find((x) => x.id === id);
      if (f) f.name = name;
    });
  }

  /** Inserts a new feature at the rollback position. */
  insertFeature(f: Feature) {
    this.store.change(`Add ${f.name}`, (doc) => {
      const at = doc.rollback == null ? doc.features.length : doc.rollback;
      doc.features.splice(at, 0, f);
      if (doc.rollback != null) doc.rollback = at + 1;
    });
  }

  replaceFeature(f: Feature) {
    this.store.change(`Edit ${f.name}`, (doc) => {
      const i = doc.features.findIndex((x) => x.id === f.id);
      if (i >= 0) doc.features[i] = f;
    });
  }

  /** Moves a feature one step up (delta -1) or down (delta +1) in the tree. */
  moveFeature(id: Id, delta: -1 | 1) {
    this.store.change(delta < 0 ? tr("Move feature up") : tr("Move feature down"), (doc) => {
      const from = doc.features.findIndex((f) => f.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= doc.features.length) return;
      const [feature] = doc.features.splice(from, 1);
      doc.features.splice(to, 0, feature);
    });
  }

  async deleteFeatures(ids: Id[]) {
    const signal = this.documentSignal;
    const doc = this.store.doc;
    const del = new Set(ids);
    // Absorbed sketches go with their feature; dependents are listed.
    for (const id of ids) {
      const f = this.store.feature(id);
      if (f) for (const s of consumedSketches(f)) {
        const usedElsewhere = doc.features.some((x) => !del.has(x.id) && x.id !== id && consumedSketches(x).includes(s));
        if (!usedElsewhere) del.add(s);
      }
    }
    const dependents = doc.features.filter((f) => !del.has(f.id) && dependencies(f).some((d) => del.has(d)));
    const names = doc.features.filter((f) => del.has(f.id)).map((f) => f.name);
    if (!names.length) return;
    const msg = dependents.length
      ? `Delete ${names.join(', ')}? These features depend on it and will fail to rebuild: ${dependents.map((f) => f.name).join(', ')}.`
      : `Delete ${names.join(', ')}?`;
    if (!(await confirmDialog(tr("Delete"), msg, tr("Delete"), true, signal)) || signal.aborted) return;
    if (this.sketchEditor && del.has(this.sketchEditor.sketchId)) this.exitSketch(false);
    this.store.change(tr("Delete"), (d) => {
      const before = d.features.length;
      const builtBefore = this.store.builtCount;
      const removedBuilt = d.features.slice(0, builtBefore).filter((f) => del.has(f.id)).length;
      d.features = d.features.filter((f) => !del.has(f.id));
      if (d.rollback != null) d.rollback = Math.max(0, d.rollback - removedBuilt);
      void before;
    });
    this.selection.clear();
  }

  setRollback(index: number | null) {
    const n = this.store.doc.features.length;
    const v = index == null || index >= n ? null : Math.max(0, index);
    if (v === this.store.doc.rollback) return;
    this.store.change(tr("Rollback"), (doc) => { doc.rollback = v; });
  }

  toggleSuppress(ids: Id[], suppress?: boolean) {
    this.store.change(suppress === false ? tr("Unsuppress") : tr("Suppress"), (doc) => {
      for (const f of doc.features) if (ids.includes(f.id)) f.suppressed = suppress ?? !f.suppressed;
    });
  }

  toggleHidden(ids: Id[]) {
    this.store.change(tr("Hide/Show"), (doc) => {
      for (const f of doc.features) {
        if (!ids.includes(f.id)) continue;
        const consumed = doc.features.some((x) => consumedSketches(x).includes(f.id));
        const visible = f.hidden === false || (f.hidden === undefined && !(f.type === 'sketch' && consumed));
        f.hidden = visible;
      }
    });
  }

  // ---------- keyboard ----------

  private pointerInput = false;
  private focusByPointer = false;

  /** The window's regions, in F6 order. */
  private focusRegions(): FocusRegion[] {
    const s = this.shell;
    const part = (sel: string) => s.root.querySelector<HTMLElement>(sel)!;
    // The phone sheet slides away rather than hiding.
    const sheetClosed = window.matchMedia('(max-width: 760px)').matches && !s.leftpane.classList.contains('open');
    return [
      { el: part('.titlebar') },
      { el: part('.cm') },
      ...(sheetClosed ? [] : [{ el: s.leftpane, target: () => s.lpBody.querySelector<HTMLElement>('.ti[tabindex="0"]') ?? firstTabStop(s.lpBody) }]),
      { el: s.viewport, target: () => (this.inDrawing ? this.drawing.el : this.viewport.canvas) },
      { el: s.taskpane },
      { el: part('.statusbar') },
      // Notifications with buttons (Download a copy, Restart engine) are reachable too.
      ...[...document.querySelectorAll<HTMLElement>('body > .toasts')].map((el) => ({ el })),
    ];
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229 || dialogOpen()) return;
    const target = e.target as HTMLElement;
    // The Apps panel and puter.js's user menu (keys from its shadow root come
    // from the element) take their own keys: no shortcuts while focus is in them.
    if (target instanceof Element && target.closest('.apps-panel, puter-user-menu')) return;
    const inText = isTextInput(target);
    // F6 / Shift+F6 move between the window's regions, from text fields too.
    if (e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      closeMenus();
      cycleRegion(this.focusRegions(), document.activeElement, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      // A number field passes on an Esc it had nothing to take back for (pm.ts).
      if (inText && (e.defaultPrevented || !target.closest('.spin'))) return;
      closeMenus();
      this.hideContextToolbar();
      if (this.sketchEditor?.modifyOpen) { this.sketchEditor.closeModify(); return; }
      if (this.sketchEditor?.tool) {
        if (!this.sketchEditor.tool.cancel()) this.sketchEditor.setTool(null);
        e.preventDefault();
        return;
      }
      if (this.panel) { void this.closePanel(false); e.preventDefault(); return; }
      if (this.selection.items.length) { this.selection.clear(); e.preventDefault(); return; }
      return;
    }
    if (inText) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.commands.run('save'); }
      return;
    }
    if (target.closest('.tree') && ['Delete', 'Backspace', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2', 'Home', 'End'].includes(e.key)) return;
    if (target.closest('.menu')) return;
    // Enter and Space activate a control the keyboard moved to (and any in the
    // task pane); after a click they stay shortcuts (Repeat Last Command,
    // View Orientation), as they are everywhere else.
    if ((e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.metaKey && !e.altKey && target !== this.viewport.canvas
      && (!this.focusByPointer || target.closest('.taskpane'))
      && target.closest(e.key === ' ' ? `${ACTIVATES_ON_ENTER}, ${ACTIVATES_ON_SPACE}` : ACTIVATES_ON_ENTER)) return;
    // Enter finishes what a sketch tool is drawing (a spline, a line chain).
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && this.sketchEditor?.tool?.enter?.()) { e.preventDefault(); return; }
    if (e.key === 'Enter' && this.panel && !(target instanceof HTMLButtonElement)) {
      e.preventDefault();
      void this.closePanel(true);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && this.inDrawing) {
      if (this.drawing.deleteSelected()) { e.preventDefault(); return; }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
      if (this.sketchEditor?.deleteSelection()) { e.preventDefault(); return; }
      const feats = this.selection.ofKind('feature').map((x) => x.id);
      if (feats.length && !this.panel) { e.preventDefault(); void this.deleteFeatures(feats); return; }
    }
    if (target === this.viewport.canvas && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(e.key) && !(e.ctrlKey && /\d/.test(e.key))) return;
    const cmd = this.commands.match(e);
    if (cmd) {
      e.preventDefault();
      this.commands.run(cmd.id);
    }
  }

  // ---------- helpers ----------

  unitContext(): UnitContext {
    return { units: this.store.doc.units, decimals: this.store.doc.decimals, variables: () => this.variables() };
  }

  variables(): Map<string, number> {
    return evaluateVariables(configurationVariables(this.store.doc)).values;
  }

  /** Faces of the current selection as references. */
  selectedFaceRefs() {
    return this.selection.ofKind('face').map((s) => this.faces[s.index]).filter(Boolean).map(faceRef);
  }

  /** Plane reference for the current selection (plane or planar face). */
  selectedPlaneRef(): PlaneRef | null {
    const it = this.selection.items[0];
    if (!it) return null;
    if (it.kind === 'plane') return it.ref;
    if (it.kind === 'face') {
      const f = this.faces[it.index];
      if (f?.type === 'plane') return { kind: 'face', face: faceRef(f) };
    }
    if (it.kind === 'feature') {
      const f = this.store.feature(it.id);
      if (f?.type === 'plane') return { kind: 'feature', id: f.id };
    }
    return null;
  }

  /** Typical size used for default feature values (mm). */
  typicalSize(): number {
    const b = this.bbox;
    const s = this.sketchEditor?.bounds();
    const d = b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : s ? s.radius * 2 : 50;
    const unit = this.store.unitScale;
    // Round to a friendly number in display units.
    const v = Math.max(d / 4, unit);
    const mag = Math.pow(10, Math.floor(Math.log10(v / unit)));
    return Math.round(v / unit / mag) * mag * unit;
  }
}
