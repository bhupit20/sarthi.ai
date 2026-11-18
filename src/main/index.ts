import {
  app,
  BrowserWindow,
  net,
  protocol,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProviderId } from '../core/shared/types';
import { CHANNELS, type CopilotAction, type Shortcut } from '../shared/api';
import { toWire } from '../shared/wire';
import { AiService, fakeProviders } from './ai';
import { KeyStore, type Cipher } from './secrets';

const TEST = process.env.SARTHI_TEST === '1';
if (process.env.SARTHI_USER_DATA) app.setPath('userData', process.env.SARTHI_USER_DATA);
process.env.SARTHI_VERSION = app.getVersion();

/** In automated tests on Linux there is no keyring; a reversible stand-in is used. */
const testCipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};

let dashboard: BrowserWindow | null = null;
let copilot: BrowserWindow | null = null;
let quitting = false;

/**
 * Pages load from sarthi://app/… rather than file://, so the speech worker,
 * WebAssembly and the model cache get a proper secure origin.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'sarthi', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
const RENDERER_DIR = join(__dirname, '..', 'renderer');
const renderer = (file: string) => `sarthi://app/${file}`;
const preload = join(__dirname, '..', 'preload', 'index.js');

const BASE: BrowserWindowConstructorOptions = {
  show: false,
  backgroundColor: '#f3efe4',
  webPreferences: { preload, contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false },
};

function createDashboard(): BrowserWindow {
  const win = new BrowserWindow({
    ...BASE,
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: 'SARTHI.AI',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
  });
  // Keep SARTHI out of screen recordings and shares where macOS allows it.
  win.setContentProtection(true);
  void win.loadURL(renderer('dashboard.html'));
  win.once('ready-to-show', () => win.show());
  // Closing the dashboard hides it: a live session keeps running.
  win.on('close', (event) => {
    if (!quitting && process.platform === 'darwin') {
      event.preventDefault();
      win.hide();
    }
  });
  return win;
}

function createCopilot(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 400;
  const height = Math.min(660, area.height - 40);
  const win = new BrowserWindow({
    ...BASE,
    width,
    height,
    minWidth: 320,
    minHeight: 360,
    x: area.x + area.width - width - 20,
    y: area.y + 20,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    title: 'SARTHI copilot',
    backgroundColor: '#fbf8f0',
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);
  void win.loadURL(renderer('copilot.html'));
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  return win;
}

function showCopilot(): void {
  copilot ??= createCopilot();
  copilot.showInactive();
}

function sendShortcut(shortcut: Shortcut): void {
  dashboard?.webContents.send(CHANNELS.shortcut, shortcut);
}

async function permissionStatus() {
  if (process.platform !== 'darwin') return { microphone: 'granted', screen: 'granted' };
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  };
}

app.whenReady().then(() => {
  protocol.handle('sarthi', (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    if (TEST && path === '__test__/call.wav' && process.env.SARTHI_TEST_CALL_AUDIO) {
      return net.fetch(pathToFileURL(process.env.SARTHI_TEST_CALL_AUDIO).href);
    }
    if (TEST && path.startsWith('__models__/') && process.env.SARTHI_TEST_MODELS) {
      return net.fetch(pathToFileURL(join(process.env.SARTHI_TEST_MODELS, path.slice('__models__/'.length))).href);
    }
    const file = normalize(join(RENDERER_DIR, path));
    if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  const keys = new KeyStore(join(app.getPath('userData'), 'keys.json'), TEST ? testCipher : safeStorage);
  const ai = new AiService(keys, TEST ? fakeProviders() : undefined);

  // Hearing the call: the dashboard asks for display media, and gets the
  // system audio ("loopback") of the whole Mac. The video track is dropped.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  });

  ipcMain.handle(CHANNELS.keysStatus, () => keys.status());
  ipcMain.handle(CHANNELS.keysSet, (_e, provider: ProviderId, key: string) => {
    try {
      keys.set(provider, key);
      return null;
    } catch (error) {
      return toWire(error);
    }
  });
  ipcMain.on(CHANNELS.aiStart, (event, id, job, request, settings) => ai.start(event.sender, id, job, request, settings));
  ipcMain.on(CHANNELS.aiCancel, (_e, id: string) => ai.cancel(id));
  ipcMain.handle(CHANNELS.aiTest, (_e, provider: ProviderId, model: string) => ai.test(provider, model));
  ipcMain.handle(CHANNELS.aiModels, (_e, provider: ProviderId) => ai.models(provider));

  ipcMain.on(CHANNELS.copilotShow, () => showCopilot());
  ipcMain.on(CHANNELS.copilotHide, () => copilot?.hide());
  ipcMain.on(CHANNELS.copilotToggle, () => (copilot?.isVisible() ? copilot.hide() : showCopilot()));
  ipcMain.on(CHANNELS.copilotPublish, (_e, state) => copilot?.webContents.send(CHANNELS.copilotState, state));
  ipcMain.on(CHANNELS.copilotAct, (_e, action: CopilotAction) => {
    if (action.type === 'openDashboard') {
      dashboard?.show();
      dashboard?.focus();
      return;
    }
    dashboard?.webContents.send(CHANNELS.copilotAction, action);
  });

  ipcMain.handle(CHANNELS.permStatus, () => permissionStatus());
  ipcMain.handle(CHANNELS.permMic, () =>
    process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : Promise.resolve(true),
  );
  ipcMain.on(CHANNELS.permOpen, (_e, kind: 'microphone' | 'screen') => {
    const pane = kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture';
    void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  });

  dashboard = createDashboard();
  copilot = createCopilot();

  if (!TEST) {
    globalShortcut.register('CommandOrControl+Shift+Space', () =>
      copilot?.isVisible() ? copilot.hide() : showCopilot(),
    );
    globalShortcut.register('CommandOrControl+Shift+Enter', () => sendShortcut('suggest'));
  }

  app.on('activate', () => dashboard?.show());
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
