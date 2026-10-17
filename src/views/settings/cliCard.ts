// 命令行卡（S04）的状态行与按钮：由「命令入口在不在 PATH」和「命令行开没开」两件事决定。纯函数，组件与测试共用。
import type { CliPathStatus } from './useEditorCards';

export interface CliView {
  status: { text: string; tone: 'muted' | 'normal' | 'warning' };
  /** 按钮做的事：开（启用 + 建入口）还是关（移除入口 + 停用） */
  turnOn: boolean;
  label: string;
}

export function cliView(path: CliPathStatus | null, enabled: boolean): CliView {
  if (!path) {
    return enabled
      ? { status: { text: '已启用', tone: 'normal' }, turnOn: false, label: '停用' }
      : { status: { text: '尚未启用', tone: 'muted' }, turnOn: true, label: '启用' };
  }
  if (!path.supported) {
    return enabled
      ? { status: { text: '已启用 · 当前系统不支持自动加入 PATH，请用完整路径', tone: 'muted' }, turnOn: false, label: '停用' }
      : { status: { text: '当前系统不支持自动加入 PATH，请用完整路径', tone: 'muted' }, turnOn: true, label: '启用' };
  }
  if (path.inPath && enabled) {
    return { status: { text: path.needsTerminalRestart ? '已加入 PATH · 重新打开终端后生效' : '已加入 PATH', tone: 'normal' }, turnOn: false, label: '从 PATH 移除' };
  }
  // 入口已在 PATH（之前装过、另一份应用加的）但这里没开：按钮只需「启用」
  if (path.inPath) return { status: { text: '已加入 PATH · 命令行尚未启用', tone: 'warning' }, turnOn: true, label: '启用' };
  return { status: { text: '尚未加入 PATH', tone: 'muted' }, turnOn: true, label: '加入 PATH' };
}
