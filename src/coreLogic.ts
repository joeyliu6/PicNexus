// src/coreLogic.ts
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { writeText as writeToClipboard } from "@tauri-apps/api/clipboard";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/api/notification";
import { readBinaryFile } from '@tauri-apps/api/fs';
import { getClient, Body } from '@tauri-apps/api/http';
import { uploadToWeibo, WeiboUploadError } from './weiboUploader';
import { UserConfig, R2ServiceConfig, HistoryItem } from './config/types';
import { Store, StoreError } from './store';
import { basename } from '@tauri-apps/api/path';
import { emit } from '@tauri-apps/api/event';
import { 
  CookieExpiredError, 
  convertWeiboError,
  isCookieError
} from './errors';

/**
 * 上传进度回调类型
 */
export type UploadProgressCallback = (progress: {
  type: 'weibo_progress' | 'r2_progress' | 'weibo_success' | 'r2_success' | 'error' | 'complete';
  payload: any;
}) => void;

/**
 * 验证 R2 配置
 * @param config R2 配置
 * @returns 配置是否完整
 */
export function validateR2Config(config: R2ServiceConfig): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];
  
  if (!config.accountId || config.accountId.trim().length === 0) {
    missingFields.push('账户 ID (Account ID)');
  }
  if (!config.accessKeyId || config.accessKeyId.trim().length === 0) {
    missingFields.push('访问密钥 ID (Access Key ID)');
  }
  if (!config.secretAccessKey || config.secretAccessKey.trim().length === 0) {
    missingFields.push('访问密钥 (Secret Access Key)');
  }
  if (!config.bucketName || config.bucketName.trim().length === 0) {
    missingFields.push('存储桶名称 (Bucket Name)');
  }

  return {
    valid: missingFields.length === 0,
    missingFields
  };
}

/**
 * 检测文件类型（基于magic number）
 */
function detectFileType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg';
  }
  
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'image/png';
  }
  
  // GIF: 47 49 46
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp';
    }
  }
  
  return null;
}

/**
 * 步骤 B: 备份 R2 (并行, 非阻塞性, 带超时保护)
 * @param fileBytes 文件字节流
 * @param hashName 文件名
 * @param config R2 配置
 * @param timeoutMs 超时时间（毫秒）
 * @param onProgress 进度回调函数（可选）
 * @returns {Promise<string | null>} 成功返回 r2Key，失败或未配置返回 null
 * @throws {Error} 非阻塞性错误 "R2 备份失败"
 */
