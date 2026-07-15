import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir, basename, dirname, join, resolveResource } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow, monitorFromPoint, Window as TauriWindow } from '@tauri-apps/api/window';
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog';
import { register, unregisterAll, isRegistered, unregister } from '@tauri-apps/plugin-global-shortcut';
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import {
  readImage,
  readText,
  writeImage,
  writeText,
} from '@tauri-apps/plugin-clipboard-manager';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { check as updaterCheck } from '@tauri-apps/plugin-updater';
import { exit, relaunch } from '@tauri-apps/plugin-process';

const tauriWindowMockState = vi.hoisted(() => {
  const makeWindow = (label: string) => ({
    label,
    hide: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    unminimize: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
    setMinSize: vi.fn().mockResolvedValue(undefined),
    setMaxSize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    outerPosition: vi.fn().mockResolvedValue({ x: 1200, y: 600 }),
    scaleFactor: vi.fn().mockResolvedValue(1),
    onFocusChanged: vi.fn().mockResolvedValue(vi.fn()),
  });

  return {
    currentWindow: makeWindow('tray-menu'),
    labeledWindow: makeWindow('main'),
  };
});

vi.mock('@tauri-apps/plugin-log', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.0.5'),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/appdata'),
  join: vi.fn((...parts: string[]) => parts.join('/')),
  basename: vi.fn(async (filePath: string) => filePath.split(/[/\\]/).pop() || ''),
  dirname: vi.fn(async (filePath: string) => filePath.split(/[/\\]/).slice(0, -1).join('/') || '/'),
  resolveResource: vi.fn(async (resourcePath: string) => `/mock/resources/${resourcePath}`),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: vi.fn(() => ({
    label: 'mock-webview',
    clearAllBrowsingData: vi.fn().mockResolvedValue(undefined),
    onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
  })),
}));

vi.mock('@tauri-apps/api/window', () => ({
  LogicalSize: class LogicalSize {
    width: number;
    height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  },
  PhysicalPosition: class PhysicalPosition {
    x: number;
    y: number;

    constructor(x: number | { x: number; y: number }, y?: number) {
      if (typeof x === 'object') {
        this.x = x.x;
        this.y = x.y;
        return;
      }
      this.x = x;
      this.y = y ?? 0;
    }
  },
  getCurrentWindow: vi.fn(() => tauriWindowMockState.currentWindow),
  monitorFromPoint: vi.fn().mockResolvedValue({
    name: 'Mock Monitor',
    scaleFactor: 1,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: {
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1040 },
    },
  }),
  Window: {
    getByLabel: vi.fn().mockResolvedValue(tauriWindowMockState.labeledWindow),
  },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: {
    AppData: 'AppData',
    AppConfig: 'AppConfig',
  },
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn(),
  remove: vi.fn(),
  readDir: vi.fn(),
  copyFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(),
  unregisterAll: vi.fn(),
  isRegistered: vi.fn().mockResolvedValue(false),
  unregister: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(),
  readText: vi.fn().mockResolvedValue(''),
  writeImage: vi.fn(),
  readImage: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
  Command: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(),
  relaunch: vi.fn(),
}));

type InvokeResponder = (
  args: unknown,
  command: string,
) => unknown | Promise<unknown>;
type InvokeResponse =
  | unknown
  | InvokeResponder;
type InvokeResponseMap = Record<string, InvokeResponse>;

type InvokeHandler = (
  command: string,
  args?: unknown,
) => unknown | Promise<unknown>;

export function setupInvokeResponses(responses: InvokeResponseMap): void {
  getInvokeMock().mockImplementation(async (cmd, args) => {
    const response = responses[cmd];
    if (response instanceof Error) {
      throw response;
    }
    if (typeof response === 'function') {
      return (response as InvokeResponder)(args, cmd);
    }
    return response;
  });
}

export function setupInvokeHandler(handler: InvokeHandler): void {
  getInvokeMock().mockImplementation(async (cmd, args) => handler(cmd, args));
}

export function mockInvokeResponse(command: string, response: InvokeResponse): void {
  const current = getInvokeMock().getMockImplementation();

  getInvokeMock().mockImplementation(async (cmd, args) => {
    if (cmd === command) {
      if (response instanceof Error) throw response;
      if (typeof response === 'function') {
        return (response as InvokeResponder)(args, cmd);
      }
      return response;
    }

    return current?.(cmd, args);
  });
}

export function mockInvokeError(command: string, error: unknown): void {
  mockInvokeResponse(command, error instanceof Error ? error : new Error(String(error)));
}

