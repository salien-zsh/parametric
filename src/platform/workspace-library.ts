// Local project organisation and the reusable parameterized-part library.
// Metadata stays in compact localStorage indexes; resource documents are
// stored as files in OPFS when available, with localStorage as a fallback.

import { parseDocument, serializeDocument } from '../model/document';
import { uniqueId } from '../model/ids';
import type { PartDocument } from '../model/types';
import { tr } from '../i18n';

const PROJECT_KEY = 'parametric:projects';
const ASSIGNMENT_KEY = 'parametric:project-parts';
const LIBRARY_KEY = 'parametric:resource-center';
const LIBRARY_DIR = 'parametric-resource-center';
const LIBRARY_FALLBACK = 'parametric:resource-doc:';

export interface LocalProject {
  id: string;
  name: string;
  created: number;
  modified: number;
}

export interface ResourceEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  sourceName: string;
  created: number;
  modified: number;
  parameters: string[];
  configurationCount: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
const time = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : Date.now();
const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || '');
    return raw == null ? fallback : raw as T;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

const projectListeners = new Set<() => void>();
const resourceListeners = new Set<() => void>();
const changed = (listeners: Set<() => void>) => { for (const fn of listeners) fn(); };

export function onProjectsChanged(fn: () => void): () => void {
  projectListeners.add(fn);
  return () => projectListeners.delete(fn);
}

export function onResourceCenterChanged(fn: () => void): () => void {
  resourceListeners.add(fn);
  return () => resourceListeners.delete(fn);
}

export function localProjects(): LocalProject[] {
  const raw = readJson<unknown[]>(PROJECT_KEY, []);
  return (Array.isArray(raw) ? raw : []).flatMap((p): LocalProject[] => {
    if (!isRecord(p) || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim()) return [];
    return [{ id: p.id, name: p.name.trim().slice(0, 100), created: time(p.created), modified: time(p.modified) }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function createLocalProject(name: string): LocalProject {
  const projects = localProjects();
  const used = new Set(projects.map((p) => p.id));
  const project: LocalProject = {
    id: uniqueId('project-', used),
    name: name.trim().slice(0, 100) || tr("Untitled Project"),
    created: Date.now(),
    modified: Date.now(),
  };
  writeJson(PROJECT_KEY, [...projects, project]);
  changed(projectListeners);
  return project;
}

export function renameLocalProject(id: string, name: string) {
  const next = name.trim().slice(0, 100);
  if (!next) return;
  writeJson(PROJECT_KEY, localProjects().map((p) => p.id === id ? { ...p, name: next, modified: Date.now() } : p));
  changed(projectListeners);
}

export function deleteLocalProject(id: string) {
  writeJson(PROJECT_KEY, localProjects().filter((p) => p.id !== id));
  const assignments = projectAssignments();
  for (const key of Object.keys(assignments)) if (assignments[key] === id) delete assignments[key];
  writeJson(ASSIGNMENT_KEY, assignments);
  changed(projectListeners);
}

function projectAssignments(): Record<string, string> {
  const raw = readJson<unknown>(ASSIGNMENT_KEY, {});
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') out[key] = value;
  return out;
}

export function localPartKey(location: { type: string; id?: string } | null): string | null {
  return location?.type === 'local' && location.id ? `local:${location.id}` : null;
}

export function projectForPart(partKey: string): string | null {
  return projectAssignments()[partKey] ?? null;
}

export function assignPartToProject(partKey: string, projectId: string | null) {
  const assignments = projectAssignments();
  if (projectId) assignments[partKey] = projectId;
  else delete assignments[partKey];
  writeJson(ASSIGNMENT_KEY, assignments);
  changed(projectListeners);
}

export function projectPartCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.values(projectAssignments())) out[id] = (out[id] ?? 0) + 1;
  return out;
}

export function resourceEntries(): ResourceEntry[] {
  const raw = readJson<unknown[]>(LIBRARY_KEY, []);
  return (Array.isArray(raw) ? raw : []).flatMap((r): ResourceEntry[] => {
    if (!isRecord(r) || typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name) return [];
    return [{
      id: r.id,
      name: r.name.slice(0, 120),
      category: text(r.category, tr("General")).slice(0, 80) || tr("General"),
      description: text(r.description).slice(0, 500),
      sourceName: text(r.sourceName, r.name).slice(0, 120),
      created: time(r.created),
      modified: time(r.modified),
      parameters: Array.isArray(r.parameters) ? r.parameters.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
      configurationCount: Math.max(0, Math.trunc(Number(r.configurationCount) || 0)),
    }];
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function writeResourceIndex(rows: ResourceEntry[]) {
  writeJson(LIBRARY_KEY, rows);
  changed(resourceListeners);
}

async function resourceDir(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(LIBRARY_DIR, { create: true });
  } catch {
    return null;
  }
}

async function writeResourceText(id: string, value: string): Promise<'opfs' | 'localStorage'> {
  const dir = await resourceDir();
  if (dir) {
    const handle = await dir.getFileHandle(`${id}.parametric`, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(value);
      await writable.close();
      return 'opfs';
    } catch (e) {
      await writable.abort().catch(() => {});
      throw e;
    }
  }
  localStorage.setItem(`${LIBRARY_FALLBACK}${id}`, value);
  return 'localStorage';
}

async function readResourceText(id: string): Promise<string> {
  const dir = await resourceDir();
  if (dir) {
    try {
      const handle = await dir.getFileHandle(`${id}.parametric`);
      return (await handle.getFile()).text();
    } catch { /* try the fallback */ }
  }
  const fallback = localStorage.getItem(`${LIBRARY_FALLBACK}${id}`);
  if (fallback == null) throw new Error(tr("The library part file is missing."));
  return fallback;
}

export interface PublishResourceInput {
  name: string;
  category: string;
  description: string;
}

export async function publishResource(doc: PartDocument, input: PublishResourceInput): Promise<ResourceEntry> {
  if (!doc.variables.length && !(doc.configurations?.length)) {
    throw new Error(tr("Add fx parameters or a configuration before publishing this part to the library."));
  }
  const rows = resourceEntries();
  const used = new Set(rows.map((r) => r.id));
  const id = uniqueId('resource-', used);
  const entry: ResourceEntry = {
    id,
    name: input.name.trim().slice(0, 120) || doc.name,
    category: input.category.trim().slice(0, 80) || tr("General"),
    description: input.description.trim().slice(0, 500),
    sourceName: doc.name,
    created: Date.now(),
    modified: Date.now(),
    parameters: doc.variables.map((v) => v.name).slice(0, 200),
    configurationCount: doc.configurations?.length ?? 0,
  };
  await writeResourceText(id, serializeDocument(structuredClone(doc)));
  writeResourceIndex([...rows, entry]);
  return entry;
}

export async function readResource(doc: ResourceEntry): Promise<PartDocument> {
  return parseDocument(await readResourceText(doc.id));
}

export async function deleteResource(id: string) {
  const dir = await resourceDir();
  if (dir) {
    try { await dir.removeEntry(`${id}.parametric`); } catch { /* already gone */ }
  }
  try { localStorage.removeItem(`${LIBRARY_FALLBACK}${id}`); } catch { /* storage unavailable */ }
  writeResourceIndex(resourceEntries().filter((r) => r.id !== id));
}
