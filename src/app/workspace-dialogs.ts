// Project manager, parameter configurations and reusable part library.

import type { ParameterConfiguration } from '../model/types';
import { configurationVariables } from '../model/document';
import { uniqueId } from '../model/ids';
import { evaluateVariables } from '../model/expr';
import type { FileEntry } from '../platform/files';
import { deletePart, listParts } from '../platform/files';
import {
  assignPartToProject, createLocalProject, deleteLocalProject, deleteResource, localPartKey, localProjects,
  projectForPart, projectPartCounts, publishResource, readResource, renameLocalProject, resourceEntries,
  type PublishResourceInput,
} from '../platform/workspace-library';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { confirmDialog, promptDialog, showDialog, toast } from '../ui/overlay';
import type { App } from './app';
import type { FileOps } from './fileops';
import { tr } from '../i18n';

const localOnly = (parts: FileEntry[]) => parts.filter((p) => p.location.type === 'local');
const formatDate = (value: number) => value ? new Date(value).toLocaleDateString() : '';

export async function configurationsDialog(app: App) {
  const signal = app.documentSignal;
  const baseVariables = structuredClone(app.store.doc.variables);
  if (!baseVariables.length) {
    toast({ kind: 'warning', message: tr("Create at least one fx parameter before adding configurations.") });
    return;
  }
  const rows = structuredClone(app.store.doc.configurations ?? []);
  let active: string | null = app.store.doc.activeConfiguration ?? null;
  let selected: string | null = rows.find((c) => c.id === active)?.id ?? rows[0]?.id ?? null;
  const activeSelect = h('select', { class: 'input', 'aria-label': tr("Active configuration") }) as HTMLSelectElement;
  const nameInput = h('input', { class: 'input', spellcheck: 'false', 'aria-label': tr("Configuration name") }) as HTMLInputElement;
  const table = h('table', { class: 'table' });
  const valuesHost = h('div', { class: 'field-label' });

  const selectedRow = () => rows.find((c) => c.id === selected) ?? null;
  const draw = () => {
    activeSelect.textContent = '';
    activeSelect.append(h('option', { value: '' }, tr("Base configuration")));
    for (const c of rows) activeSelect.append(h('option', { value: c.id }, c.name));
    activeSelect.value = active ?? '';
    nameInput.value = selectedRow()?.name ?? '';
    nameInput.disabled = !selectedRow();
    table.textContent = '';
    const head = h('thead', {}, h('tr', {},
      h('th', {}, tr("Parameter")),
      h('th', {}, tr("Base")),
      ...rows.map((c) => h('th', {}, c.name || tr("Configuration"))),
    ));
    const body = h('tbody');
    const values = evaluateVariables(configurationVariables({ ...app.store.doc, configurations: rows, activeConfiguration: active })).values;
    for (const variable of baseVariables) {
      const cells: HTMLElement[] = [h('td', {}, variable.name), h('td', { class: 'num' }, variable.expr)];
      for (const config of rows) {
        const input = h('input', {
          class: 'input', value: config.overrides[variable.id] ?? '', spellcheck: 'false',
          'aria-label': tr("Value of {0} in {1}", [variable.name, config.name]),
        }) as HTMLInputElement;
        input.addEventListener('input', () => {
          if (input.value.trim()) config.overrides[variable.id] = input.value.trim();
          else delete config.overrides[variable.id];
        });
        cells.push(h('td', {}, input));
      }
      body.append(h('tr', {}, ...cells));
    }
    table.append(head, body);
    const result = Object.keys(currentOverrides()).length
      ? tr("{0} parameter override(s) in the selected configuration.", [Object.keys(currentOverrides()).length])
      : tr("Empty cells inherit the base parameter value.");
    valuesHost.textContent = values.size ? `${result} ${tr("Current parameter count: {0}", [values.size])}` : result;
  };

  const currentOverrides = () => selectedRow()?.overrides ?? {};
  activeSelect.addEventListener('change', () => {
    active = activeSelect.value || null;
    selected = active;
    draw();
  });
  nameInput.addEventListener('change', () => {
    const row = selectedRow();
    if (row) row.name = nameInput.value.trim() || row.name;
    draw();
  });
  const add = h('button', { class: 'btn small', type: 'button' }, icon('plus', 14), tr("Add Configuration"));
  add.addEventListener('click', () => {
    const used = new Set(rows.map((c) => c.id));
    const row: ParameterConfiguration = {
      id: uniqueId('config-', used),
      name: tr("Configuration {0}", [rows.length + 1]),
      overrides: Object.fromEntries(baseVariables.map((v) => [v.id, v.expr])),
    };
    rows.push(row);
    selected = row.id;
    active = row.id;
    draw();
  });
  const remove = h('button', { class: 'btn danger small', type: 'button' }, icon('trash', 14), tr("Delete Configuration"));
  remove.addEventListener('click', () => {
    const row = selectedRow();
    if (!row) return;
    rows.splice(rows.indexOf(row), 1);
    if (active === row.id) active = rows[0]?.id ?? null;
    selected = active;
    draw();
  });
  draw();

  const v = await showDialog({
    title: tr("Parameter Configurations"),
    wide: true,
    signal,
    body: [
      h('div', { class: 'row' }, h('label', { class: 'field-label' }, tr("Active configuration")), h('div', { class: 'grow' }, activeSelect)),
      h('div', { class: 'row' }, nameInput, add, remove),
      valuesHost,
      h('div', { style: { overflow: 'auto' } }, table),
      h('p', {}, tr("Each configuration can override any fx parameter with a value or expression. Missing values inherit the base configuration.")),
    ],
    buttons: [{ label: tr("Cancel"), value: 'cancel' }, { label: tr("Apply"), value: 'ok', primary: true }],
    onAction: (action) => {
      if (action !== 'ok') return;
      if (new Set(rows.map((c) => c.name.trim())).size !== rows.length) {
        toast({ kind: 'error', message: tr("Configuration names must be unique.") });
        return false;
      }
    },
  });
  if (v !== 'ok' || signal.aborted) return;
  app.store.change(tr("Update parameter configurations"), (doc) => {
    doc.configurations = rows;
    doc.activeConfiguration = active;
  });
}

