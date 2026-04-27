import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { appDataDir, basename, join } from '@tauri-apps/api/path';
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog';
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import {
  readImage,
  readText,
  writeImage,
  writeText,
} from '@tauri-apps/plugin-clipboard-manager';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

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

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/appdata'),
  join: vi.fn((...parts: string[]) => parts.join('/')),
  basename: vi.fn(async (filePath: string) => filePath.split(/[/\\]/).pop() || ''),
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

type InvokeResponseMap = Record<string, unknown>;

export function setupInvokeResponses(responses: InvokeResponseMap): void {
  getInvokeMock().mockImplementation(async (cmd: string) => {
    const response = responses[cmd];
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

export function resetInvokeMock(): void {
  getInvokeMock().mockReset();
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
