import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// tauri.macos.conf.json 按 JSON Merge Patch 合并，数组整体替换：
// 为了给主窗口加 macOS 红绿灯，不得不把整个主窗口配置抄一份。
// 这里保证抄本除 macOS 专属的几项外与基础配置一致，改了一边忘了另一边会直接红。
const MACOS_ONLY_KEYS = ['decorations', 'titleBarStyle', 'hiddenTitle', 'trafficLightPosition'];

function readWindow(file: string): Record<string, unknown> {
  const conf = JSON.parse(readFileSync(resolve(__dirname, '../../../src-tauri', file), 'utf8'));
  const main = conf.app.windows.find((w: { label?: string }) => w.label === 'main');
  return Object.fromEntries(Object.entries(main).filter(([k]) => !MACOS_ONLY_KEYS.includes(k)));
}

describe('tauri.macos.conf.json', () => {
  it('keeps the main window identical to tauri.conf.json apart from the macOS title bar keys', () => {
    expect(readWindow('tauri.macos.conf.json')).toEqual(readWindow('tauri.conf.json'));
  });
});
