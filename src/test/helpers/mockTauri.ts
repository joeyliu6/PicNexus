// Tauri API mock 工具
// 提供可复用的 invoke 响应配置，避免每个测试文件重复 mock

import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

/**
 * invoke mock 响应映射表
 * key: Rust 命令名, value: 返回值或抛出的错误
 */
type InvokeResponseMap = Record<string, unknown>;

/**
 * 配置 invoke mock 的响应
 * 根据命令名返回不同的值，未匹配的命令返回 undefined
 *
 * @example
 * ```ts
 * setupInvokeResponses({
 *   upload_to_weibo: { pid: 'abc123', width: 800, height: 600 },
 *   upload_to_r2: new Error('network error'), // 抛出错误
 * });
 * ```
 */
export function setupInvokeResponses(responses: InvokeResponseMap): void {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    const response = responses[cmd];
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

/**
 * 重置 invoke mock 到默认行为（返回 undefined）
 */
export function resetInvokeMock(): void {
  mockedInvoke.mockReset();
}

/**
 * 获取 invoke mock 实例（用于精细断言）
 */
export function getInvokeMock() {
  return mockedInvoke;
}

/**
 * 获取 listen mock 实例（用于进度事件测试）
 */
export function getListenMock() {
  return mockedListen;
}

/**
 * 模拟进度事件触发
 * 配合 listen mock 使用：先捕获 listen 回调，再手动触发事件
 *
 * @example
 * ```ts
 * const listenMock = getListenMock();
 * let progressHandler: (event: any) => void;
 * listenMock.mockImplementation(async (_event, handler) => {
 *   progressHandler = handler;
 *   return vi.fn(); // unlisten
 * });
 *
 * // 触发进度事件
 * emitProgressEvent(progressHandler, 'upload_123', 50, 100, '上传中...');
 * ```
 */
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