async function backupToR2(
  fileBytes: Uint8Array, // 接受字节流
  hashName: string,
  config: R2ServiceConfig,
  timeoutMs: number = 60000, // 默认60秒超时
  onProgress?: (percent: number) => void // 新增：进度回调
): Promise<string | null> {
  console.log(`[步骤 B] 开始异步备份 ${hashName} 到 R2... (文件大小: ${(fileBytes.length / 1024).toFixed(2)}KB)`);
  
  // 验证输入
  if (!fileBytes || !(fileBytes instanceof Uint8Array) || fileBytes.length === 0) {
    console.error("[步骤 B] 错误: 文件数据无效");
    throw new Error("R2 备份失败：文件数据无效");
  }

  if (!hashName || typeof hashName !== 'string' || hashName.trim().length === 0) {
    console.error("[步骤 B] 错误: hashName 无效");
    throw new Error("R2 备份失败：文件名无效");
  }

  // 验证配置
  const validation = validateR2Config(config);
  if (!validation.valid) {
    console.log(`[步骤 B] R2 未配置或配置不全，缺少: ${validation.missingFields.join(', ')}，跳过备份。`);
    return null; // 如果未配置，返回 null
  }

  const { accountId, accessKeyId, secretAccessKey, bucketName, path = '' } = config;

  // 验证账户 ID 格式（应该是有效的字符串）
  const trimmedAccountId = accountId.trim();
  if (trimmedAccountId.length < 10) {
    console.warn("[步骤 B] 警告: 账户 ID 格式可能不正确");
  }

  let endpoint: string;
  try {
    endpoint = `https://${trimmedAccountId}.r2.cloudflarestorage.com`;
  } catch (error: any) {
    console.error("[步骤 B] 构建端点失败:", error);
    throw new Error(`R2 备份失败：无法构建端点 URL (${error?.message || String(error)})`);
  }

  let r2Client: S3Client;
  try {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      }
    });
  } catch (error: any) {
    console.error("[步骤 B] 初始化 S3 客户端失败:", error);
    throw new Error(`R2 备份失败：无法初始化客户端 (${error?.message || String(error)})`);
  }

  const key = (path.endsWith('/') || path === '' ? path : path + '/') + hashName;
  console.log(`[步骤 B] 目标路径: ${key}`);

  // 检测文件类型
  const contentType = detectFileType(fileBytes) || 'application/octet-stream';
  console.log(`[步骤 B] 检测到文件类型: ${contentType}`);

  try {
    // 使用 Upload 类支持进度回调
    const upload = new Upload({
      client: r2Client,
      params: {
        Bucket: bucketName.trim(),
        Key: key,
        Body: fileBytes, // 使用字节流
        ContentType: contentType, // 设置正确的 MIME 类型
      },
    });

    // 如果有进度回调，监听上传进度
    if (onProgress) {
      const totalSize = fileBytes.length;
      let lastReportedPercent = 0;
      
      upload.on("httpUploadProgress", (progress) => {
        // 使用文件总大小作为 total，如果 progress.total 不存在
        const total = progress.total || totalSize;
        const loaded = progress.loaded || 0;
        
        if (total > 0) {
          const percent = Math.min(100, Math.round((loaded / total) * 100));
          // 只在进度变化时报告，避免频繁更新
          if (percent !== lastReportedPercent) {
            lastReportedPercent = percent;
            onProgress(percent);
          }
        }
      });
    }

    // 使用超时保护包装上传操作
    const uploadPromise = upload.done();
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`上传超时（超过${timeoutMs / 1000}秒）`)), timeoutMs);
    });
    
    await Promise.race([uploadPromise, timeoutPromise]);
    
    console.log(`[步骤 B] R2 备份成功: ${key}`);
    return key; // 返回 R2 Key
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const errorString = errorMessage.toLowerCase();
    
    // 提供更详细的错误信息
    let userMessage = "R2 备份失败";
    
    if (errorString.includes('credentials') || errorString.includes('认证') || errorString.includes('auth')) {
      userMessage = "R2 备份失败：认证失败，请检查访问密钥是否正确";
    } else if (errorString.includes('bucket') || errorString.includes('存储桶')) {
      userMessage = "R2 备份失败：存储桶不存在或无权访问，请检查存储桶名称和权限";
    } else if (errorString.includes('network') || errorString.includes('网络') || errorString.includes('connection')) {
      userMessage = "R2 备份失败：网络连接失败，请检查网络连接或防火墙设置";
    } else if (errorString.includes('timeout') || errorString.includes('超时')) {
      userMessage = "R2 备份失败：请求超时，可能是网络较慢或文件较大";
    } else if (errorString.includes('permission') || errorString.includes('权限')) {
      userMessage = "R2 备份失败：权限不足，请检查访问密钥的权限设置";
    } else {
      userMessage = `R2 备份失败：${errorMessage}`;
    }

    console.error(`[步骤 B] R2 备份失败:`, error);
    console.error(`[步骤 B] 错误详情:`, {
      message: errorMessage,
      code: error?.code,
      name: error?.name,
      endpoint,
      bucket: bucketName,
      key
    });
    
    throw new Error(`警告：${userMessage}。请检查 R2 配置。`);
  }
}

/**
 * 验证链接生成参数
 * @param weiboLargeUrl 微博大图链接
 * @param hashName 文件名
 * @param config 用户配置
 * @throws {Error} 如果参数无效
 */
function validateLinkParams(weiboLargeUrl: string, hashName: string, config: UserConfig): void {
  if (!weiboLargeUrl || typeof weiboLargeUrl !== 'string' || weiboLargeUrl.trim().length === 0) {
    throw new Error("生成链接失败：微博链接无效");
  }

  if (!weiboLargeUrl.startsWith('http://') && !weiboLargeUrl.startsWith('https://')) {
    throw new Error(`生成链接失败：微博链接格式不正确 (${weiboLargeUrl.substring(0, 50)}...)`);
  }

  if (!hashName || typeof hashName !== 'string' || hashName.trim().length === 0) {
    throw new Error("生成链接失败：文件名无效");
  }

  if (!config || typeof config !== 'object') {
    throw new Error("生成链接失败：配置无效");
  }
}

/**
 * 步骤 C: 生成链接 (并行)
 * @throws {Error} 如果生成链接失败
 */
