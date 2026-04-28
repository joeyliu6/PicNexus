import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir, basename, dirname, join } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog';
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
import { check as updaterCheck } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

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
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: vi.fn(() => ({
    label: 'mock-webview',
    clearAllBrowsingData: vi.fn().mockResolvedValue(undefined),
    onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
  })),
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

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
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

  const path = getPathMocks();
  path.appDataDir.mockReset();
  path.appDataDir.mockResolvedValue('/mock/appdata');
  path.join.mockReset();
  path.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
  path.basename.mockReset();
  path.basename.mockImplementation(async (filePath: string) => filePath.split(/[/\\]/).pop() || '');
  path.dirname.mockReset();
  path.dirname.mockImplementation(async (filePath: string) => filePath.split(/[/\\]/).slice(0, -1).join('/') || '/');
  getCurrentWebviewMock().mockReset();
  getCurrentWebviewMock().mockReturnValue({
    label: 'mock-webview',
    clearAllBrowsingData: vi.fn().mockResolvedValue(undefined),
    onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
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

  getUpdaterCheckMock().mockReset();
  getUpdaterCheckMock().mockResolvedValue(null as never);

  getRelaunchMock().mockReset();
  getRelaunchMock().mockResolvedValue(undefined as never);
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

export function getPathMocks() {
  return {
    appDataDir: vi.mocked(appDataDir),
    join: vi.mocked(join),
    basename: vi.mocked(basename),
    dirname: vi.mocked(dirname),
  };
}

export function getCurrentWebviewMock() {
  return vi.mocked(getCurrentWebview);
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

export function getUpdaterCheckMock() {
  return vi.mocked(updaterCheck);
}

export function getRelaunchMock() {
  return vi.mocked(relaunch);
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
