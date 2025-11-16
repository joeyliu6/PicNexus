// src/weiboUploader.ts
import { 
  Body, 
  ResponseType, 
  getClient
} from '@tauri-apps/api/http';

// 从 `weibo-picture-store` 源码中 `channel.ts` 借鉴的参数
const WEIBO_PARAMS = {
  s: "xml",
  ori: "1",
  data: "1",
  rotate: "0",
  wm: "",
  app: "miniblog",
  mime: "image/jpeg", // 默认值，会被覆盖
};

// 从 `weibo-picture-store` 源码中 `upload.ts` 借鉴的端点
const UPLOAD_URL = "https://picupload.weibo.com/interface/pic_upload.php";

/**
 * 自定义错误类，用于微博上传操作
 */
export class WeiboUploadError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly httpStatus?: number,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'WeiboUploadError';
  }
}

/**
 * 验证文件字节流
 * @param fileBytes 文件字节流
 * @throws {WeiboUploadError} 如果文件无效
 */
function validateFileBytes(fileBytes: Uint8Array): void {
  if (!fileBytes || !(fileBytes instanceof Uint8Array)) {
    throw new WeiboUploadError(
      '文件数据无效：必须是 Uint8Array 类型',
      'INVALID_FILE_TYPE',
      undefined,
      new Error('fileBytes is not Uint8Array')
    );
  }

  if (fileBytes.length === 0) {
    throw new WeiboUploadError(
      '文件数据为空：无法上传空文件',
      'EMPTY_FILE',
      undefined,
      new Error('fileBytes length is 0')
    );
  }

  // 检查文件大小（微博限制通常为 20MB）
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  if (fileBytes.length > MAX_FILE_SIZE) {
    throw new WeiboUploadError(
      `文件过大：文件大小为 ${(fileBytes.length / 1024 / 1024).toFixed(2)}MB，超过限制 ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      'FILE_TOO_LARGE',
      undefined,
      new Error(`File size ${fileBytes.length} exceeds ${MAX_FILE_SIZE}`)
    );
  }

  // 检查文件大小是否过小（可能不是有效图片）
  const MIN_FILE_SIZE = 100; // 100 bytes
  if (fileBytes.length < MIN_FILE_SIZE) {
    throw new WeiboUploadError(
      '文件过小：可能不是有效的图片文件',
      'FILE_TOO_SMALL',
      undefined,
      new Error(`File size ${fileBytes.length} is too small`)
    );
  }
}

/**
 * 验证 Cookie
 * @param cookie Cookie 字符串
 * @throws {WeiboUploadError} 如果 Cookie 无效
 */
function validateCookie(cookie: string): void {
  if (!cookie || typeof cookie !== 'string') {
    throw new WeiboUploadError(
      'Cookie 无效：必须提供有效的 Cookie 字符串',
      'INVALID_COOKIE',
      undefined,
      new Error('Cookie is empty or not a string')
    );
  }

  const trimmedCookie = cookie.trim();
  if (trimmedCookie.length === 0) {
    throw new WeiboUploadError(
      'Cookie 为空：请先在设置中配置微博 Cookie',
      'EMPTY_COOKIE',
      undefined,
      new Error('Cookie is empty after trim')
    );
  }

  // 检查 Cookie 是否包含必要的字段（可选验证）
  const requiredFields = ['SUB', 'SUBP', 'SUHB', 'ALF', 'SCF'];
  const hasRequiredField = requiredFields.some(field => trimmedCookie.includes(`${field}=`));
  if (!hasRequiredField) {
    console.warn('[WeiboUploader] 警告: Cookie 可能不完整，缺少常见字段');
  }
}

/**
 * 解析微博响应 XML
 * @param xmlText XML 响应文本
 * @returns PID 字符串
 * @throws {WeiboUploadError} 如果解析失败
 */
function parseWeiboResponse(xmlText: string): string {
  if (!xmlText || typeof xmlText !== 'string' || xmlText.trim().length === 0) {
    throw new WeiboUploadError(
      '响应为空：服务器返回了空响应',
      'EMPTY_RESPONSE',
      undefined,
      new Error('Response is empty')
    );
  }

  // 检查是否是 Cookie 过期错误
  if (xmlText.includes("<data>100006</data>") || xmlText.includes("100006")) {
    throw new WeiboUploadError(
      'Cookie 已过期：请立即检查并更新 Cookie（错误码：100006）',
      'COOKIE_EXPIRED',
      undefined,
      new Error('Cookie expired (code 100006)')
    );
  }

  // 检查其他常见错误码
  const errorCodeMatch = xmlText.match(/<data>(\d+)<\/data>/);
  if (errorCodeMatch) {
    const errorCode = errorCodeMatch[1];
    // 100006: Cookie 过期
    // 100001: 参数错误
    // 100002: 文件格式不支持
    // 其他错误码
    const errorMessages: Record<string, string> = {
      '100001': '参数错误：请求参数不正确',
      '100002': '文件格式不支持：请确保上传的是有效的图片文件',
      '100006': 'Cookie 已过期：请立即检查并更新 Cookie',
    };

    if (errorMessages[errorCode]) {
      throw new WeiboUploadError(
        `${errorMessages[errorCode]}（错误码：${errorCode}）`,
        `ERROR_${errorCode}`,
        undefined,
        new Error(`Weibo API error code: ${errorCode}`)
      );
    } else {
      console.warn(`[WeiboUploader] 未知错误码: ${errorCode}`);
    }
  }

  // 尝试提取 PID
  const pidMatch = xmlText.match(/<pid>(.*?)<\/pid>/);
  if (!pidMatch || !pidMatch[1]) {
    console.error("[WeiboUploader] XML 解析失败，响应内容:", xmlText.substring(0, 500));
    throw new WeiboUploadError(
      '无法解析响应：服务器返回的响应格式不正确，可能 API 已变更',
      'PARSE_ERROR',
      undefined,
      new Error('Failed to parse PID from XML response')
    );
  }

  const pid = pidMatch[1].trim();
  if (pid.length === 0) {
    throw new WeiboUploadError(
      'PID 为空：服务器返回的 PID 无效',
      'INVALID_PID',
      undefined,
      new Error('PID is empty')
    );
  }

  // 验证 PID 格式（通常是字母数字组合）
  if (!/^[a-zA-Z0-9]+$/.test(pid)) {
    console.warn(`[WeiboUploader] 警告: PID 格式异常: ${pid}`);
  }

  return pid;
}

/**
 * 步骤 A: 上传微博
 * 逻辑基于 `weibo-picture-store` 项目源码
 * @param fileBytes 文件的字节流
 * @param cookie 用户的 Cookie 字符串
 * @returns {Promise<{hashName: string, largeUrl: string}>} "主键"
 * @throws {WeiboUploadError} 阻塞性错误
 */
export async function uploadToWeibo(
  fileBytes: Uint8Array, 
  cookie: string
): Promise<{ hashName: string; largeUrl: string }> {
  
  console.log(`[步骤 A] 开始上传到微博... (文件大小: ${(fileBytes.length / 1024).toFixed(2)}KB)`);

  // 输入验证
  try {
    validateFileBytes(fileBytes);
    validateCookie(cookie);
  } catch (error) {
    if (error instanceof WeiboUploadError) {
      throw error;
    }
    throw new WeiboUploadError(
      `输入验证失败: ${error instanceof Error ? error.message : String(error)}`,
      'VALIDATION_ERROR',
      undefined,
      error
    );
  }

  // 1. 确定 MIME 类型 (简单实现，可参考 channel.ts 扩展)
  // 微博似乎不严格校验，但我们最好提供一个
  // 暂时硬编码为 jpeg，因为 .png 上传后也会变 .jpg
  const mimeType = "image/jpeg"; // 简化处理

  // 2. 构建 URL (逻辑参考 `channel.ts`)
  let url: string;
  try {
    const params = new URLSearchParams({
      ...WEIBO_PARAMS,
      mime: mimeType,
    });
    url = `${UPLOAD_URL}?${params.toString()}`;
    console.log(`[步骤 A] 构建上传 URL: ${url}`);
  } catch (error: any) {
    throw new WeiboUploadError(
      `构建上传 URL 失败: ${error?.message || String(error)}`,
      'URL_BUILD_ERROR',
      undefined,
      error
    );
  }

  // 3. 构建请求
  // 我们使用 Tauri 的 HTTP Client 来绕过 CORS
  let client;
  try {
    client = await getClient();
  } catch (error: any) {
    throw new WeiboUploadError(
      `初始化 HTTP 客户端失败: ${error?.message || String(error)}`,
      'CLIENT_INIT_ERROR',
      undefined,
      error
    );
  }

  try {
    console.log(`[步骤 A] 发送上传请求...`);
    const response = await client.post(url, Body.bytes(fileBytes), {
      responseType: ResponseType.Text,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cookie': cookie.trim(),
        // (关键) 伪造请求头，逻辑参考 `weibo-referer.ts`
        'Referer': 'https://photo.weibo.com/',
        'Origin': 'https://photo.weibo.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
      },
      // 设置超时时间（30秒）
      timeout: 30000,
    });

    // 检查 HTTP 状态码
    if (!response.ok) {
      const status = response.status;
      let errorMessage = `HTTP 请求失败，状态码: ${status}`;
      
      // 根据状态码提供更详细的错误信息
      if (status === 401 || status === 403) {
        errorMessage = `认证失败（状态码: ${status}）：Cookie 可能已过期或无效`;
      } else if (status === 413) {
        errorMessage = `文件过大（状态码: ${status}）：请减小文件大小`;
      } else if (status === 429) {
        errorMessage = `请求过于频繁（状态码: ${status}）：请稍后再试`;
      } else if (status >= 500) {
        errorMessage = `服务器错误（状态码: ${status}）：微博服务器可能暂时不可用，请稍后重试`;
      } else if (status >= 400) {
        errorMessage = `客户端错误（状态码: ${status}）：请求参数可能不正确`;
      }

      throw new WeiboUploadError(
        errorMessage,
        `HTTP_${status}`,
        status,
        new Error(`HTTP ${status}`)
      );
    }

    // 4. 解析 XML 响应 (逻辑参考 `upload.ts`)
    const xmlText = response.data as string;
    if (!xmlText || typeof xmlText !== 'string') {
      throw new WeiboUploadError(
        '响应数据格式错误：服务器返回的数据不是文本格式',
        'INVALID_RESPONSE_TYPE',
        response.status,
        new Error('Response data is not a string')
      );
    }

    console.log(`[步骤 A] 收到响应，长度: ${xmlText.length} 字符`);
    
    let pid: string;
    try {
      pid = parseWeiboResponse(xmlText);
    } catch (error) {
      if (error instanceof WeiboUploadError) {
        throw error;
      }
      throw new WeiboUploadError(
        `解析响应失败: ${error instanceof Error ? error.message : String(error)}`,
        'PARSE_ERROR',
        response.status,
        error
      );
    }

    const hashName = `${pid}.jpg`;
    
    // 5. 构建链接 (逻辑参考 `utils.ts` 的 genExternalUrl)
    // 我们硬编码使用 tvax（目前最稳定）和 large
    const largeUrl = `https://tvax1.sinaimg.cn/large/${hashName}`;

    console.log(`[步骤 A] 微博上传成功: ${hashName} (链接: ${largeUrl})`);
    return { hashName, largeUrl };

  } catch (error: any) {
    // 如果是 WeiboUploadError，直接抛出
    if (error instanceof WeiboUploadError) {
      console.error(`[步骤 A] 微博上传失败:`, error.message);
      throw error;
    }

    // 处理网络错误
    const errorString = error?.toString() || String(error);
    const errorMessage = error?.message || errorString;
    const lowerError = errorString.toLowerCase();

    if (lowerError.includes('network error') || 
        lowerError.includes('failed to fetch') ||
        lowerError.includes('connection') ||
        lowerError.includes('timeout') ||
        lowerError.includes('超时') ||
        lowerError.includes('网络')) {
      throw new WeiboUploadError(
        '网络连接失败：请检查您的网络连接、防火墙设置或代理配置。如果问题持续，可能是微博服务器暂时不可用。',
        'NETWORK_ERROR',
        undefined,
        error
      );
    }

    // 处理超时错误
    if (lowerError.includes('timeout') || lowerError.includes('超时')) {
      throw new WeiboUploadError(
        '请求超时：上传时间过长，可能是网络较慢或文件较大。请检查网络连接或尝试减小文件大小。',
        'TIMEOUT_ERROR',
        undefined,
        error
      );
    }

    // 处理 Cookie 相关错误
    if (errorMessage.includes('Cookie') || errorMessage.includes('cookie')) {
      throw new WeiboUploadError(
        `Cookie 错误: ${errorMessage}`,
        'COOKIE_ERROR',
        undefined,
        error
      );
    }

    // 其他未知错误
    console.error("[步骤 A] 微博上传捕获到未知错误:", error);
    throw new WeiboUploadError(
      `微博上传失败: ${errorMessage || '未知错误'}。如果问题持续，请检查控制台日志获取更多信息。`,
      'UNKNOWN_ERROR',
      undefined,
      error
    );
  }
}

