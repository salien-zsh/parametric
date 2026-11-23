// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileOps } from '../src/app/fileops';
import { setPuterForTests } from '../src/platform/puter';
import type { App } from '../src/app/app';

function fakeApp(panel: App['panel'] = null) {
  const controller = new AbortController();
  const app = {
    store: { dirty: true, doc: { name: 'Part1' }, emit: vi.fn() },
    panel,
    documentSignal: controller.signal,
    closePanel: vi.fn(async () => {}),
  };
  return app as unknown as App & { store: { dirty: boolean; emit: () => void }; closePanel: () => Promise<void> };
}

function dialogButton(value: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[role="dialog"] [data-value="${value}"]`);
  if (!button) throw new Error(`dialog button ${value} not found`);
  return button;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.innerHTML = '';
  setPuterForTests(null);
});

describe('discarding unsaved changes', () => {
  // Closing the desktop window asks first. After "Don't save" the part must no
  // longer count as unsaved, or beforeunload keeps the old window open and the
  // close has no reaction.
  it('clears the dirty flag so the window can close', async () => {
    const app = fakeApp();
    const files = new FileOps(app);
    const confirmed = files.confirmDiscard('close Parametric');
    await flush();
    dialogButton('discard').click();
    expect(await confirmed).toBe(true);
    expect(app.store.dirty).toBe(false);
    expect(app.store.emit).toHaveBeenCalledWith('saved');
  });

  it('drops a still-open feature panel instead of leaving it as unsaved work', async () => {
    const panel = { edited: true, title: 'Extrude', cancel: vi.fn(), dispose: vi.fn() } as unknown as App['panel'];
    const app = fakeApp(panel);
    const files = new FileOps(app);
    const confirmed = files.confirmDiscard('close Parametric');
    await flush();
    dialogButton('discard').click();
    expect(await confirmed).toBe(true);
    expect(app.closePanel).toHaveBeenCalledWith(false);
  });

  it('leaves the part unsaved when the dialog is cancelled', async () => {
    const app = fakeApp();
    const files = new FileOps(app);
    const confirmed = files.confirmDiscard('close Parametric');
    await flush();
    dialogButton('cancel').click();
    expect(await confirmed).toBe(false);
    expect(app.store.dirty).toBe(true);
  });
});

describe('closing the desktop window', () => {
  it('quits after "Don\'t save" instead of staying open with no reaction', async () => {
    let close: (() => void) | null = null;
    const exit = vi.fn();
    setPuterForTests({
      env: 'app',
      exit,
      auth: { isSignedIn: () => true, signIn: async () => true, signOut: () => {}, getUser: async () => ({ username: 't', uuid: 'u' }) },
      fs: {}, kv: {},
      ui: { onWindowClose: (fn: () => void) => { close = fn; } },
    } as never);
    const app = fakeApp();
    new FileOps(app).handleWindowClose();
    expect(close).not.toBeNull();
    close!();
    await flush();
    dialogButton('discard').click();
    await flush();
    await flush();
    expect(app.store.dirty).toBe(false);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
