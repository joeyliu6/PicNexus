/**
 * 缩略图服务 (精简版)
 * 
 * 变更说明：
 * 为了解决大量图片并发生成缩略图导致的 CPU 卡顿和 UI 阻塞问题，
 * 已移除前端 Canvas 生成缩略图的逻辑。
 * 
 * 现在此服务仅负责：
 * 1. 提供清理旧缓存的功能 (clearAllCache)
 * 2. 提供统一的接口 (getThumbnailUrl) 但直接返回原图
 */

const DB_NAME = 'weibodr-thumbnail-cache';
const DB_VERSION = 2;
const STORE_NAME = 'thumbnails';

// 内存缓存（避免重复创建 Blob URL）
const memoryCache = new Map<string, string>();

/**
 * 打开 IndexedDB 数据库 (仅用于清理缓存)
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * 获取缩略图 URL
 * 
 * @param originalUrl 原图 URL
 * @returns 原图 URL (不再进行压缩)
 */
export async function getThumbnailUrl(originalUrl: string): Promise<string | null> {
  // 直接返回原图 URL，避免前端计算
  return originalUrl;
}

/**
 * 清理内存缓存
 */
export function clearMemoryCache(): void {
  for (const blobUrl of memoryCache.values()) {
    URL.revokeObjectURL(blobUrl);
  }
  memoryCache.clear();
  console.log('[ThumbnailService] 内存缓存已清理');
}

/**
 * 清理所有缓存（包括 IndexedDB）
 * 保留此功能以便用户清理之前版本产生的缓存文件
 */
export async function clearAllCache(): Promise<void> {
  clearMemoryCache();

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('[ThumbnailService] IndexedDB 缓存已清理');
        resolve();
      };
    });
  } catch (error) {
    console.error('[ThumbnailService] 清理 IndexedDB 失败:', error);
  }
}

/**
 * 预热缩略图缓存
 * (不再执行任何操作)
 */
export async function preloadThumbnails(_urls: string[]): Promise<void> {
  return Promise.resolve();
}
