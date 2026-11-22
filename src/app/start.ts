// Start screen and account menu (or puter.js's <puter-user-menu>, see user-menu.ts).

import { UNIT_SYSTEMS } from '../model/units';
import type { UnitSystem } from '../model/types';
import { locationLabel, recentParts, sameLocation } from '../platform/files';
import { accountChanged, canSignOut, cloudAvailable, env, getProfilePicture, getUser, isSignedIn, puter, signIn, signOut } from '../platform/puter';
import { getThemeChoice, setThemeChoice } from '../platform/theme';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { dropdown, type MenuItem } from '../ui/menu';
import { toast } from '../ui/overlay';
import type { App } from './app';
import { closeAppsPanel, syncAppsLauncher } from './apps-panel';
import { syncUserMenu, syncUserMenuTheme } from './user-menu';
import { EXAMPLES } from './examples';
import type { FileOps } from './fileops';
import { REPO_URL } from './shell';
import { projectManagerDialog, resourceCenterDialog } from './workspace-dialogs';
import { tr } from '../i18n';

export class StartScreen {
  el: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private app: App, private files: FileOps) {}

  show() {
    this.hide();
    const app = this.app;
    const units = app.settings.defaultUnits;
    const unitSel = h('select', { class: 'input', 'aria-label': tr("Units for the new part"), style: { width: 'auto' } }) as HTMLSelectElement;
    for (const u of Object.values(UNIT_SYSTEMS)) {
      const o = h('option', { value: u.id }, u.label) as HTMLOptionElement;
      if (u.id === units) o.selected = true;
      unitSel.append(o);
    }
    unitSel.addEventListener('change', () => { app.changeSettings({ defaultUnits: unitSel.value as UnitSystem }); app.saveSettings(); });
    const action = (ic: string, t: string, d: string, run: () => void) => {
      const b = h('button', { class: 'start-action', type: 'button' }, h('span', { style: { color: 'var(--accent)' } }, icon(ic, 24)), h('span', { class: 't' }, t), h('span', { class: 'd' }, d));
      b.addEventListener('click', run);
      return b;
    };
    const recents = recentParts().slice(0, 6);
    // The part can have changed behind the start screen (assistant, ribbon): ask before replacing it.
    const examples = h('div', { class: 'start-actions' }, EXAMPLES.map((ex) => action('part', ex.name, ex.description, async () => {
      if (!(await this.files.confirmDiscard(tr("open an example")))) return;
      this.hide();
      app.loadDocument(ex.make(), null);
    })));
    const card = h('div', { class: 'start-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'start-title' },
      h('h1', { id: 'start-title' }, h('img', { src: './icon-128.png', alt: '' }), tr("Parametric")),
      h('div', { class: 'sub' }, tr("Feature-based 3D part modeling in your browser.")),
      h('div', { class: 'start-actions' },
        action('new', tr("New part"), tr("Start from a blank part"), async () => {
          if (!(await this.files.confirmDiscard(tr("start a new part")))) return;
          this.hide();
          app.newDocument(tr("Part1"));
        }),
        action('part', tr("New Assembly"), tr("Place multiple parts, position them, then create an assembly drawing"), async () => {
          if (!(await this.files.confirmDiscard(tr("start a new assembly")))) return;
          this.hide();
          app.newAssembly();
        }),
        action('open', tr("Open"), cloudAvailable() ? tr("Open a part from your Puter cloud or this browser") : tr("Open a part saved in this browser"), () => { this.hide(); void this.files.open(); }),
        action('upload', tr("Open from device"), tr("Open a part file, or a STEP or SolidWorks file"), () => { this.hide(); void this.files.openFromDevice(); }),
        action('files', tr("Local Project Manager"), tr("Organise locally saved parts into projects"), () => { void projectManagerDialog(app, this.files, () => this.hide()); }),
        action('part', tr("Part Resource Center"), tr("Browse and insert reusable parameterized parts"), () => { void resourceCenterDialog(app, this.files, () => this.hide()); }),
      ),
      h('div', { class: 'row' }, h('label', { class: 'field-label' }, tr("Units for new parts")), unitSel),
      recents.length ? h('div', { class: 'start-section' }, h('h2', {}, tr("Recent")), h('div', { class: 'file-list' }, recents.map((r) => {
        const b = h('button', { class: 'file-item', type: 'button' }, icon(r.location.type === 'cloud' ? 'cloud' : 'device', 16),
          h('span', { class: 'txt' }, h('span', { class: 'n' }, r.name), h('span', { class: 'meta' }, locationLabel(r.location))));
        // The start screen goes once the part opens; one that cannot be opened leaves it here.
        b.addEventListener('click', async () => {
          await this.files.openLocation(r.location, r.name);
          if (!b.isConnected || recentParts().some((x) => sameLocation(x.location, r.location))) return;
          // Gone: it has left the recent parts.
          const section = b.closest('.start-section');
          b.remove();
          if (section && !section.querySelector('.file-item')) section.remove();
          card.querySelector<HTMLElement>('.start-action')?.focus();
        });
        return b;
      }))) : null,
      h('div', { class: 'start-section' }, h('h2', {}, tr("Examples")), examples),
      h('div', { class: 'start-foot' },
        !isSignedIn() && env() !== 'app' && puter() ? h('button', { class: 'btn small', type: 'button', onclick: () => void doSignIn(app) }, icon('signIn', 14), tr("Sign in to save to the cloud")) : null,
        h('span', {}, tr("You can use Parametric without an account; parts are then saved in this browser.")),
        h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, tr("Open source on GitHub"))),
    );
    this.el = h('div', { class: 'start' }, card);
    // Work started elsewhere (the assistant, the ribbon) needs the graphics area.
    const offStore = app.store.on((reason) => { if (reason !== 'load') this.hide(); });
    const offSettings = app.commands.onChange(() => { unitSel.value = app.settings.defaultUnits; });
    this.unsubscribe = () => { offStore(); offSettings(); };
    app.shell.viewport.append(this.el);
    requestAnimationFrame(() => card.querySelector<HTMLElement>('.start-action')?.focus());
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.hide(); } });
  }

  hide() {
    // Chosen with the keyboard: focus goes to the graphics area, not back to the page start.
    const hadFocus = !!this.el?.contains(document.activeElement);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.el?.remove();
    this.el = null;
    if (hadFocus) this.app.viewport.canvas.focus({ preventScroll: true });
  }

  get visible() {
    return !!this.el;
  }
}