async function generateLink(
  weiboLargeUrl: string, 
  hashName: string, 
  config: UserConfig
): Promise<string> {
  console.log("[步骤 C] 生成最终链接...");
  
  // 验证输入
  try {
    validateLinkParams(weiboLargeUrl, hashName, config);
  } catch (error) {
    console.error("[步骤 C] 参数验证失败:", error);
    throw error;
  }

  // 新架构：outputFormat 只有 'direct' 和 'baidu-proxy'
  // 向后兼容：'baidu' 映射到 'baidu-proxy', 'weibo' 映射到 'direct'
  const format = config.outputFormat || 'baidu-proxy';

  switch (format) {
    case 'direct':
    case 'weibo' as any: // 向后兼容旧配置
      console.log(`[步骤 C] 使用微博原始链接: ${weiboLargeUrl}`);
      return weiboLargeUrl;

    case 'baidu-proxy':
    case 'baidu' as any: // 向后兼容旧配置
    default:
      const baiduPrefix = config.baiduPrefix || 'https://image.baidu.com/search/down?thumburl=';
      if (!baiduPrefix || typeof baiduPrefix !== 'string') {
        console.warn("[步骤 C] 警告: 百度前缀无效，使用默认值");
        const defaultPrefix = 'https://image.baidu.com/search/down?thumburl=';
        return `${defaultPrefix}${weiboLargeUrl}`;
      }
      const baiduLink = `${baiduPrefix}${weiboLargeUrl}`;
      console.log(`[步骤 C] 使用百度代理链接: ${baiduLink}`);
      return baiduLink;
  }
}

/**
 * 弹出系统通知
 * @param title 通知标题
 * @param body 通知内容（可选）
 */
async function showNotification(title: string, body?: string): Promise<void> {
  try {
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      console.warn("[通知] 警告: 通知标题为空，跳过发送");
      return;
    }

    let hasPermission = false;
    try {
      hasPermission = await isPermissionGranted();
    } catch (error: any) {
      console.warn("[通知] 检查权限失败:", error?.message || String(error));
      // 即使检查失败，也尝试发送通知
    }

    if (!hasPermission) {
      try {
        await requestPermission();
        // 再次检查权限
        hasPermission = await isPermissionGranted();
      } catch (error: any) {
        console.warn("[通知] 请求权限失败:", error?.message || String(error));
        // 即使请求失败，也尝试发送通知（某些系统可能仍然允许）
      }
    }

    try {
      sendNotification({ title, body });
      console.log(`[通知] 已发送通知: ${title}`);
    } catch (error: any) {
      console.error("[通知] 发送通知失败:", error?.message || String(error));
      // 通知失败不应该影响主流程，只记录错误
    }
  } catch (error: any) {
    console.error("[通知] 通知系统异常:", error?.message || String(error));
    // 通知失败不应该影响主流程
  }
}

/**
 * 验证 WebDAV 配置
 * @param config WebDAV 配置
 * @returns 配置是否完整
 */
function validateWebDAVConfig(config: UserConfig['webdav']): { valid: boolean; missingFields: string[] } {
  if (!config) {
    return { valid: false, missingFields: ['WebDAV 配置'] };
  }

  const missingFields: string[] = [];
  
  if (!config.url || config.url.trim().length === 0) {
    missingFields.push('URL');
  } else {
    // 验证 URL 格式
    try {
      new URL(config.url);
    } catch {
      missingFields.push('URL (格式不正确)');
    }
  }
  
  if (!config.username || config.username.trim().length === 0) {
    missingFields.push('用户名');
  }
  
  if (!config.password || config.password.trim().length === 0) {
    missingFields.push('密码');
  }
  
  if (!config.remotePath || config.remotePath.trim().length === 0) {
    missingFields.push('远程路径');
  }

  return {
    valid: missingFields.length === 0,
    missingFields
  };
}

/**
 * 同步历史记录到 WebDAV (v1.2 新增 - 自动同步)
 * 非阻塞性，失败时只在控制台记录
 */
