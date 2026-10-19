// 托盘菜单（T01–T08）：结构、文案与配置的对应关系
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import type { UploadHost } from '@/composables/upload/useUploadController';
import {
  buildTrayMenu,
  escapeMnemonic,
  menuText,
  truncateMiddle,
  uploadToSummary,
  type TrayMenuInput,
  type TrayRow,
} from '@/tray/trayMenuModel';

const HOSTS: UploadHost[] = [
  { id: 'jd', name: '京东', selected: true, warning: null, cookieLogin: false },
  { id: 'r2', name: 'Cloudflare R2', selected: true, warning: null, cookieLogin: false },
  { id: 'weibo', name: '微博', selected: true, warning: '登录失效', cookieLogin: true },
  { id: 'webdav', name: '家里 NAS', selected: false, warning: null, cookieLogin: false },
];

function config(patch: Partial<UserConfig> = {}): UserConfig {
  return { ...structuredClone(DEFAULT_CONFIG), ...patch };
}

/** 设计稿画的是「复制为 Markdown」 */
const MARKDOWN = { linkOutput: { ...DEFAULT_CONFIG.linkOutput!, defaultFormat: 'markdown' as const } };

function input(patch: Partial<TrayMenuInput> = {}): TrayMenuInput {
  return { platform: 'windows', hosts: HOSTS, config: config(MARKDOWN), clipboardHasImage: true, upload: null, ...patch };
}

/** 一行的名字（去掉右列 / 「 · 」后面的说明） */
function labelOf(row: TrayRow): string {
  if (row.kind === 'separator') return '—';
  return row.text.split(/\t| · /)[0];
}

function find(rows: TrayRow[], label: string): Exclude<TrayRow, { kind: 'separator' }> {
  const row = rows.find((r) => r.kind !== 'separator' && labelOf(r) === label);
  if (!row || row.kind === 'separator') throw new Error(`没有「${label}」这一行`);
  return row;
}

function submenu(rows: TrayRow[], label: string): TrayRow[] {
  const row = find(rows, label);
  if (row.kind !== 'submenu') throw new Error(`「${label}」不是子菜单`);
  return row.items;
}

describe('托盘菜单结构（T01）', () => {
  it('两条动作 → 上传到 / 复制为 / 压缩 → 三个勾选 → 打开 / 设置 / 退出，没有图片和历史', () => {
    expect(buildTrayMenu(input()).map(labelOf)).toEqual([
      '上传剪贴板图片', '选择文件上传…', '—',
      '上传到', '复制为', '压缩', '—',
      '自动复制链接', '自动上传剪贴板', '全局快捷键', '—',
      '打开 PicNexus', '设置…', '退出 PicNexus',
    ]);
  });

  it('三项带当前值：Windows 写在右列', () => {
    const rows = buildTrayMenu(input());
    expect(find(rows, '上传到').text).toBe('上传到\t⚠ 3 个图床');
    expect(find(rows, '复制为').text).toBe('复制为\tMarkdown');
    expect(find(rows, '压缩').text).toBe('压缩\t关');
  });

  it('macOS / Linux 菜单没有右列，当前值写在名字后面', () => {
    const rows = buildTrayMenu(input({ platform: 'macos' }));
    expect(find(rows, '复制为').text).toBe('复制为 · Markdown');
  });

  it('三个勾选开关跟着配置', () => {
    const rows = buildTrayMenu(input({
      config: config({
        linkOutput: { ...MARKDOWN.linkOutput, autoCopy: false },
        appBehavior: { ...DEFAULT_CONFIG.appBehavior!, autoUploadClipboard: true },
      }),
    }));
    expect(find(rows, '自动复制链接')).toMatchObject({ kind: 'check', checked: false, action: { type: 'toggleAutoCopy' } });
    expect(find(rows, '自动上传剪贴板')).toMatchObject({ kind: 'check', checked: true, action: { type: 'toggleAutoUploadClipboard' } });
    expect(find(rows, '全局快捷键')).toMatchObject({ kind: 'check', checked: true, action: { type: 'toggleGlobalShortcut' } });
  });

  it('Windows 上「打开 PicNexus」是默认项（加粗），其他平台没有默认项', () => {
    expect(find(buildTrayMenu(input()), '打开 PicNexus')).toMatchObject({ isDefault: true });
    expect(find(buildTrayMenu(input({ platform: 'macos' })), '打开 PicNexus')).not.toHaveProperty('isDefault');
  });
});

