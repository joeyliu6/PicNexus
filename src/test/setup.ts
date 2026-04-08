import { vi } from 'vitest';

// Mock @tauri-apps/plugin-log — 测试环境无 Tauri 运行时
vi.mock('@tauri-apps/plugin-log', () => ({
  debug: vi.fn(),
  info:  vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
}));

// Mock @tauri-apps/api/core — invoke 默认返回 undefined
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/path — 路径工具
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/appdata'),
  join: vi.fn((...parts: string[]) => parts.join('/')),
}));

// Mock @tauri-apps/plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile:  vi.fn(),
  writeTextFile: vi.fn(),
  exists:        vi.fn().mockResolvedValue(false),
  mkdir:         vi.fn(),
  remove:        vi.fn(),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// Mock @tauri-apps/api/event — 进度事件监听（BaseUploader 依赖）
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),  // 默认返回 unlisten 函数
  emit: vi.fn(),
}));

// Mock @tauri-apps/plugin-clipboard-manager — 剪贴板操作
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(),
  readText: vi.fn().mockResolvedValue(''),
  writeImage: vi.fn(),
  readImage: vi.fn(),
}));

// Mock @tauri-apps/plugin-shell — 外部编辑器等
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
  Command: vi.fn(),
}));
