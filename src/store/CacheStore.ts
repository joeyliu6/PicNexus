/**
 * 纯内存键值层
 * 职责：为 Store 提供一个会话级内存缓存，避免同一会话内对同一文件重复读取和解密。
 *
 * 设计约束（务必遵守，改动前看一遍）：
 *  - 无 I/O、无锁、无加密；只维护 `data` + `loaded` 两个字段。
 *  - 只暴露 `replaceAll` 一个整体替换入口，不暴露 `setEntry(key, value)`。
 *    原因：原 store.ts 的 L562 用 `JSON.parse(jsonContent)` 做"整体替换 + 剥离 Vue 响应式 Proxy"，
 *    这是个原子操作。单 key 写入会让调用方以为可以部分更新，破坏 invariant。
 *  - `loaded` 旗标只能通过 `replaceAll` 翻起来、通过 `clear` 翻下去，外部不能单独设置。
 */

import type { StoreData } from './types';

export class CacheStore {
  private data: StoreData = {};
  private loaded = false;

  /**
   * 查询某个 key 是否在缓存里
   */
  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  /**
   * 读取某个 key 的值
   * 注意：对 "不存在的 key" 和 "值为 undefined 的 key" 都返回 `undefined`（保留原 store 语义）
   */
  get<T>(key: string): T | undefined {
    const v = this.data[key];
    return v === undefined ? undefined : (v as T);
  }

  /**
   * 整体替换缓存内容，并把 `loaded` 置为 true
   * 调用方必须传入一份"干净"的数据（不含 Vue 响应式 Proxy）——
   * 推荐用 `JSON.parse(JSON.stringify(...))` 做一次 roundtrip。
   */
  replaceAll(data: StoreData): void {
    this.data = { ...data };
    this.loaded = true;
  }

  /**
   * 清空缓存并把 `loaded` 置为 false
   * 用于 `Store.clear()` 或自愈回调
   */
  clear(): void {
    this.data = {};
    this.loaded = false;
  }

  /**
   * 缓存是否已从磁盘完整加载过
   * 用于 MutexStore 判断读/写路径是否需要走磁盘
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 返回当前缓存的浅拷贝快照
   * 用于 MutexStore.set 在写入前拿当前完整数据做合并
   */
  snapshot(): StoreData {
    return { ...this.data };
  }
}