async function syncHistoryToWebDAV(items: HistoryItem[], config: UserConfig): Promise<void> {
  if (!config.webdav) {
    console.log("[WebDAV] 未配置 WebDAV，跳过同步");
    return; // 未配置 WebDAV，静默跳过
  }

  // 验证配置
  const validation = validateWebDAVConfig(config.webdav);
  if (!validation.valid) {
    console.log(`[WebDAV] WebDAV 配置不完整，缺少: ${validation.missingFields.join(', ')}，跳过同步`);
    return; // 配置不完整，静默跳过
  }

  const { url, username, password, remotePath } = config.webdav;

  // 验证 items
  if (!items || !Array.isArray(items) || items.length === 0) {
    console.log("[WebDAV] 历史记录为空，跳过同步");
    return;
  }

  try {
    let jsonContent: string;
    try {
      jsonContent = JSON.stringify(items, null, 2);
    } catch (stringifyError: any) {
      console.error(`[WebDAV] 序列化历史记录失败:`, stringifyError?.message || String(stringifyError));
      return;
    }

    if (!jsonContent || jsonContent.length === 0) {
      console.warn("[WebDAV] 警告: 序列化后的内容为空");
      return;
    }
    
    // 构建 WebDAV URL
    let webdavUrl: string;
    try {
      const baseUrl = url.trim();
      let path = remotePath.trim();
      
      // 如果路径以 / 结尾，假设是目录，追加 history.json
      if (path.endsWith('/')) {
        path += 'history.json';
      } else if (!path.toLowerCase().endsWith('.json')) {
        // 如果没有扩展名，也假设是目录（或者追加 .json）
        // 这里为了安全，如果不以 .json 结尾，我们假设它是目录
        path += '/history.json';
        // 修正：如果用户配置的路径如 "/WeiboDR/history" 但没带后缀，可能导致 "/WeiboDR/history/history.json"
        // 暂时保持简单：如果没后缀，追加 .json
        // Better logic: check if it looks like a filename
      }
      
      // 修正路径拼接逻辑
      if (baseUrl.endsWith('/') && path.startsWith('/')) {
        webdavUrl = baseUrl + path.substring(1);
      } else if (baseUrl.endsWith('/') || path.startsWith('/')) {
        webdavUrl = baseUrl + path;
      } else {
        webdavUrl = baseUrl + '/' + path;
      }
      
      console.log(`[WebDAV] 同步目标 URL: ${webdavUrl}`);
      
      // 验证最终 URL
      new URL(webdavUrl);
    } catch (urlError: any) {
      console.error(`[WebDAV] 构建 WebDAV URL 失败:`, urlError?.message || String(urlError));
      return;
    }

    // 使用 Basic Auth
    let auth: string;
    try {
      auth = btoa(`${username.trim()}:${password.trim()}`);
    } catch (authError: any) {
      console.error(`[WebDAV] 生成认证信息失败:`, authError?.message || String(authError));
      return;
    }
    
    let client;
    try {
      client = await getClient();
    } catch (clientError: any) {
      console.error(`[WebDAV] 初始化 HTTP 客户端失败:`, clientError?.message || String(clientError));
      return;
    }

    try {
      const response = await client.put(webdavUrl, Body.text(jsonContent), {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
          'Overwrite': 'T' // 强制覆盖
        },
        timeout: 15000, // 15秒超时
      });

      if (response.ok) {
        console.log(`[WebDAV] ✅ 已自动同步 ${items.length} 条记录到 WebDAV (覆盖更新)`);
      } else {
        const status = response.status;
        let errorMsg = `HTTP ${status}`;
        
        if (status === 401 || status === 403) {
          errorMsg = `认证失败 (HTTP ${status})：请检查用户名和密码`;
        } else if (status === 404) {
          errorMsg = `路径不存在 (HTTP ${status})：请检查远程路径配置`;
        } else if (status === 507) {
          errorMsg = `存储空间不足 (HTTP ${status})：WebDAV 服务器空间已满`;
        } else if (status >= 500) {
          errorMsg = `服务器错误 (HTTP ${status})：WebDAV 服务器可能暂时不可用`;
        }
        
        console.error(`[WebDAV] 自动同步失败: ${errorMsg}`);
      }
    } catch (requestError: any) {
      const errorMsg = requestError?.message || String(requestError);
      const lowerError = errorMsg.toLowerCase();
      
      let userMessage = "自动同步失败";
      if (lowerError.includes('network') || lowerError.includes('网络') || lowerError.includes('connection')) {
        userMessage = "自动同步失败：网络连接失败";
      } else if (lowerError.includes('timeout') || lowerError.includes('超时')) {
        userMessage = "自动同步失败：请求超时";
      } else {
        userMessage = `自动同步失败: ${errorMsg}`;
      }
      
      console.error(`[WebDAV] ${userMessage}:`, requestError);
      // 非阻塞性错误，只在控制台记录
    }
  } catch (error: any) {
    console.error("[WebDAV] 自动同步异常:", error?.message || String(error));
    // 非阻塞性错误，只在控制台记录
  }
}

