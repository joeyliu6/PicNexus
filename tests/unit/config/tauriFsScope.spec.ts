import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 前端用 plugin-fs 读写数据文件夹里点开头的文件（.settings.dat、.sync-status.dat）。
// fs 插件在 macOS / Linux 上默认不让 `$APPDATA/**` 这类通配匹配点开头的文件（Windows 默认放行），
// 不显式关掉，那两个系统上配置读不出、存不进（tauri-plugin-fs config.rs：requireLiteralLeadingDot 默认 cfg!(unix)）。
function readConf(file: string): { plugins?: { fs?: { requireLiteralLeadingDot?: boolean } } } {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../src-tauri', file), 'utf8'));
}

describe('fs plugin scope', () => {
  it('lets the frontend reach dot-files such as .settings.dat on every platform', () => {
    expect(readConf('tauri.conf.json').plugins?.fs?.requireLiteralLeadingDot).toBe(false);
    // tauri.macos.conf.json 按 JSON Merge Patch 合并：那边不能再改回去
    expect(readConf('tauri.macos.conf.json').plugins?.fs).toBeUndefined();
  });
});
