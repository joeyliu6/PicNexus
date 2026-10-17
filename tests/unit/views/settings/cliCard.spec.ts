import { describe, expect, it } from 'vitest';
import { cliView } from '@/views/settings/cliCard';

const path = (inPath: boolean, supported = true) => ({ supported, inPath, executableDir: 'C:/PicNexus', needsTerminalRestart: false });

describe('cliView', () => {
  it('不在 PATH 也没开：「加入 PATH」', () => {
    expect(cliView(path(false), false)).toMatchObject({ label: '加入 PATH', turnOn: true, status: { text: '尚未加入 PATH' } });
  });

  it('在 PATH 且开着：「从 PATH 移除」', () => {
    expect(cliView(path(true), true)).toMatchObject({ label: '从 PATH 移除', turnOn: false, status: { text: '已加入 PATH', tone: 'normal' } });
  });

  it('入口已在 PATH 但这里没开：琥珀提示，按钮只写「启用」', () => {
    expect(cliView(path(true), false)).toMatchObject({ label: '启用', turnOn: true, status: { text: '已加入 PATH · 命令行尚未启用', tone: 'warning' } });
  });

  it('系统不支持自动加入 PATH：按钮写「启用 / 停用」', () => {
    expect(cliView(path(false, false), false)).toMatchObject({ label: '启用', turnOn: true });
    expect(cliView(path(false, false), true)).toMatchObject({ label: '停用', turnOn: false });
  });
});
