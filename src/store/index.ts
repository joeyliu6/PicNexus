// 简单的键值存储门面
// 历史实现：原 711 行 SimpleStore 类已按职责拆成 3 个子模块：
//   - src/store/CacheStore.ts     — 纯内存层
//   - src/store/EncryptedStore.ts — 文件 I/O + 加密 + 自愈
//   - src/store/MutexStore.ts     — 门面实现（组合上两者 + Mutex）
//
// 本文件只做 re-export：保持消费方 `import { Store } from './store'` 的写法不变，
// 避免一次拆分波及 5 个消费方文件。
export { MutexStore as Store } from './MutexStore';
export { StoreError } from '../utils/storeErrors';