export async function projectManagerDialog(app: App, files: FileOps, onPartOpened?: () => void) {
  let selectedProject = '__all';
  let closeDialog: ((value: string | null) => void) | null = null;
  const projectList = h('div', { class: 'file-list', style: { minWidth: '220px' } });
  const partHost = h('div', { class: 'grow', style: { minWidth: '0' } });
  const name = h('input', { class: 'input', placeholder: tr("New project name"), 'aria-label': tr("New project name") }) as HTMLInputElement;
  const status = h('div', { class: 'field-label', role: 'status' });
  let entries: FileEntry[] = [];

  const openPart = async (entry: FileEntry) => {
    closeDialog?.(null);
    onPartOpened?.();
    await files.openLocation(entry.location, entry.name);
  };

  const draw = () => {
    const projects = localProjects();
    const counts = projectPartCounts();
    const unassigned = entries.filter((p) => { const key = localPartKey(p.location); return !!key && !projectForPart(key); }).length;
    projectList.textContent = '';
    const item = (id: string, label: string, count: number) => {
      const b = h('button', { class: 'file-item', type: 'button', 'aria-pressed': String(selectedProject === id) },
        icon('files', 16), h('span', { class: 'txt' }, h('span', { class: 'n' }, label), h('span', { class: 'meta' }, tr("{0} part(s)", [count]))));
      b.addEventListener('click', () => { selectedProject = id; draw(); });
      if (selectedProject === id) b.style.borderColor = 'var(--accent)';
      return b;
    };
    projectList.append(
      item('__all', tr("All Local Parts"), entries.length),
      item('__unassigned', tr("Unassigned"), unassigned),
      ...projects.map((p) => item(p.id, p.name, counts[p.id] ?? 0)),
    );

    const visible = entries.filter((entry) => {
      const key = localPartKey(entry.location);
      if (!key) return false;
      const project = projectForPart(key);
      if (selectedProject === '__all') return true;
      if (selectedProject === '__unassigned') return !project;
      return project === selectedProject;
    });
    const project = projects.find((p) => p.id === selectedProject);
    partHost.textContent = '';
    partHost.append(h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: '0' } }, project?.name ?? (selectedProject === '__unassigned' ? tr("Unassigned") : tr("All Local Parts"))),
      project ? h('button', {
        class: 'btn small', type: 'button', onclick: async () => {
          const next = await promptDialog(tr("Rename Project"), tr("Project name"), project.name, (value) => value.trim() ? null : tr("Enter a project name."), app.documentSignal);
          if (next?.trim()) { renameLocalProject(project.id, next); draw(); }
        },
      }, icon('edit', 14), tr("Rename")) : null,
      project ? h('button', {
        class: 'btn danger small', type: 'button', onclick: async () => {
          if (!(await confirmDialog(tr("Delete Project"), tr("Delete project \"{0}\"? Its parts remain in this browser.", [project.name]), tr("Delete"), true, app.documentSignal))) return;
          deleteLocalProject(project.id);
          selectedProject = '__all';
          draw();
        },
      }, icon('trash', 14), tr("Delete")) : null));
    const table = h('table', { class: 'table' }, h('thead', {}, h('tr', {},
      h('th', {}, tr("Part")), h('th', {}, tr("Project")), h('th', {}, tr("Modified")), h('th', {}, tr("Actions")),
    )));
    const body = h('tbody');
    for (const entry of visible) {
      const key = localPartKey(entry.location)!;
      const select = h('select', { class: 'input', 'aria-label': tr("Project for {0}", [entry.name]) }) as HTMLSelectElement;
      select.append(h('option', { value: '' }, tr("Unassigned")), ...projects.map((p) => h('option', { value: p.id }, p.name)));
      select.value = projectForPart(key) ?? '';
      select.addEventListener('change', () => { assignPartToProject(key, select.value || null); draw(); });
      const open = h('button', { class: 'btn small', type: 'button' }, icon('open', 14), tr("Open"));
      open.addEventListener('click', () => void openPart(entry));
      const del = h('button', { class: 'btn danger small', type: 'button' }, icon('trash', 14), tr("Delete"));
      del.addEventListener('click', async () => {
        if (!(await confirmDialog(tr("Delete Part"), tr("Delete \"{0}\" from this browser? This cannot be undone.", [entry.name]), tr("Delete"), true, app.documentSignal))) return;
        await deletePart(entry.location);
        entries = entries.filter((p) => p !== entry);
        draw();
      });
      body.append(h('tr', {}, h('td', {}, entry.name), h('td', {}, select), h('td', {}, formatDate(entry.modified)), h('td', {}, open, ' ', del)));
    }
    if (!visible.length) body.append(h('tr', {}, h('td', { colspan: '4' }, tr("No parts in this project."))));
    table.append(body);
    partHost.append(table);
    status.textContent = tr("{0} local part(s). Projects organise files without moving or changing them.", [entries.length]);
  };

  const add = h('button', { class: 'btn small', type: 'button' }, icon('plus', 14), tr("Create Project"));
  add.addEventListener('click', () => {
    const project = createLocalProject(name.value || tr("Untitled Project"));
    name.value = '';
    selectedProject = project.id;
    draw();
  });
  const refresh = h('button', { class: 'btn small', type: 'button' }, icon('files', 14), tr("Refresh"));
  refresh.addEventListener('click', async () => {
    entries = localOnly(await listParts());
    draw();
  });
  entries = localOnly(await listParts());
  draw();
  await showDialog({
    title: tr("Local Project Manager"),
    wide: true,
    signal: app.documentSignal,
    body: [
      h('div', { class: 'row' }, name, add, refresh),
      h('div', { class: 'row', style: { alignItems: 'stretch' } }, projectList, partHost),
      status,
    ],
    buttons: [{ label: tr("Close"), value: 'close', primary: true }],
    onReady: (close) => { closeDialog = close; },
  });
}

