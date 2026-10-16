/**
 * setup 上下文护栏：md-rescue 的模块级函数在组件上下文之外（click / watcher 回调）可用
 *
 * 「修复链接」「撤销」是 click 回调，`loadHostPreference` 是「扫描完成」的 watcher 回调，
 * 都不在 setup 栈里。通知（`useToast`）与配置（`useConfigManager`）现在不依赖 Vue 的 inject，
 * 任何地方都能调；这里保留真实实现（不 mock），谁再把它们改回依赖 inject，最后一条就会红。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeReplace, undoReplace } from '@/composables/md-rescue/useFileBackup';
import { loadHostPreference, saveHostPreference } from '@/composables/md-rescue/useRepairStrategy';
import type { ToastApi } from '@/composables/useToast';
import type { ConfigManagerApi } from '@/composables/useConfig';
import {
  hostPreference,
  imageLinks,
  isReplacing,
  phase,
  repairReceipt,
} from '@/composables/md-rescue/shared';

function stubToast(): ToastApi {
  return {
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  } as unknown as ToastApi;
}

function stubConfigManager(config: Record<string, unknown> = {}): ConfigManagerApi {
  return {
    loadConfig: vi.fn(async () => config),
    saveConfig: vi.fn(async () => undefined),
  } as unknown as ConfigManagerApi;
}

beforeEach(() => {
  imageLinks.value = [];
  repairReceipt.value = null;
  hostPreference.value = [];
  isReplacing.value = false;
  phase.value = 'idle';
});

describe('md-rescue 模块级函数在 setup 之外可用', () => {
  it('executeReplace 不依赖 inject（「修复链接」走 click 回调）', async () => {
    await expect(executeReplace(0, stubToast())).resolves.toBeDefined();
  });

  it('undoReplace 不依赖 inject（「撤销」走 click 回调）', async () => {
    await expect(undoReplace(vi.fn(), stubToast())).resolves.toBeUndefined();
  });

  it('loadHostPreference 不依赖 inject（扫描完成的 watcher 回调）', async () => {
    await expect(
      loadHostPreference(stubConfigManager({ mdRescueHostPreference: ['r2'] }))
    ).resolves.toBeUndefined();
    expect(hostPreference.value).toEqual(['r2']);
  });

  it('saveHostPreference 不依赖 inject（保存偏好走 click 回调）', async () => {
    await expect(saveHostPreference(stubConfigManager())).resolves.toBeUndefined();
  });

  it('真的 useToast / useConfigManager 在 setup 之外也能调用', async () => {
    const { useToast } = await import('@/composables/useToast');
    const { useConfigManager } = await import('@/composables/useConfig');
    expect(() => useToast()).not.toThrow();
    expect(() => useConfigManager()).not.toThrow();
  });
});
