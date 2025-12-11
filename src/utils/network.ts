// src/utils/network.ts
/**
 * 网络工具函数
 */

/**
 * 检测网络是否联通
 * 通过请求百度 favicon 来判断网络连通性
 * @returns Promise<boolean> - true 表示网络联通，false 表示网络断开
 */
export async function checkNetworkConnectivity(): Promise<boolean> {
  // 1. 快速预判
  if (!navigator.onLine) {
    return false;
  }

  // 2. 尝试加载百度的小资源
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5秒超时

    await fetch('https://www.baidu.com/favicon.ico', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-cache',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    console.warn('网络连通性检测失败:', error);
    return false;
  }
}