export function resetInvokeMock(): void {
  getInvokeMock().mockReset();
}

export function resetTauriMocks(): void {
  getInvokeMock().mockReset();

  getListenMock().mockReset();
  getListenMock().mockResolvedValue(vi.fn());
  getEmitMock().mockReset();

  getVersionMock().mockReset();
  getVersionMock().mockResolvedValue('1.0.5');

  getDialogOpenMock().mockReset();
  getDialogSaveMock().mockReset();

  const shortcut = getGlobalShortcutMocks();
  shortcut.register.mockReset();
  shortcut.register.mockResolvedValue(undefined);
  shortcut.unregisterAll.mockReset();
  shortcut.unregisterAll.mockResolvedValue(undefined);
  shortcut.isRegistered.mockReset();
  shortcut.isRegistered.mockResolvedValue(false);
  shortcut.unregister.mockReset();
  shortcut.unregister.mockResolvedValue(undefined);

  const path = getPathMocks();
  path.appDataDir.mockReset();
  path.appDataDir.mockResolvedValue('/mock/appdata');
  path.join.mockReset();
  path.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
  path.basename.mockReset();
  path.basename.mockImplementation(async (filePath: string) => filePath.split(/[/\\]/).pop() || '');
  path.dirname.mockReset();
  path.dirname.mockImplementation(async (filePath: string) => filePath.split(/[/\\]/).slice(0, -1).join('/') || '/');
  path.resolveResource.mockReset();
  path.resolveResource.mockImplementation(async (resourcePath: string) => `/mock/resources/${resourcePath}`);
  getCurrentWebviewMock().mockReset();
  getCurrentWebviewMock().mockReturnValue({
    label: 'mock-webview',
    clearAllBrowsingData: vi.fn().mockResolvedValue(undefined),
    onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
  } as never);
  const window = getTauriWindowMocks();
  window.getCurrentWindow.mockReset();
  window.getCurrentWindow.mockReturnValue(window.currentWindow as never);
  window.getByLabel.mockReset();
  window.getByLabel.mockResolvedValue(window.labeledWindow as never);
  for (const apiWindow of [window.currentWindow, window.labeledWindow]) {
    apiWindow.hide.mockReset();
    apiWindow.hide.mockResolvedValue(undefined);
    apiWindow.show.mockReset();
    apiWindow.show.mockResolvedValue(undefined);
    apiWindow.unminimize.mockReset();
    apiWindow.unminimize.mockResolvedValue(undefined);
    apiWindow.setFocus.mockReset();
    apiWindow.setFocus.mockResolvedValue(undefined);
    apiWindow.setSize.mockReset();
    apiWindow.setSize.mockResolvedValue(undefined);
    apiWindow.setMinSize.mockReset();
    apiWindow.setMinSize.mockResolvedValue(undefined);
    apiWindow.setMaxSize.mockReset();
    apiWindow.setMaxSize.mockResolvedValue(undefined);
    apiWindow.setPosition.mockReset();
    apiWindow.setPosition.mockResolvedValue(undefined);
    apiWindow.outerPosition.mockReset();
    apiWindow.outerPosition.mockResolvedValue({ x: 1200, y: 600 });
    apiWindow.scaleFactor.mockReset();
    apiWindow.scaleFactor.mockResolvedValue(1);
    apiWindow.onFocusChanged.mockReset();
    apiWindow.onFocusChanged.mockResolvedValue(vi.fn());
  }
  vi.mocked(monitorFromPoint).mockReset();
  vi.mocked(monitorFromPoint).mockResolvedValue({
    name: 'Mock Monitor',
    scaleFactor: 1,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: {
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1040 },
    },
  } as never);

  const fs = getFsMocks();
  fs.readTextFile.mockReset();
  fs.writeTextFile.mockReset();
  fs.exists.mockReset();
  fs.exists.mockResolvedValue(false);
  fs.mkdir.mockReset();
  fs.remove.mockReset();
  fs.readDir.mockReset();
  fs.readDir.mockResolvedValue([]);
  fs.copyFile.mockReset();
  fs.stat.mockReset();

  const clipboard = getClipboardMocks();
  clipboard.writeText.mockReset();
  clipboard.writeText.mockResolvedValue(undefined);
  clipboard.readText.mockReset();
  clipboard.readText.mockResolvedValue('');
  clipboard.writeImage.mockReset();
  clipboard.writeImage.mockResolvedValue(undefined);
  clipboard.readImage.mockReset();
  clipboard.readImage.mockResolvedValue(undefined as never);

  getShellOpenMock().mockReset();

  getHttpFetchMock().mockReset();
  getInvokeMock().mockImplementation(async (cmd, args) => {
    if (cmd === 'webdav_request') {
      const request = (args as {
        request?: {
          method?: string;
          url?: string;
          headers?: Record<string, string>;
          body?: string | null;
        };
      } | undefined)?.request;
      if (!request?.url) throw new Error('webdav_request mock missing url');
      const response = await getHttpFetchMock()(request.url, {
        method: request?.method,
        headers: request?.headers,
        body: request?.body ?? undefined,
      });
      return {
        status: response.status,
        body: request?.method === 'GET' ? await response.text() : null,
      };
    }
    return undefined;
  });

  const notification = getNotificationMocks();
  notification.isPermissionGranted.mockReset();
  notification.isPermissionGranted.mockResolvedValue(true);
  notification.requestPermission.mockReset();
  notification.requestPermission.mockResolvedValue('granted');
  notification.sendNotification.mockReset();

  getUpdaterCheckMock().mockReset();
  getUpdaterCheckMock().mockResolvedValue(null as never);

  getRelaunchMock().mockReset();
  getRelaunchMock().mockResolvedValue(undefined as never);
  getExitMock().mockReset();
  getExitMock().mockResolvedValue(undefined as never);
}

