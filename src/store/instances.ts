// 共享 Store 实例
// 解决多个 composable 各自创建 Store 实例导致的状态不一致问题

import { Store } from '../store';
import type { UserConfig } from '../config/types';

/**
 * 配置存储实例（单例）
 * 用于存储用户配置
 */
export const configStore = new Store('.settings.dat');

/**
 * 同步状态存储实例（单例）
 * 用于存储同步状态、服务可用性检测状态等
 */
export const syncStatusStore = new Store('.sync-status.dat', { selfHeal: true, encrypted: false });

/**
 * 读一份「一定是磁盘上最新」的配置
 *
 * Why 需要它：主窗口和托盘菜单是两个独立 webview，各有一份 Store 单例和内存缓存。
 * 任何一方写配置只刷新自己那份缓存，**对方的缓存就此陈旧**。所以收到 `config-updated`
 * 后直接 `configStore.get('config')` 会命中旧缓存，刷新变成空转
 * （典型表现：从托盘点勾选，主界面纹丝不动；或反过来）。
 *
 * 凡是「因为配置可能被别的窗口改了而重新读」的场景，都用这个函数，别直接 `get`。
 * 组件自己写完配置后再读不需要它——写入路径已经同步刷新过本窗口的缓存。
 */
export async function readFreshConfig(defaultValue?: UserConfig): Promise<UserConfig | null> {
  await configStore.invalidateCache();
  // defaultValue 不只是兜底返回值：传了它，Store 才会在文件损坏时走恢复路径重建配置
  return configStore.get<UserConfig>('config', defaultValue);
}
