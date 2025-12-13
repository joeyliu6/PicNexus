/**
 * 缩略图服务 - 为非微博图床生成和缓存缩略图
 *
 * 工作流程：
 * 1. 检查 IndexedDB 缓存
 * 2. 如果没有缓存，下载原图并用 Canvas 生成缩略图
 * 3. 将缩略图保存到 IndexedDB
 * 4. 返回 Blob URL
 */

const DB_NAME = 'weibodr-thumbnail-cache';
const DB_VERSION = 1;
const STORE_NAME = 'thumbnails';
const THUMB_MAX_SIZE = 300; // 缩略图最大尺寸（像素）
const THUMB_QUALITY = 0.8; // JPEG 质量

// 内存缓存（避免重复创建 Blob URL）
const memoryCache = new Map<string, string>();

// 正在生成中的缩略图（避免重复请求）
const pendingRequests = new Map<string, Promise<string | null>>();

/**
 * 打开 IndexedDB 数据库
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
 * 从 IndexedDB 获取缓存的缩略图
 */
async function getFromCache(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  } catch (error) {
    console.warn('[ThumbnailService] 读取缓存失败:', error);
    return null;
  }
}

/**
 * 保存缩略图到 IndexedDB
 */
async function saveToCache(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(blob, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.warn('[ThumbnailService] 保存缓存失败:', error);
  }
}

/**
 * 使用 Canvas 生成缩略图
 */
function generateThumbnail(imageUrl: string, maxSize: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeoutId = setTimeout(() => {
      reject(new Error('图片加载超时'));
    }, 30000); // 30 秒超时

    img.onload = () => {
      clearTimeout(timeoutId);

      try {
        const canvas = document.createElement('canvas');

        // 计算缩放比例，保持宽高比
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 Canvas 上下文'));
          return;
        }

        // 绘制缩略图
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // 转换为 Blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob 失败'));
            }
          },
          'image/jpeg',
          THUMB_QUALITY
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`图片加载失败: ${imageUrl}`));
    };

    img.src = imageUrl;
  });
}

/**
 * 获取缩略图 URL（主入口）
 *
 * @param originalUrl 原图 URL
 * @returns Blob URL 或 null（如果生成失败）
 */
export async function getThumbnailUrl(originalUrl: string): Promise<string | null> {
  // 七鱼图床直接返回原链接，不进行缩略图转换
  if (originalUrl.includes('qiyukf.net') || originalUrl.includes('cdn.qiyu')) {
    return originalUrl;
  }

  // 1. 检查内存缓存
  if (memoryCache.has(originalUrl)) {
    return memoryCache.get(originalUrl)!;
  }

  // 2. 检查是否正在生成中（避免重复请求）
  if (pendingRequests.has(originalUrl)) {
    return pendingRequests.get(originalUrl)!;
  }

  // 3. 创建生成任务
  const task = (async () => {
    try {
      // 3.1 检查 IndexedDB 缓存
      const cachedBlob = await getFromCache(originalUrl);
      if (cachedBlob) {
        const blobUrl = URL.createObjectURL(cachedBlob);
        memoryCache.set(originalUrl, blobUrl);
        return blobUrl;
      }

      // 3.2 生成缩略图
      console.log('[ThumbnailService] 生成缩略图:', originalUrl);
      const thumbBlob = await generateThumbnail(originalUrl, THUMB_MAX_SIZE);

      // 3.3 保存到缓存
      await saveToCache(originalUrl, thumbBlob);

      // 3.4 创建 Blob URL
      const blobUrl = URL.createObjectURL(thumbBlob);
      memoryCache.set(originalUrl, blobUrl);

      return blobUrl;
    } catch (error) {
      console.error('[ThumbnailService] 生成缩略图失败:', error);
      return null;
    } finally {
      // 清理 pending 状态
      pendingRequests.delete(originalUrl);
    }
  })();

  pendingRequests.set(originalUrl, task);
  return task;
}

/**
 * 清理内存缓存（释放 Blob URL）
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
 * 预热缩略图缓存（批量生成）
 */
export async function preloadThumbnails(urls: string[]): Promise<void> {
  const tasks = urls.map((url) => getThumbnailUrl(url));
  await Promise.allSettled(tasks);
}
