// 共享 Store 实例
// 解决多个 composable 各自创建 Store 实例导致的状态不一致问题

import { Store } from '../store';

/**
 * 配置存储实例（单例）
 * 用于存储用户配置
 */
export const configStore = new Store('.settings.dat');

/**
 * 同步状态存储实例（单例）
 * 用于存储同步状态、服务可用性检测状态等
 */
export const syncStatusStore = new Store('.sync-status.dat');