export function getInvokeMock() {
  return vi.mocked(invoke);
}

export function getListenMock() {
  return vi.mocked(listen);
}

export function getEmitMock() {
  return vi.mocked(emit);
}

export function getVersionMock() {
  return vi.mocked(getVersion);
}

export function getDialogOpenMock() {
  return vi.mocked(dialogOpen);
}

export function getDialogSaveMock() {
  return vi.mocked(dialogSave);
}

export function getGlobalShortcutMocks() {
  return {
    register: vi.mocked(register),
    unregisterAll: vi.mocked(unregisterAll),
    isRegistered: vi.mocked(isRegistered),
    unregister: vi.mocked(unregister),
  };
}

export function getPathMocks() {
  return {
    appDataDir: vi.mocked(appDataDir),
    join: vi.mocked(join),
    basename: vi.mocked(basename),
    dirname: vi.mocked(dirname),
    resolveResource: vi.mocked(resolveResource),
  };
}

export function getCurrentWebviewMock() {
  return vi.mocked(getCurrentWebview);
}

export function getTauriWindowMocks() {
  return {
    getCurrentWindow: vi.mocked(getCurrentWindow),
    monitorFromPoint: vi.mocked(monitorFromPoint),
    getByLabel: vi.mocked(TauriWindow.getByLabel),
    currentWindow: tauriWindowMockState.currentWindow,
    labeledWindow: tauriWindowMockState.labeledWindow,
  };
}

export function getFsMocks() {
  return {
    readTextFile: vi.mocked(readTextFile),
    writeTextFile: vi.mocked(writeTextFile),
    exists: vi.mocked(exists),
    mkdir: vi.mocked(mkdir),
    remove: vi.mocked(remove),
    readDir: vi.mocked(readDir),
    copyFile: vi.mocked(copyFile),
    stat: vi.mocked(stat),
  };
}

export function getClipboardMocks() {
  return {
    writeText: vi.mocked(writeText),
    readText: vi.mocked(readText),
    writeImage: vi.mocked(writeImage),
    readImage: vi.mocked(readImage),
  };
}

export function getShellOpenMock() {
  return vi.mocked(shellOpen);
}

export function getHttpFetchMock() {
  return vi.mocked(httpFetch);
}

export function getNotificationMocks() {
  return {
    isPermissionGranted: vi.mocked(isPermissionGranted),
    requestPermission: vi.mocked(requestPermission),
    sendNotification: vi.mocked(sendNotification),
  };
}

export function getUpdaterCheckMock() {
  return vi.mocked(updaterCheck);
}

export function getRelaunchMock() {
  return vi.mocked(relaunch);
}

export function getExitMock() {
  return vi.mocked(exit);
}

export function emitProgressEvent(
  handler: (event: { payload: Record<string, unknown> }) => void,
  id: string,
  progress: number,
  total: number,
  step?: string,
  stepIndex?: number,
  totalSteps?: number,
): void {
  handler({
    payload: {
      id,
      progress,
      total,
      step,
      step_index: stepIndex,
      total_steps: totalSteps,
    },
  });
}
