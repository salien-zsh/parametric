// Local-only project home in the style of Fusion's data panel: projects on the
// left, the selected project's parts in the main area. Nothing is uploaded.

import { UNIT_SYSTEMS } from '../model/units';
import type { UnitSystem } from '../model/types';
import { locationLabel, recentParts, sameLocation, type FileEntry, listParts } from '../platform/files';
import {
  activeProjectId, chooseLocalProjectFolder, createLocalProject, deleteLocalProject, listProjectParts,
  localPartKey, localProjects, onProjectsChanged, projectForPart, projectPartCounts, renameLocalProject,
  setActiveProject, setLocalProjectAutoSave, setLocalProjectPath, type LocalProject,
} from '../platform/workspace-library';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { confirmDialog, promptDialog, toast } from '../ui/overlay';
import { tr } from '../i18n';
import type { App } from './app';
import { EXAMPLES } from './examples';
import type { FileOps } from './fileops';
import { resourceCenterDialog } from './workspace-dialogs';

const dateText = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

export function buildStartHome(app: App, files: FileOps, onOpen: () => void): { el: HTMLElement; dispose: () => void } {
  let projectId: string | null = activeProjectId();
  let local: FileEntry[] = [];
  let folder: FileEntry[] = [];
  let disposed = false;
  const sidebar = h('nav', { class: 'home-side' });
  const main = h('main', { class: 'home-main' });
  const el = h('div', { class: 'start home' }, sidebar, main);

  const current = (): LocalProject | null => (projectId ? localProjects().find((p) => p.id === projectId) ?? null : null);

  const openEntry = async (entry: FileEntry) => {
    onOpen();
    await files.openLocation(entry.location, entry.name);
  };

  const projectParts = (project: LocalProject): FileEntry[] => {
    const browser = local.filter((entry) => {
      const key = localPartKey(entry.location);
      return !!key && projectForPart(key) === project.id;
    });
    return [...browser, ...folder].sort((a, b) => b.modified - a.modified);
  };

  const refresh = async () => {
    local = (await listParts().catch(() => [] as FileEntry[])).filter((p) => p.location.type === 'local');
    const project = current();
    folder = project?.path ? await listProjectParts(project).catch(() => [] as FileEntry[]) : [];
    if (!disposed) draw();
  };

  const createProject = async () => {
    const name = await promptDialog(tr("New Project"), tr("Project name"), '', (v) => (v.trim() ? null : tr("Enter a project name.")), app.documentSignal);
    if (name == null) return;
    let path: string | undefined;
    try {
      path = (await chooseLocalProjectFolder())?.path;
    } catch {
      // Browser: a project groups parts stored in this browser.
    }
    const project = createLocalProject(name.trim(), path);
    setActiveProject(project.id);
    projectId = project.id;
    await refresh();
  };

  const selectProject = async (id: string | null) => {
    projectId = id;
    if (id) setActiveProject(id);
    await refresh();
  };

  const newPart = async () => {
    if (projectId) setActiveProject(projectId);
    // The app starts with an empty untitled part: reuse it instead of Part2.
    const doc = app.store.doc;
    if (!app.location && !app.store.dirty && doc.features.length === 0 && doc.kind !== 'assembly') { onOpen(); return; }
    if (await files.newPart()) onOpen();
  };

  const newAssembly = async () => {
    if (!(await files.confirmDiscard(tr("start a new assembly")))) return;
    onOpen();
    app.newAssembly();
  };

  const chooseFolder = async (project: LocalProject) => {
    try {
      const chosen = await chooseLocalProjectFolder();
      if (!chosen) return;
      setLocalProjectPath(project.id, chosen.path);
      await refresh();
    } catch (e) {
      toast({ kind: 'error', message: (e as Error).message });
    }
  };

  const fileCard = (entry: FileEntry) => {
    const card = h('button', { class: 'home-card file', type: 'button', title: entry.name },
      h('div', { class: 'home-thumb' }, icon('part', 28)),
      h('div', { class: 'home-card-name' }, entry.name),
      h('div', { class: 'home-card-meta' }, `${locationLabel(entry.location)} · ${dateText(entry.modified)}`));
    card.addEventListener('click', () => void openEntry(entry));
    return card;
  };

  const drawSidebar = () => {
    sidebar.textContent = '';
    const counts = projectPartCounts();
    // One dropdown lists every local project; choosing one makes it current.
    const projectSelect = h('select', { class: 'input home-project-select', 'aria-label': tr("Current project") }) as HTMLSelectElement;
    const allOption = h('option', { value: '' }, `${tr("All Local Projects")} (${local.length})`) as HTMLOptionElement;
    allOption.selected = projectId === null;
    projectSelect.append(allOption);
    for (const p of localProjects()) {
      const option = h('option', { value: p.id, title: p.path ?? tr("Browser project") }, `${p.name} (${counts[p.id] ?? 0}) · ${dateText(p.modified)}`) as HTMLOptionElement;
      option.selected = projectId === p.id;
      projectSelect.append(option);
    }
    projectSelect.addEventListener('change', () => {
      const id = projectSelect.value;
      if (id) setActiveProject(id);
      void selectProject(id || null);
    });
    const create = h('button', { class: 'btn small home-new-project', type: 'button' }, icon('plus', 14), tr("New Project"));
    create.addEventListener('click', () => void createProject());
    const resources = h('button', { class: 'home-side-item', type: 'button' }, icon('files', 15), h('span', { class: 'home-side-name' }, tr("Part Resource Center")));
    resources.addEventListener('click', () => void resourceCenterDialog(app, files, () => onOpen()));
    sidebar.append(
      h('div', { class: 'home-brand' }, h('img', { src: './icon-128.png', alt: '' }), h('span', {}, tr("Parametric"))),
      h('div', { class: 'home-side-label' }, tr("My Projects")),
      projectSelect,
      create,
      h('div', { class: 'home-side-foot' }, resources, h('div', { class: 'home-side-note' }, tr("All projects are stored on this device. Nothing is uploaded."))),
    );
  };

  const overview = () => {
    const projects = localProjects();
    const head = h('div', { class: 'home-head' },
      h('div', {}, h('h1', {}, tr("My Projects")), h('p', { class: 'sub' }, tr("Local projects for parts and assemblies; choose a project when saving a part."))),
      h('div', { class: 'home-actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => void newPart() }, icon('new', 16), tr("New part")),
        h('button', { class: 'btn', type: 'button', onclick: () => void newAssembly() }, icon('part', 16), tr("New Assembly")),
        h('button', { class: 'btn', type: 'button', onclick: () => void createProject() }, icon('plus', 16), tr("New Project")),
        h('button', { class: 'btn', type: 'button', onclick: () => { onOpen(); void files.openFromDevice(); } }, icon('upload', 16), tr("Open from device")),
        h('button', { class: 'btn', type: 'button', onclick: () => { onOpen(); void files.open(); } }, icon('open', 16), tr("Open"))),
      h('div', { class: 'home-units' }, h('span', {}, tr("Units for new parts"))));
    const unitHolder = h('span', { class: 'home-unit-select' });
    (head.querySelector('.home-units') as HTMLElement).append(unitHolder);
    const select = h('select', { class: 'input', 'aria-label': tr("Units for the new part") }) as HTMLSelectElement;
    for (const u of Object.values(UNIT_SYSTEMS)) {
      const o = h('option', { value: u.id }, u.label) as HTMLOptionElement;
      if (u.id === app.settings.defaultUnits) o.selected = true;
      select.append(o);
    }
    select.addEventListener('change', () => { app.changeSettings({ defaultUnits: select.value as UnitSystem }); app.saveSettings(); });
    unitHolder.append(select);

    const cards: HTMLElement[] = projects.map((project) => {
      const card = h('button', { class: 'home-card project', type: 'button', title: project.name },
        h('div', { class: 'home-thumb' }, icon('files', 30)),
        h('div', { class: 'home-card-name' }, project.name),
        h('div', { class: 'home-card-meta' }, project.path ?? tr("Browser project")),
        h('div', { class: 'home-card-meta' }, tr("{0} part(s)", [projectParts(project).length])));
      card.addEventListener('click', () => void selectProject(project.id));
      return card;
    });
    const newCard = h('button', { class: 'home-card project new', type: 'button' },
      h('div', { class: 'home-thumb' }, icon('plus', 26)), h('div', { class: 'home-card-name' }, tr("New Project")));
    newCard.addEventListener('click', () => void createProject());
    const projectSection = projects.length
      ? h('div', { class: 'home-cards' }, ...cards, newCard)
      : h('div', { class: 'home-empty' }, h('p', {}, tr("No local projects yet. Create one to organise your parts.")));

    const recents = recentParts().slice(0, 8).filter((r) => r.location.type === 'local');
    const recentCards = recents.map((r) => {
      const card = h('button', { class: 'home-card file', type: 'button' },
        h('div', { class: 'home-thumb' }, icon('part', 28)),
        h('div', { class: 'home-card-name' }, r.name),
        h('div', { class: 'home-card-meta' }, locationLabel(r.location)));
      card.addEventListener('click', async () => {
        await files.openLocation(r.location, r.name);
        if (!recentParts().some((x) => sameLocation(x.location, r.location))) onOpen();
      });
      return card;
    });
    const recentSection = recentCards.length ? h('section', { class: 'home-section' }, h('h2', {}, tr("Recent")), h('div', { class: 'home-cards' }, ...recentCards)) : null;

    const exampleCards = EXAMPLES.map((ex) => {
      const card = h('button', { class: 'home-card file', type: 'button', title: ex.description },
        h('div', { class: 'home-thumb' }, icon('part', 28)),
        h('div', { class: 'home-card-name' }, ex.name),
        h('div', { class: 'home-card-meta' }, ex.description));
      card.addEventListener('click', async () => {
        if (!(await files.confirmDiscard(tr("open an example")))) return;
        onOpen();
        app.loadDocument(ex.make(), null);
      });
      return card;
    });
    main.append(head, projectSection, ...(recentSection ? [recentSection] : []),
      h('section', { class: 'home-section' }, h('h2', {}, tr("Examples")), h('div', { class: 'home-cards' }, ...exampleCards)));
  };

  const projectPage = (project: LocalProject) => {
    const parts = projectParts(project);
    const isActive = activeProjectId() === project.id;
    const back = h('button', { class: 'home-back', type: 'button' }, icon('chevronLeft', 16), tr("My Projects"));
    back.addEventListener('click', () => void selectProject(null));
    const newPartBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => void newPart() }, icon('new', 16), tr("New Part in Project"));
    const emptyNewPart = h('button', { class: 'btn primary', type: 'button', onclick: () => void newPart() }, icon('new', 16), tr("New Part in Project"));
    const folderBtn = h('button', { class: 'btn', type: 'button', onclick: () => void chooseFolder(project) }, icon('open', 16), project.path ? tr("Change Folder") : tr("Choose Project Folder"));
    const renameBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const next = await promptDialog(tr("Rename Project"), tr("Project name"), project.name, (v) => (v.trim() ? null : tr("Enter a project name.")), app.documentSignal);
      if (next?.trim()) { renameLocalProject(project.id, next.trim()); await refresh(); }
    } }, icon('edit', 16), tr("Rename"));
    const auto = h('input', { type: 'checkbox', checked: project.autoSave === true }) as HTMLInputElement;
    auto.addEventListener('change', () => setLocalProjectAutoSave(project.id, auto.checked));
    const setCurrent = isActive ? null : h('button', { class: 'btn small', type: 'button' }, icon('check', 14), tr("Set as Current Project"));
    setCurrent?.addEventListener('click', () => { setActiveProject(project.id); void refresh(); });
    const del = h('button', { class: 'btn danger small', type: 'button' }, icon('trash', 14), tr("Delete"));
    del.addEventListener('click', async () => {
      if (!(await confirmDialog(tr("Delete Project"), tr("Delete project \"{0}\"? Its parts remain on this device.", [project.name]), tr("Delete"), true, app.documentSignal))) return;
      deleteLocalProject(project.id);
      projectId = null;
      await refresh();
    });
    const crumb = h('div', { class: 'home-crumbs' }, back, h('span', {}, '/'), h('span', { class: 'home-crumb-current' }, project.name));
    const head = h('div', { class: 'home-head' },
      h('div', {}, h('h1', {}, project.name), h('p', { class: 'sub' }, project.path ?? tr("Browser project"), isActive ? ` · ${tr("Current project")}` : '')),
      h('div', { class: 'home-actions' }, newPartBtn, folderBtn, renameBtn),
      h('div', { class: 'home-actions' }, h('label', { class: 'check' }, auto, h('span', {}, tr("Auto-save changes"))), ...(setCurrent ? [setCurrent] : []), del));
    const partSection = parts.length
      ? h('div', { class: 'home-cards' }, ...parts.map((entry) => fileCard(entry)))
      : h('div', { class: 'home-empty' }, h('p', {}, tr("No parts in this project yet.")), emptyNewPart);
    const resource = h('button', { class: 'btn small', type: 'button', onclick: () => void resourceCenterDialog(app, files, () => onOpen()) }, icon('files', 14), tr("Part Resource Center"));
    const foot = h('div', { class: 'home-foot' },
      h('span', {}, tr("{0} local part(s). Projects organise browser parts and can also open a desktop project folder.", [parts.length])), resource);
    main.append(crumb, head, partSection, foot);
    if (parts.length) partSection.addEventListener('click', () => {});
  };

  const draw = () => {
    if (disposed) return;
    drawSidebar();
    main.textContent = '';
    const project = current();
    if (project) projectPage(project);
    else overview();
  };

  const offProjects = onProjectsChanged(() => void refresh());
  draw();
  void refresh();
  return {
    el,
    dispose: () => {
      disposed = true;
      offProjects();
    },
  };
}
