/**
 * setup 上下文护栏：md-rescue 的模块级函数不得自己调 inject 类 composable
 *
 * `useToast()` / `useConfigManager()` 内部走 Vue 的 `inject()`，只在 setup 栈期间有效。
 * 这四个函数的调用点全在 setup 之外——「修复链接」「撤销」是 click 回调，
 * `loadHostPreference` 是「扫描完成」的 watcher 回调——所以依赖必须由调用方
 * 在 setup 时取好、当参数传进来。
 *
 * ⚠️ **本文件绝不能 mock `@/composables/useToast` 或 `@/composables/useConfig`。**
 * 同目录的 `useFileBackup.spec.ts` / `useRepairStrategy.spec.ts` 都 mock 了它们，
 * 于是 `useToast()` 在测试里永远能拿到东西——真实的 inject 失败被 mock 盖住，
 * 这个缺陷从 `e2a2137` 拆分重构起一直没被测出来。这里保留真实实现，
 * 谁把 `useToast()` 挪回函数体内，下面就会红。
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

/** PrimeVue 在 setup 之外调 useToast 时抛的正是这句 */
const INJECT_FAILURE = /No PrimeVue Toast provided/;

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

  /**
   * 反向判据：确认上面四条测的确实是 inject 这件事
   *
   * 没有这条的话，就算把断言写成「不抛任何错」也看不出来到底测没测到点子上——
   * 这里主动在 setup 之外调一次真的 useToast，证明它**确实**会抛那句话。
   */
  it('真的 useToast 在 setup 之外会抛，证明上面四条不是空转', async () => {
    const { useToast } = await import('@/composables/useToast');
    expect(() => useToast()).toThrow(INJECT_FAILURE);
  });
});