async function publishDialog(app: App): Promise<boolean> {
  const doc = app.store.doc;
  if (!doc.variables.length && !(doc.configurations?.length)) {
    toast({ kind: 'error', message: tr("Add fx parameters or a configuration before publishing this part to the library.") });
    return false;
  }
  const name = h('input', { class: 'input', value: doc.name, 'aria-label': tr("Library part name") }) as HTMLInputElement;
  const category = h('input', { class: 'input', value: tr("General"), 'aria-label': tr("Library category") }) as HTMLInputElement;
  const description = h('textarea', { class: 'input', rows: '3', 'aria-label': tr("Library description") }) as HTMLTextAreaElement;
  const err = h('div', { class: 'field-label', role: 'alert', style: { color: 'var(--danger)' } });
  const result = await showDialog({
    title: tr("Publish to Part Library"),
    signal: app.documentSignal,
    body: [
      h('label', { class: 'field-label' }, tr("Part name")), name,
      h('label', { class: 'field-label' }, tr("Category")), category,
      h('label', { class: 'field-label' }, tr("Description")), description,
      h('p', {}, tr("The library stores this parameterized part with its fx parameters and configurations.")),
      err,
    ],
    buttons: [{ label: tr("Cancel"), value: 'cancel' }, { label: tr("Publish"), value: 'ok', primary: true }],
    onAction: (value) => {
      if (value === 'ok' && !name.value.trim()) { err.textContent = tr("Enter a part name."); return false; }
    },
  });
  if (result !== 'ok') return false;
  try {
    const input: PublishResourceInput = { name: name.value, category: category.value, description: description.value };
    await publishResource(doc, input);
    toast({ kind: 'success', message: tr("\"{0}\" was published to the part library.", [name.value.trim()]) });
    return true;
  } catch (e) {
    toast({ kind: 'error', message: (e as Error).message });
    return false;
  }
}

