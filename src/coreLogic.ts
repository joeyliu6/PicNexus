// src/coreLogic.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { writeText as writeToClipboard } from "@tauri-apps/api/clipboard";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/api/notification";
import { readBinaryFile } from '@tauri-apps/api/fs';
import { getClient, Body } from '@tauri-apps/api/http';
import { uploadToWeibo, WeiboUploadError } from './weiboUploader';
import { UserConfig, R2Config, HistoryItem, FailedItem } from './config';
import { Store, StoreError } from './store';
import { basename } from '@tauri-apps/api/path';
import { emit } from '@tauri-apps/api/event';
import { 
  CookieExpiredError, 
  InvalidCookieError, 
  NetworkError, 
  TimeoutError,
  FileReadError,
  R2Error,
  WebDAVError,
  convertWeiboError,
  isRetryableError,
  isCookieError,
  isNetworkError
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
function validateR2Config(config: R2Config): { valid: boolean; missingFields: string[] } {
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
 * @returns {Promise<string | null>} 成功返回 r2Key，失败或未配置返回 null
 * @throws {Error} 非阻塞性错误 "R2 备份失败"
 */
async function backupToR2(
  fileBytes: Uint8Array, // 接受字节流
  hashName: string, 
  config: R2Config,
  timeoutMs: number = 60000 // 默认60秒超时
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
    // 使用超时保护包装上传操作
    const uploadPromise = r2Client.send(new PutObjectCommand({
      Bucket: bucketName.trim(),
      Key: key,
      Body: fileBytes, // 使用字节流
      ContentType: contentType, // 设置正确的 MIME 类型
    }));
    
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

  const format = config.outputFormat || 'baidu';
  
  switch (format) {
    case 'weibo':
      console.log(`[步骤 C] 使用微博原始链接: ${weiboLargeUrl}`);
      return weiboLargeUrl;
      
    case 'r2':
      // v2.1: 检查 R2 公开域，如果不存在则回退到微博链接
      const publicDomain = config.r2?.publicDomain;
      if (!publicDomain || !publicDomain.trim() || !publicDomain.startsWith('http')) {
        const warningMsg = "警告：R2 公开访问域名未配置或格式不正确，回退到微博链接。";
        console.warn(`[步骤 C] ${warningMsg}`);
        console.warn(`[步骤 C] 当前配置的域名: ${publicDomain || '(空)'}`);
        await showNotification("R2 链接生成失败！", "请在设置中配置 R2 公开访问域。");
        // 回退到微博链接
        return weiboLargeUrl;
      }
      
      // 验证域名格式
      try {
        new URL(publicDomain); // 验证 URL 格式
      } catch (urlError) {
        console.error(`[步骤 C] R2 域名格式错误: ${publicDomain}`, urlError);
        await showNotification("R2 链接生成失败！", `R2 公开访问域名格式不正确: ${publicDomain}`);
        return weiboLargeUrl;
      }
      
      const domain = publicDomain.endsWith('/') ? publicDomain.slice(0, -1) : publicDomain;
      const path = config.r2?.path || '';
      const key = (path.endsWith('/') || path === '' ? path : path + '/') + hashName;
      const r2Link = `${domain}/${key}`;
      console.log(`[步骤 C] 使用 R2 链接: ${r2Link}`);
      return r2Link;
      
    case 'baidu':
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

  if (!config.weiboCookie || typeof config.weiboCookie !== 'string' || config.weiboCookie.trim().length === 0) {
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

  let fileBytes: Uint8Array;
  try {
    console.log(`[核心流程] 开始读取文件: ${filePath}`);
    
    // 添加读取超时保护（30秒）
    const readPromise = readBinaryFile(filePath);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('文件读取超时（超过30秒）')), 30000);
    });
    
    fileBytes = await Promise.race([readPromise, timeoutPromise]);
    
    if (!fileBytes || !(fileBytes instanceof Uint8Array)) {
      throw new Error("文件读取失败：返回的数据格式不正确");
    }
    
    if (fileBytes.length === 0) {
      throw new Error("文件读取失败：文件为空");
    }
    
    console.log(`[核心流程] 文件读取成功，大小: ${(fileBytes.length / 1024).toFixed(2)}KB`);
    
    // 验证文件类型
    const fileType = detectFileType(fileBytes);
    if (!fileType) {
      console.warn(`[核心流程] 警告: 无法识别文件类型，文件可能不是有效的图片`);
    } else {
      console.log(`[核心流程] 检测到文件类型: ${fileType}`);
    }
    
    // 验证文件不是空文件或损坏文件
    if (fileBytes.length < 100) {
      throw new Error("文件过小（小于100字节），可能是损坏的文件");
    }
  } catch (readError: any) {
    const errorMsg = readError?.message || String(readError);
    const lowerError = errorMsg.toLowerCase();
    
    let userMessage = "无法读取文件";
    
    if (lowerError.includes('permission') || lowerError.includes('权限') || lowerError.includes('denied')) {
      userMessage = "文件读取失败：权限不足，请检查文件权限设置";
    } else if (lowerError.includes('not found') || lowerError.includes('不存在') || lowerError.includes('找不到')) {
      userMessage = "文件读取失败：文件不存在或已被删除";
    } else if (lowerError.includes('locked') || lowerError.includes('被占用') || lowerError.includes('正在使用')) {
      userMessage = "文件读取失败：文件被其他程序占用，请关闭相关程序后重试";
    } else if (lowerError.includes('path') || lowerError.includes('路径')) {
      userMessage = `文件读取失败：路径无效 (${errorMsg})`;
    } else {
      userMessage = `文件读取失败: ${errorMsg}`;
    }
    
    console.error("[核心流程] 文件读取失败:", {
      filePath,
      error: errorMsg,
      details: readError
    });
    await showNotification("上传失败", userMessage);
    return { status: 'error', message: userMessage };
  }

  try {
    // --- [步骤 A - 上传微博] (串行) ---
    // 使用新的、真实的上传器
    const { hashName, largeUrl } = await uploadToWeibo(
      fileBytes, 
      config.weiboCookie,
      detectFileType(fileBytes) || 'image/jpeg'
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
      
      // 从 hashName 提取 PID (例如: 006G4xsfgy1h8pbgtnqirj.jpg -> 006G4xsfgy1h8pbgtnqirj)
      const weiboPid = hashName.replace(/\.jpg$/, '');
      
      // [步骤 B - 备份R2] (并行 - 异步，但等待结果以保存 r2Key)
      let finalR2Key: string | null = null;
      try {
        finalR2Key = await backupToR2(fileBytes, hashName, config.r2);
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
      
      const newItem: HistoryItem = { 
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9), // 使用时间戳+随机字符串作为唯一 ID
        timestamp: Date.now(), 
        localFileName: name,
        weiboPid: weiboPid,
        generatedLink: finalLink,
        r2Key: finalR2Key
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
    
    // v2.1: 失败重试队列逻辑
    // 使用 isRetryableError 函数判断是否可重试
    const retryable = isRetryableError(convertedError);
    
    if (retryable) {
      // 可重试错误：添加到失败队列
      try {
        const retryStore = new Store('.retry.dat');
        let items: FailedItem[] = [];
        
        try {
          items = await retryStore.get<FailedItem[]>('failed') || [];
          if (!Array.isArray(items)) {
            items = [];
          }
        } catch (readError: any) {
          console.warn("[失败队列] 读取失败队列失败，使用空数组:", readError?.message || String(readError));
          items = [];
        }
        
        let name: string;
        try {
          name = await basename(filePath);
          if (!name || name.trim().length === 0) {
            name = filePath.split(/[/\\]/).pop() || '未知文件';
          }
        } catch (nameError: any) {
          name = filePath.split(/[/\\]/).pop() || '未知文件';
        }
        
        const newItem: FailedItem = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          filePath: filePath,
          configSnapshot: { ...config }, // 保存配置快照
          errorMessage: errorMessage,
        };
        
        const newItems = [newItem, ...items];
        
        try {
          await retryStore.set('failed', newItems);
          await retryStore.save();
          console.log(`[失败队列] ✅ 已添加到失败队列，共 ${newItems.length} 项`);
        } catch (saveError: any) {
          if (saveError instanceof StoreError) {
            console.error(`[失败队列] 保存失败 (${saveError.operation}):`, saveError.message);
          } else {
            console.error("[失败队列] 保存失败:", saveError?.message || String(saveError));
          }
          throw saveError;
        }
        
        // 发出事件通知侧边栏更新角标
        try {
          await emit('update-failed-count', newItems.length);
        } catch (emitError: any) {
          console.warn("[失败队列] 发送事件失败:", emitError?.message || String(emitError));
        }
        
        // 发送非阻塞通知
        await showNotification("文件上传失败", `已将 ${name} 添加到重试队列。`);
        
        return { status: 'failed', message: errorMessage };
      } catch (retryError: any) {
        const retryErrorMsg = retryError?.message || String(retryError);
        console.error("[失败队列] 保存失败项失败:", retryErrorMsg);
        // 如果保存失败，按原样通知用户
        await showNotification("上传失败", `${errorMessage}（且无法保存到重试队列）`);
        return { status: 'error', message: errorMessage };
      }
    } else {
      // 不可重试错误：直接通知用户
      await showNotification("上传失败", errorMessage);
      return { status: 'error', message: errorMessage };
    }
  }
}

/**
 * 处理单个文件上传（支持进度报告）
 * v2.0 新增 - 用于上传队列管理器
 * @param filePath 文件路径
 * @param config 用户配置
 * @param options 选项（是否上传到R2等）
 * @param onProgress 进度回调函数
 * @returns 上传结果
 */
export async function processUpload(
  filePath: string,
  config: UserConfig,
  options: { uploadToR2: boolean },
  onProgress: UploadProgressCallback
): Promise<{ status: 'success' | 'error'; link?: string; message?: string }> {
  try {
    // 验证输入
    validateFilePath(filePath);
    validateUserConfig(config);

    // 读取文件
    let fileBytes: Uint8Array;
    try {
      console.log(`[processUpload] 开始读取文件: ${filePath}`);
      
      const readPromise = readBinaryFile(filePath);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('文件读取超时（超过30秒）')), 30000);
      });
      
      fileBytes = await Promise.race([readPromise, timeoutPromise]);
      
      if (!fileBytes || !(fileBytes instanceof Uint8Array)) {
        throw new Error("文件读取失败：返回的数据格式不正确");
      }
      
      if (fileBytes.length === 0) {
        throw new Error("文件读取失败：文件为空");
      }
      
      console.log(`[processUpload] 文件读取成功，大小: ${(fileBytes.length / 1024).toFixed(2)}KB`);
      
      // 验证文件类型
      const fileType = detectFileType(fileBytes);
      if (!fileType) {
        console.warn(`[processUpload] 警告: 无法识别文件类型`);
      } else {
        console.log(`[processUpload] 检测到文件类型: ${fileType}`);
      }
      
      if (fileBytes.length < 100) {
        throw new Error("文件过小（小于100字节），可能是损坏的文件");
      }
    } catch (readError: any) {
      const errorMsg = readError?.message || String(readError);
      console.error("[processUpload] 文件读取失败:", errorMsg);
      onProgress({ type: 'error', payload: errorMsg });
      return { status: 'error', message: errorMsg };
    }

    // 步骤 1: 上传微博
    let hashName: string;
    let largeUrl: string;
    let weiboPid: string;
    
    try {
      console.log('[processUpload] 步骤 1: 开始上传到微博...');
      
      // 模拟进度更新（因为当前uploadToWeibo不支持进度回调）
      // 创建一个平滑的进度条更新
      let currentProgress = 10;
      onProgress({ type: 'weibo_progress', payload: currentProgress });
      
      // 创建一个定时器，模拟上传进度
      const progressInterval = setInterval(() => {
        if (currentProgress < 90) {
          // 每100ms增加5-15%的进度
          currentProgress += Math.min(5 + Math.random() * 10, 90 - currentProgress);
          onProgress({ type: 'weibo_progress', payload: Math.floor(currentProgress) });
        }
      }, 100);
      
      try {
        const uploadResult = await uploadToWeibo(
          fileBytes, 
          config.weiboCookie,
          detectFileType(fileBytes) || 'image/jpeg'
        );
        hashName = uploadResult.hashName;
        largeUrl = uploadResult.largeUrl;
        weiboPid = hashName.replace(/\.jpg$/, '');
      } finally {
        // 清除定时器
        clearInterval(progressInterval);
      }
      
      onProgress({ type: 'weibo_progress', payload: 100 });
      
      // 生成百度代理链接
      const baiduPrefix = config.baiduPrefix || 'https://image.baidu.com/search/down?thumburl=';
      const baiduLink = `${baiduPrefix}${largeUrl}`;
      
      onProgress({
        type: 'weibo_success',
        payload: { pid: weiboPid, largeUrl, baiduLink }
      });
      
      console.log(`[processUpload] ✓ 微博上传成功: ${hashName}`);
    } catch (error: any) {
      const errorMsg = error instanceof WeiboUploadError 
        ? error.message 
        : (error?.message || '微博上传失败');
      console.error('[processUpload] 微博上传失败:', errorMsg);
      onProgress({ type: 'error', payload: errorMsg });
      return { status: 'error', message: errorMsg };
    }

    // 步骤 2: 上传 R2 (可选)
    let finalR2Key: string | null = null;
    let r2Link: string | null = null;
    
    if (options.uploadToR2) {
      try {
        console.log('[processUpload] 步骤 2: 开始上传到 R2...');
        
        // 模拟R2上传进度
        let r2Progress = 10;
        onProgress({ type: 'r2_progress', payload: r2Progress });
        
        // 创建一个定时器，模拟R2上传进度
        const r2ProgressInterval = setInterval(() => {
          if (r2Progress < 90) {
            // 每100ms增加5-15%的进度
            r2Progress += Math.min(5 + Math.random() * 10, 90 - r2Progress);
            onProgress({ type: 'r2_progress', payload: Math.floor(r2Progress) });
          }
        }, 100);
        
        try {
          finalR2Key = await backupToR2(fileBytes, hashName, config.r2);
        } finally {
          // 清除定时器
          clearInterval(r2ProgressInterval);
        }
        
        if (finalR2Key) {
          onProgress({ type: 'r2_progress', payload: 100 });
          
          // 生成 R2 公开链接
          const publicDomain = config.r2?.publicDomain;
          if (publicDomain && publicDomain.trim() && publicDomain.startsWith('http')) {
            const domain = publicDomain.endsWith('/') ? publicDomain.slice(0, -1) : publicDomain;
            r2Link = `${domain}/${finalR2Key}`;
          }
          
          onProgress({
            type: 'r2_success',
            payload: { key: finalR2Key, r2Link }
          });
          
          console.log(`[processUpload] ✓ R2 上传成功: ${finalR2Key}`);
        } else {
          console.log('[processUpload] R2 未配置，跳过上传');
        }
      } catch (r2Error: any) {
        const r2ErrorMsg = r2Error?.message || String(r2Error);
        console.warn('[processUpload] R2 上传失败（非阻塞）:', r2ErrorMsg);
        // R2 失败不影响主流程，只记录日志
        await showNotification("R2 备份失败", r2ErrorMsg);
      }
    }

    // 步骤 3: 生成最终链接
    const finalLink = await generateLink(largeUrl, hashName, config);

    // 步骤 4: 保存历史记录
    try {
      const historyStore = new Store('.history.dat');
      let items: HistoryItem[] = [];
      
      try {
        items = await historyStore.get<HistoryItem[]>('uploads') || [];
        if (!Array.isArray(items)) {
          items = [];
        }
      } catch (readError: any) {
        console.error("[processUpload] 读取历史记录失败:", readError?.message || String(readError));
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
        name = filePath.split(/[/\\]/).pop() || '未知文件';
      }
      
      const newItem: HistoryItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        localFileName: name,
        weiboPid: weiboPid,
        generatedLink: finalLink,
        r2Key: finalR2Key
      };

      const newItems = [newItem, ...items];
      
      try {
        await historyStore.set('uploads', newItems);
        await historyStore.save();
        console.log(`[processUpload] ✓ 历史记录已保存`);
      } catch (saveError: any) {
        console.error("[processUpload] 保存历史记录失败:", saveError?.message || String(saveError));
      }

      // 自动同步到 WebDAV
      syncHistoryToWebDAV(newItems, config).catch(err => {
        console.error("[processUpload] WebDAV 同步失败:", err?.message || String(err));
      });
    } catch (historyError: any) {
      console.error("[processUpload] 历史记录处理失败:", historyError?.message || String(historyError));
    }

    // 完成
    onProgress({ type: 'complete', payload: { link: finalLink } });
    
    console.log(`[processUpload] ✓ 上传完成: ${finalLink}`);
    return { status: 'success', link: finalLink };

  } catch (error: any) {
    const errorMsg = error?.message || '未知错误';
    console.error('[processUpload] 上传失败:', errorMsg);
    onProgress({ type: 'error', payload: errorMsg });
    return { status: 'error', message: errorMsg };
  }
}

