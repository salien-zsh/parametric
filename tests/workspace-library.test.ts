import { beforeEach, describe, expect, it } from 'vitest';
import { newDocument } from '../src/model/document';
import {
  assignPartToProject, createLocalProject, deleteLocalProject, deleteResource, localProjects, projectForPart,
  publishResource, readResource, renameLocalProject, resourceEntries,
} from '../src/platform/workspace-library';

function fakeLocalStorage() {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

beforeEach(fakeLocalStorage);

describe('local projects and resource center', () => {
  it('creates, renames and assigns local projects', () => {
    const project = createLocalProject('Fasteners');
    expect(localProjects().map((p) => p.name)).toEqual(['Fasteners']);
    renameLocalProject(project.id, 'Hardware');
    assignPartToProject('local:part-1', project.id);
    expect(localProjects()[0].name).toBe('Hardware');
    expect(projectForPart('local:part-1')).toBe(project.id);
    deleteLocalProject(project.id);
    expect(localProjects()).toEqual([]);
    expect(projectForPart('local:part-1')).toBeNull();
  });

  it('publishes and reads a parameterized part snapshot', async () => {
    const doc = newDocument('Bracket');
    doc.variables = [{ id: 'v1', name: 'Width', expr: '60' }];
    doc.configurations = [{ id: 'cfg1', name: 'Wide', overrides: { v1: '100' } }];
    doc.activeConfiguration = 'cfg1';
    const entry = await publishResource(doc, { name: 'Configurable bracket', category: 'Brackets', description: 'Width driven' });
    expect(entry.parameters).toEqual(['Width']);
    expect(entry.configurationCount).toBe(1);
    expect(resourceEntries()).toEqual([entry]);
    const opened = await readResource(entry);
    expect(opened.name).toBe('Bracket');
    expect(opened.activeConfiguration).toBe('cfg1');
    expect(opened.configurations?.[0].overrides.v1).toBe('100');
    await deleteResource(entry.id);
    expect(resourceEntries()).toEqual([]);
  });

  it('refuses to publish a static part', async () => {
    await expect(publishResource(newDocument('Static'), { name: 'Static', category: 'General', description: '' }))
      .rejects.toThrow(/parameters or a configuration/);
  });
});