describe('快捷键提示（T01 / T07 / T08）', () => {
  it('Windows 把实际录的组合键写在右列', () => {
    const rows = buildTrayMenu(input());
    expect(find(rows, '上传剪贴板图片').text).toBe('上传剪贴板图片\tCtrl+Shift+C');
    expect(find(rows, '选择文件上传…').text).toBe('选择文件上传…\tCtrl+Shift+O');
  });

  it('macOS / Linux 交给系统菜单按自己的写法画（⇧⌘C）；设置 / 退出在 macOS 带 ⌘, / ⌘Q', () => {
    const rows = buildTrayMenu(input({ platform: 'macos' }));
    expect(find(rows, '上传剪贴板图片')).toMatchObject({ text: '上传剪贴板图片', accelerator: 'CommandOrControl+Shift+C' });
    expect(find(rows, '设置…')).toMatchObject({ accelerator: 'CmdOrCtrl+,' });
    expect(find(rows, '退出 PicNexus')).toMatchObject({ accelerator: 'CmdOrCtrl+Q' });
    expect(find(buildTrayMenu(input({ platform: 'linux' })), '设置…')).not.toHaveProperty('accelerator');
  });

  it('关闭全局快捷键：快捷键提示消失', () => {
    const paused = config({ globalShortcut: { ...DEFAULT_CONFIG.globalShortcut!, enabled: false } });
    const rows = buildTrayMenu(input({ config: paused }));
    expect(find(rows, '上传剪贴板图片').text).toBe('上传剪贴板图片');
    expect(find(rows, '全局快捷键')).toMatchObject({ checked: false });
    expect(find(buildTrayMenu(input({ platform: 'macos', config: paused })), '选择文件上传…')).not.toHaveProperty('accelerator');
  });

  it('没设置的快捷键不显示', () => {
    const rows = buildTrayMenu(input({ config: config({ globalShortcut: { ...DEFAULT_CONFIG.globalShortcut!, uploadFromFile: '' } }) }));
    expect(find(rows, '选择文件上传…').text).toBe('选择文件上传…');
  });
});

describe('剪贴板里没有图片（T06）', () => {
  it('第一项变灰并注明原因', () => {
    const row = find(buildTrayMenu(input({ clipboardHasImage: false })), '上传剪贴板图片');
    expect(row).toMatchObject({ enabled: false, text: '上传剪贴板图片\t剪贴板无图片  Ctrl+Shift+C' });
  });

  it('不知道剪贴板情况时（Linux）一直可点', () => {
    expect(find(buildTrayMenu(input({ clipboardHasImage: null })), '上传剪贴板图片')).toMatchObject({ enabled: true });
  });
});

describe('上传到（T03）', () => {
  it('多选：每个图床一个勾选项，末尾「管理图床…」', () => {
    const items = submenu(buildTrayMenu(input()), '上传到');
    expect(items.map(labelOf)).toEqual(['京东', 'Cloudflare R2', '微博', '家里 NAS', '—', '管理图床…']);
    expect(items[0]).toMatchObject({ kind: 'check', checked: true, action: { type: 'toggleHost', hostId: 'jd' } });
    expect(items[3]).toMatchObject({ kind: 'check', checked: false, action: { type: 'toggleHost', hostId: 'webdav' } });
  });

  it('登录失效：子项写「登录失效」，点击打开登录窗口而不是切换', () => {
    const weibo = submenu(buildTrayMenu(input()), '上传到')[2];
    expect(weibo).toMatchObject({ text: '微博\t登录失效', checked: true, action: { type: 'loginHost', hostId: 'weibo' } });
  });

  it('非登录类问题：子项写原因（过长截断），点击照常切换', () => {
    const hosts: UploadHost[] = [{ id: 'r2', name: 'R2', selected: true, warning: '连接超时，服务器长时间没有响应，请稍后重试', cookieLogin: false }];
    const r2 = submenu(buildTrayMenu(input({ hosts })), '上传到')[0];
    expect(r2).toMatchObject({ text: 'R2\t连接超时，服务器长时间没有响应…', action: { type: 'toggleHost', hostId: 'r2' } });
  });

  it('父项只在勾选的图床有问题时提示 ⚠', () => {
    const unselected = HOSTS.map((h) => (h.id === 'weibo' ? { ...h, selected: false } : h));
    expect(find(buildTrayMenu(input({ hosts: unselected })), '上传到').text).toBe('上传到\t2 个图床');
  });

  it('当前值：没选写「未选择」，一个写图床名，多个写「N 个图床」', () => {
    expect(uploadToSummary([])).toBe('未选择');
    expect(uploadToSummary([HOSTS[0], HOSTS[3]])).toBe('京东');
    expect(uploadToSummary(HOSTS)).toBe('3 个图床');
  });

  it('一个图床都没有：子菜单只剩「管理图床…」', () => {
    expect(submenu(buildTrayMenu(input({ hosts: [] })), '上传到').map(labelOf)).toEqual(['管理图床…']);
  });
});

