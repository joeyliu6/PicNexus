// src/utils/network.ts
/**
 * 网络工具函数
 */

/**
 * 检测网络是否联通
 * 使用多端点并发检测，提高可靠性，对代理环境更友好
 * @returns Promise<boolean> - true 表示网络联通，false 表示网络断开
 */
export async function checkNetworkConnectivity(): Promise<boolean> {
  // 1. 快速预判
  if (!navigator.onLine) {
    return false;
  }

  // 2. 多端点检测（国内外混合，提高成功率）
  const endpoints = [
    'https://www.baidu.com/favicon.ico',        // 百度
    'https://www.qq.com/favicon.ico',           // 腾讯
    'https://www.cloudflare.com/favicon.ico',   // Cloudflare（国际）
  ];

  try {
    // 并发检测所有端点
    const results = await Promise.allSettled(
      endpoints.map(async (url) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5秒超时

        try {
          await fetch(url, {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-cache',
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          return true;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      })
    );

    // 只要有一个端点成功，就认为网络正常
    const hasSuccess = results.some(result => result.status === 'fulfilled');

    if (!hasSuccess) {
      console.warn('[网络检测] 所有端点均失败:', results);
    } else {
      console.log('[网络检测] 网络连接正常');
    }

    return hasSuccess;
  } catch (error) {
    console.error('[网络检测] 检测过程出错:', error);
    return false;
  }
}