/**
 * 验证文件路径
 * @param filePath 文件路径
 * @throws {Error} 如果路径无效
 */
function validateFilePath(filePath: string): void {
  if (!filePath || typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error("文件路径无效：路径不能为空");
  }
}

/**
 * 验证用户配置
 * @param config 用户配置
 * @throws {Error} 如果配置无效
 */
function validateUserConfig(config: UserConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error("配置无效：用户配置对象不存在");
  }

  // 新架构：检查 config.services.weibo.cookie
  const weiboCookie = config.services?.weibo?.cookie;
  if (!weiboCookie || typeof weiboCookie !== 'string' || weiboCookie.trim().length === 0) {
    throw new Error("配置无效：微博 Cookie 未配置，请先在设置中配置 Cookie");
  }
}

/**
 * * * (核心工作流) 处理用户拖拽的文件
 * * */
export async function handleFileUpload(filePath: string, config: UserConfig) {
  // 输入验证
  try {
    validateFilePath(filePath);
    validateUserConfig(config);
  } catch (validationError: any) {
    const errorMsg = validationError?.message || '输入验证失败';
    console.error("[核心流程] 输入验证失败:", errorMsg);
    await showNotification("上传失败", errorMsg);
    return { status: 'error', message: errorMsg };
  }

  // 验证文件存在性 (Rust 会处理，但这里可以做个简单的检查 if needed，或者直接跳过)
  console.log(`[核心流程] 开始处理文件: ${filePath}`);

  // fileBytes 延迟读取，仅用于 R2 备份
  let fileBytes: Uint8Array | null = null;

  try {
    // --- [步骤 A - 上传微博] (串行) ---
    // 使用新的、流式上传器 (传入路径)
    const { hashName, largeUrl } = await uploadToWeibo(
      filePath,
      config.services.weibo!.cookie // validateUserConfig 已确保存在
    );


    // --- 步骤 A 成功后 ---

    // [步骤 C - 生成链接] (并行)
    const finalLink = await generateLink(largeUrl, hashName, config);

    // --- [输出] ---
    try {
      await writeToClipboard(finalLink);
      console.log(`[核心流程] 链接已复制到剪贴板: ${finalLink}`);
    } catch (clipboardError: any) {
      const errorMsg = clipboardError?.message || String(clipboardError);
      console.error("[核心流程] 复制到剪贴板失败:", errorMsg);
      // 复制失败不应该阻止流程，只记录错误
      await showNotification("上传成功", "但复制到剪贴板失败，请手动复制链接。");
    }
    
    await showNotification("上传成功！", "链接已复制到剪贴板。");
    
    // ===============================================
    //           ( ( ( 新增：保存历史记录 ) ) )
    // ===============================================
    try {
      const historyStore = new Store('.history.dat');
      let items: HistoryItem[] = [];
      
      try {
        items = await historyStore.get<HistoryItem[]>('uploads') || [];
        if (!Array.isArray(items)) {
          console.warn("[历史记录] 警告: 读取的历史记录不是数组，重置为空数组");
          items = [];
        }
      } catch (readError: any) {
        console.error("[历史记录] 读取历史记录失败:", readError?.message || String(readError));
        // 如果读取失败，使用空数组继续
        items = [];
      }
      
      // 获取本地文件名
      let name: string;
      try {
        name = await basename(filePath);
        if (!name || name.trim().length === 0) {
          name = filePath.split(/[/\\]/).pop() || '未知文件';
        }
      } catch (nameError: any) {
        console.warn("[历史记录] 获取文件名失败，使用路径:", nameError?.message || String(nameError));
        name = filePath.split(/[/\\]/).pop() || '未知文件';
      }

      // [步骤 B - 备份R2] (并行 - 异步，但等待结果以保存 r2Key)
      let finalR2Key: string | null = null;

      // 如果启用 R2，则在此处读取文件（为了微博上传性能优化，我们延迟到这里才读取）
      if (!fileBytes && config.services?.r2 && validateR2Config(config.services.r2).valid) {
          try {
             console.log(`[核心流程] 为 R2 备份读取文件: ${filePath}`);
             fileBytes = await readBinaryFile(filePath);
          } catch (e) {
             console.warn(`[核心流程] R2 备份前读取文件失败: ${e}`);
          }
      }

      if (fileBytes && config.services?.r2) {
        try {
            finalR2Key = await backupToR2(fileBytes, hashName, config.services.r2);
            if (finalR2Key) {
            console.log(`[历史记录] R2 备份成功，Key: ${finalR2Key}`);
            }
        } catch (r2Error: any) {
            // [非阻塞性错误通知]
            const r2ErrorMsg = r2Error?.message || String(r2Error);
            console.warn("[历史记录] R2 备份失败（非阻塞）:", r2ErrorMsg);
            await showNotification("R2 备份失败", r2ErrorMsg);
            finalR2Key = null; // 失败时保持为 null
        }
      }

      // 新架构：构建 HistoryItem
      const newItem: HistoryItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        localFileName: name,
        primaryService: 'weibo',
        results: [
          {
            serviceId: 'weibo',
            result: { url: largeUrl, serviceId: 'weibo', fileKey: hashName },
            status: 'success'
          }
        ],
        generatedLink: finalLink,
        filePath: filePath
      };

      // 添加新记录到最前面，永久保存（不再限制 20 条）
      const newItems = [newItem, ...items];
      
      try {
        await historyStore.set('uploads', newItems);
        await historyStore.save();
        console.log(`[历史记录] ✅ 已保存成功，共 ${newItems.length} 条记录`);
      } catch (saveError: any) {
        // 保存失败不应该影响主流程，但应该记录详细错误
        if (saveError instanceof StoreError) {
          console.error(`[历史记录] 保存失败 (${saveError.operation}):`, saveError.message);
          if (saveError.originalError) {
            console.error("[历史记录] 原始错误:", saveError.originalError);
          }
        } else {
          console.error("[历史记录] 保存失败:", saveError?.message || String(saveError));
        }
        // 这是一个非阻塞性错误，只在控制台记录
      }

      // [v1.2 新增] 自动同步到 WebDAV (异步，非阻塞)
      syncHistoryToWebDAV(newItems, config)
        .catch(err => {
          console.error("[WebDAV] 自动同步异常:", err?.message || String(err));
        });

    } catch (historyError: any) {
      // 捕获所有历史记录相关的未预期错误
      const errorMsg = historyError?.message || String(historyError);
      console.error("[历史记录] 保存历史记录时发生异常:", errorMsg);
      if (historyError instanceof StoreError) {
        console.error("[历史记录] StoreError 详情:", {
          operation: historyError.operation,
          key: historyError.key,
          originalError: historyError.originalError
        });
      }
      // 这是一个非阻塞性错误，只在控制台记录
    }
    // ===============================================
    //           ( ( ( 历史记录结束 ) ) )
    // ===============================================

    return { status: 'success', link: finalLink };

  } catch (error: any) {
    // --- [阻塞性错误处理] ---
    // 捕获 [步骤 A] 的失败
    
    // 转换微博上传错误为自定义错误类型
    const convertedError = error instanceof WeiboUploadError ? convertWeiboError(error) : error;
    const errorMessage = convertedError?.message || '未知错误';
    
    console.error("[核心流程] 核心流程失败:", {
      message: errorMessage,
      errorType: convertedError?.name,
      error: convertedError
    });
    
    // Cookie 错误处理（使用 instanceof 替代魔术字符串）
    if (isCookieError(convertedError)) {
      const cookieErrorMessage = convertedError instanceof CookieExpiredError 
        ? "Cookie已过期，请重新获取Cookie"
        : "Cookie无效或格式不正确，请检查Cookie配置";
      
      console.log("[Cookie错误]", cookieErrorMessage);
      await showNotification("Cookie错误", cookieErrorMessage);
      
      // 导航到设置页面
      try {
        await emit('navigate-to', 'settings');
      } catch (emitError: any) {
        console.warn("[Cookie错误] 导航到设置失败:", emitError?.message || String(emitError));
      }
      
      return { status: 'error', message: cookieErrorMessage };
    }
    
    // 错误处理：直接通知用户
    await showNotification("上传失败", errorMessage);
    return { status: 'error', message: errorMessage };
  }
}

// 注意：processUpload 函数已被弃用，新架构使用 MultiServiceUploader
// 旧的上传逻辑已迁移到 src/core/MultiServiceUploader.ts

