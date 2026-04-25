/**
 * 网络工具函数
 */

import { createLogger } from './logger';

const log = createLogger('Network');

/** 端点检测超时（ms）。短超时 + race 语义，避免单端点慢拖累整体响应 */
const ENDPOINT_TIMEOUT_MS = 1500;

/**
 * 检测网络是否联通
 * 使用多端点 race 检测：任一端点先返回成功就立即放行，避免 allSettled 等到最慢
 * @returns Promise<boolean> - true 表示网络联通，false 表示网络断开
 */
export async function checkNetworkConnectivity(): Promise<boolean> {
  // navigator.onLine 在 Tauri WebView2 下几乎总是 true，不可靠
  // 仅用 navigator.onLine === false 作为日志参考，始终执行端点检测
  log.debug(`navigator.onLine=${navigator.onLine}，执行端点检测...`);

  // 多端点检测（国内外混合，提高成功率）
  const endpoints = [
    'https://www.baidu.com/favicon.ico',        // 百度
    'https://www.qq.com/favicon.ico',           // 腾讯
    'https://www.cloudflare.com/favicon.ico',   // Cloudflare（国际）
  ];

  // race 语义：任一端点成功就立即返回 true；全部失败/超时才返回 false
  // 手写 race 而不用 Promise.any，因 lib 仍为 ES2020（Promise.any 是 ES2021）
  return new Promise<boolean>((resolve) => {
    let pending = endpoints.length;
    const failures: unknown[] = [];
    // 每端点独立 timeout AbortController，避免一个慢端点的超时连带杀掉同时在飞的快端点
    // sharedAbort 仅由首个成功者触发，用于打断剩余在飞 fetch
    const sharedAbort = new AbortController();
    const perEndpointAborts: AbortController[] = [];

    function settleTrue() {
      perEndpointAborts.forEach((c) => c.abort());
      sharedAbort.abort();
      log.debug('网络连接正常');
      resolve(true);
    }

    endpoints.forEach((url) => {
      const localAbort = new AbortController();
      perEndpointAborts.push(localAbort);
      const timeoutId = setTimeout(() => localAbort.abort(), ENDPOINT_TIMEOUT_MS);
      // 任一控制器 abort 都打断本次 fetch
      const onShared = () => localAbort.abort();
      sharedAbort.signal.addEventListener('abort', onShared, { once: true });

      fetch(url, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache',
        signal: localAbort.signal,
      })
        .then(() => {
          clearTimeout(timeoutId);
          settleTrue();
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          failures.push(err);
          if (--pending === 0) {
            log.warn('所有端点均失败:', failures);
            resolve(false);
          }
        });
    });
  });
}