export async function publishCurrentPart(app: App): Promise<boolean> {
  return publishDialog(app);
}

export async function resourceCenterDialog(app: App, files: FileOps, onPartOpened?: () => void) {
  let query = '';
  let category = '';
  let closeDialog: ((value: string | null) => void) | null = null;
  const search = h('input', { class: 'input', placeholder: tr("Search the part library"), 'aria-label': tr("Search the part library") }) as HTMLInputElement;
  const categorySelect = h('select', { class: 'input', 'aria-label': tr("Library category") }) as HTMLSelectElement;
  const host = h('div');
  const draw = () => {
    const all = resourceEntries();
    const categories = [...new Set(all.map((r) => r.category))].sort();
    categorySelect.textContent = '';
    categorySelect.append(h('option', { value: '' }, tr("All Categories")), ...categories.map((c) => h('option', { value: c }, c)));
    categorySelect.value = category;
    const q = query.trim().toLowerCase();
    const rows = all.filter((r) => (!category || r.category === category) &&
      (!q || `${r.name} ${r.description} ${r.parameters.join(' ')}`.toLowerCase().includes(q)));
    host.textContent = '';
    if (!rows.length) {
      host.append(h('p', {}, tr("No published parts match this search.")));
      return;
    }
    const table = h('table', { class: 'table' }, h('thead', {}, h('tr', {},
      h('th', {}, tr("Part")), h('th', {}, tr("Category")), h('th', {}, tr("Parameters")), h('th', {}, tr("Configurations")), h('th', {}, tr("Actions")),
    )));
    const body = h('tbody');
    for (const entry of rows) {
      const open = h('button', { class: 'btn small', type: 'button' }, icon('open', 14), tr("Open Copy"));
      open.addEventListener('click', async () => {
        try {
          const doc = await readResource(entry);
          closeDialog?.(null);
          if (!(await files.confirmDiscard(tr("open a library part")))) return;
          onPartOpened?.();
          doc.name = entry.name;
          doc.created = Date.now();
          doc.modified = Date.now();
          app.loadDocument(doc, null);
        } catch (e) {
          toast({ kind: 'error', message: (e as Error).message });
        }
      });
      const del = h('button', { class: 'btn danger small', type: 'button' }, icon('trash', 14), tr("Delete"));
      del.addEventListener('click', async () => {
        if (!(await confirmDialog(tr("Delete Library Part"), tr("Delete \"{0}\" from the library?", [entry.name]), tr("Delete"), true, app.documentSignal))) return;
        await deleteResource(entry.id);
        draw();
      });
      body.append(h('tr', {},
        h('td', {}, h('div', {}, entry.name), entry.description ? h('div', { class: 'field-label' }, entry.description) : null),
        h('td', {}, entry.category),
        h('td', {}, entry.parameters.length ? entry.parameters.join(', ') : '—'),
        h('td', { class: 'num' }, String(entry.configurationCount)),
        h('td', {}, open, ' ', del),
      ));
    }
    table.append(body);
    host.append(table);
  };
  search.addEventListener('input', () => { query = search.value; draw(); });
  categorySelect.addEventListener('change', () => { category = categorySelect.value; draw(); });
  const publish = h('button', { class: 'btn primary small', type: 'button' }, icon('plus', 14), tr("Publish Current Part"));
  publish.addEventListener('click', async () => { if (await publishDialog(app)) draw(); });
  draw();
  await showDialog({
    title: tr("Part Resource Center"),
    wide: true,
    signal: app.documentSignal,
    body: [
      h('div', { class: 'row' }, h('div', { class: 'grow' }, search), categorySelect, publish),
      h('p', {}, tr("Reusable parameterized parts can be opened as independent copies. Published parts keep their fx parameters and configurations.")),
      host,
    ],
    buttons: [{ label: tr("Close"), value: 'close', primary: true }],
    onReady: (close) => { closeDialog = close; },
  });
}
