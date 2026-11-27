// Start screen and account menu (or puter.js's <puter-user-menu>, see user-menu.ts).

import { accountChanged, canSignOut, env, getProfilePicture, getUser, isSignedIn, puter, signIn, signOut } from '../platform/puter';
import { getThemeChoice, setThemeChoice } from '../platform/theme';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { dropdown, type MenuItem } from '../ui/menu';
import { toast } from '../ui/overlay';
import type { App } from './app';
import { closeAppsPanel, syncAppsLauncher } from './apps-panel';
import { syncUserMenu, syncUserMenuTheme } from './user-menu';
import type { FileOps } from './fileops';
import { REPO_URL } from './shell';
import { buildStartHome } from './start-home';
import { tr } from '../i18n';

export class StartScreen {
  el: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private app: App, private files: FileOps) {}

  show() {
    this.hide();
    const home = buildStartHome(this.app, this.files, () => this.hide());
    this.el = home.el;
    const offStore = this.app.store.on((reason) => { if (reason !== 'load') this.hide(); });
    this.unsubscribe = () => { offStore(); home.dispose(); };
    this.app.shell.viewport.append(this.el);
    requestAnimationFrame(() => this.el?.querySelector<HTMLElement>('.home-card, .home-side-item')?.focus());
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
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