/** Signs in with Puter and updates the account button; resolves to whether it worked. */
export async function doSignIn(app: App): Promise<boolean> {
  try {
    const ok = await signIn();
    if (ok) await signedIn(app);
    return ok;
  } catch (e) {
    toast({ kind: 'error', title: tr("Sign-in failed"), message: (e as Error).message });
    return false;
  }
}

async function signedIn(app: App) {
  toast({ kind: 'success', message: tr("Signed in. Your parts will now be saved to your Puter cloud.") });
  await refreshAccount(app);
  app.loadRemoteSettings();
}

/** Updates the account button (profile picture or initial). */
export async function refreshAccount(app: App) {
  const btn = app.shell.account;
  // The SDK has loaded, or the account changed. Where puter.js's user menu
  // renders, it has the Apps button and the account, and keeps them current.
  const sdkMenu = syncUserMenu(app.shell.userMenu);
  syncAppsLauncher(app.shell.apps, sdkMenu);
  btn.hidden = sdkMenu;
  if (sdkMenu) return;
  btn.textContent = '';
  if (!isSignedIn() && env() !== 'app') {
    btn.append(icon('signIn', 16));
    btn.setAttribute('aria-label', tr("Account: not signed in"));
    return;
  }
  const [user, pic] = await Promise.all([getUser(), getProfilePicture()]);
  if (pic) btn.append(h('img', { src: pic, alt: '' }));
  else btn.append((user?.username?.[0] ?? '?').toUpperCase());
  btn.setAttribute('aria-label', `Account: ${user?.username ?? 'signed in'}`);
  btn.title = user?.username ?? '';
}

export function bindAccountMenu(app: App) {
  const btn = app.shell.account;
  btn.addEventListener('click', async () => {
    // The Apps panel hangs from the same corner: never both at once.
    closeAppsPanel();
    const signedIn = isSignedIn() || env() === 'app';
    const user = signedIn ? await getUser() : null;
    const theme = getThemeChoice();
    const items: MenuItem[] = [];
    if (signedIn) items.push({ group: user?.username ? `Signed in as ${user.username}` : 'Signed in' });
    else if (puter()) items.push({ label: tr("Sign in with Puter"), icon: 'signIn', run: () => void doSignIn(app) });
    else items.push({ group: tr("Cloud storage is unavailable offline") });
    items.push(
      { separator: true },
      { group: 'Theme' },
      { label: tr("System"), icon: 'system', checked: theme === 'system', radio: true, run: () => setThemeChoice('system') },
      { label: tr("Light"), icon: 'light', checked: theme === 'light', radio: true, run: () => setThemeChoice('light') },
      { label: tr("Dark"), icon: 'dark', checked: theme === 'dark', radio: true, run: () => setThemeChoice('dark') },
      { separator: true },
      { label: tr("Options..."), icon: 'settings', run: () => app.commands.run('options') },
      { label: tr("Keyboard Shortcuts"), icon: 'keyboard', run: () => app.commands.run('shortcuts') },
      { label: tr("Source code on GitHub"), icon: 'github', run: () => window.open(REPO_URL, '_blank', 'noopener') },
    );
    if (canSignOut()) {
      items.push({ separator: true }, {
        label: tr("Sign out"), icon: 'signOut', run: async () => {
          await signOut();
          await refreshAccount(app);
          toast({ message: tr("Signed out. New parts will be saved in this browser.") });
        },
      });
    }
    dropdown(btn, items, { label: tr("Account") });
  });
}

/**
 * puter.js's <puter-user-menu> signs in and out by itself, then says so: the
 * app follows as it does for its own Sign in and Sign out.
 */
export function bindUserMenu(app: App) {
  const el = app.shell.userMenu;
  if (!el) return;
  window.addEventListener('themechange', () => syncUserMenuTheme(el));
  el.addEventListener('signin', () => {
    accountChanged();
    if (isSignedIn()) void signedIn(app);
  });
  el.addEventListener('signout', () => {
    accountChanged();
    void refreshAccount(app);
    toast({ message: tr("Signed out. New parts will be saved in this browser.") });
  });
}