describe('复制为（T04）', () => {
  it('单选：四种格式各写出长什么样，末尾「自定义格式…」', () => {
    const items = submenu(buildTrayMenu(input()), '复制为');
    expect(items.map((row) => (row.kind === 'separator' ? '—' : row.text))).toEqual([
      'URL\thttps://…', 'Markdown\t![](…)', 'HTML\t<img src="…">', 'BBCode\t[img]…[/img]', '—', '自定义格式…',
    ]);
    expect(items.filter((row) => row.kind === 'check' && row.checked).map(labelOf)).toEqual(['Markdown']);
    expect(items[0]).toMatchObject({ action: { type: 'setFormat', format: 'url' } });
  });

  it('当前是自定义格式时「自定义格式…」打勾，父项写「自定义」', () => {
    const custom = config({ linkOutput: { ...DEFAULT_CONFIG.linkOutput!, defaultFormat: 'custom' } });
    const rows = buildTrayMenu(input({ config: custom }));
    expect(find(rows, '复制为').text).toBe('复制为\t自定义');
    const items = submenu(rows, '复制为');
    expect(items.filter((row) => row.kind === 'check' && row.checked).map(labelOf)).toEqual(['自定义格式…']);
  });
});

describe('压缩', () => {
  it('「关」+ 各方案单选 +「压缩设置与预览…」，父项写当前方案名', () => {
    const compression = { ...DEFAULT_CONFIG.imageCompression!, enabled: true };
    const rows = buildTrayMenu(input({ config: config({ imageCompression: compression }) }));
    const active = compression.presets.find((p) => p.id === compression.activePresetId) ?? compression.presets[0];
    expect(find(rows, '压缩').text).toBe(`压缩\t${active.name}`);
    const items = submenu(rows, '压缩');
    expect(items.map(labelOf)).toEqual(['关', ...compression.presets.map((p) => p.name), '—', '压缩设置与预览…']);
    expect(items.filter((row) => row.kind === 'check' && row.checked).map(labelOf)).toEqual([active.name]);
    expect(items[0]).toMatchObject({ action: { type: 'setCompression', presetId: null } });
  });
});

describe('上传中（T02）', () => {
  it('顶部多一条不可点的状态行：文件名 + 已完成 / 总数', () => {
    const rows = buildTrayMenu(input({ upload: { subject: 'Rust-async-生命周期示意.png', done: 1, total: 3, petals: ['ok', 'uploading', 'waiting'] } }));
    expect(rows[0]).toEqual({ kind: 'status', text: '正在上传 Rust-async-生命周期示意.png\t1 / 3', petals: ['ok', 'uploading', 'waiting'] });
    expect(rows[1]).toEqual({ kind: 'separator' });
    expect(labelOf(rows[2])).toBe('上传剪贴板图片');
  });

  it('长文件名从中间省略，留住扩展名', () => {
    expect(truncateMiddle('a-very-long-screenshot-name-2026-10-18.png', 24)).toBe('a-very-long-…6-10-18.png');
    expect(truncateMiddle('short.png', 24)).toBe('short.png');
  });
});

describe('系统菜单的转义', () => {
  it('「&」写成「&&」，免得被当成快捷字母', () => {
    expect(escapeMnemonic('R&D 图床')).toBe('R&&D 图床');
    const hosts: UploadHost[] = [{ id: 's3', name: 'A&B', selected: true, warning: null, cookieLogin: false }];
    expect(find(buildTrayMenu(input({ hosts })), '上传到').text).toBe('上传到\tA&&B');
    expect(buildTrayMenu(input({ upload: { subject: 'x&y.png', done: 0, total: 1, petals: ['waiting'] } }))[0])
      .toMatchObject({ text: '正在上传 x&&y.png\t0 / 1' });
  });

  it('没有说明时只写名字', () => {
    expect(menuText('关', '', 'windows')).toBe('关');
  });
});
