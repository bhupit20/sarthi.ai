import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, type SarthiApi } from '../shared/api';

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: SarthiApi = {
  platform: process.platform,
  version: process.env.SARTHI_VERSION ?? '',
  keys: {
    status: () => ipcRenderer.invoke(CHANNELS.keysStatus),
    set: (provider, key) => ipcRenderer.invoke(CHANNELS.keysSet, provider, key),
  },
  ai: {
    start: (id, job, request, settings) => ipcRenderer.send(CHANNELS.aiStart, id, job, request, settings),
    cancel: (id) => ipcRenderer.send(CHANNELS.aiCancel, id),
    onEvent: (listener) => listen(CHANNELS.aiEvent, listener),
    test: (provider, model) => ipcRenderer.invoke(CHANNELS.aiTest, provider, model),
    models: (provider) => ipcRenderer.invoke(CHANNELS.aiModels, provider),
  },
  copilot: {
    show: () => ipcRenderer.send(CHANNELS.copilotShow),
    hide: () => ipcRenderer.send(CHANNELS.copilotHide),
    toggle: () => ipcRenderer.send(CHANNELS.copilotToggle),
    publish: (state) => ipcRenderer.send(CHANNELS.copilotPublish, state),
    onState: (listener) => listen(CHANNELS.copilotState, listener),
    act: (action) => ipcRenderer.send(CHANNELS.copilotAct, action),
    onAction: (listener) => listen(CHANNELS.copilotAction, listener),
  },
  permissions: {
    status: () => ipcRenderer.invoke(CHANNELS.permStatus),
    requestMicrophone: () => ipcRenderer.invoke(CHANNELS.permMic),
    openSettings: (kind) => ipcRenderer.send(CHANNELS.permOpen, kind),
  },
  onShortcut: (listener) => listen(CHANNELS.shortcut, listener),
  ...(process.env.SARTHI_TEST === '1' ? { test: {
        callAudioUrl: process.env.SARTHI_TEST_CALL_AUDIO ? 'sarthi://app/__test__/call.wav' : undefined,
        modelHost: process.env.SARTHI_TEST_MODELS ? 'sarthi://app/__models__/' : undefined,
      } } : {}),
};

contextBridge.exposeInMainWorld('sarthi', api);
