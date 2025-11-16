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
 * 步骤 A: 上传微博
 * 逻辑基于 `weibo-picture-store` 项目源码
 * @param fileBytes 文件的字节流
 * @param cookie 用户的 Cookie 字符串
 * @returns {Promise<{hashName: string, largeUrl: string}>} "主键"
 * @throws {Error} 阻塞性错误 "微博上传失败！..."
 */
export async function uploadToWeibo(
  fileBytes: Uint8Array, 
  cookie: string
): Promise<{ hashName: string; largeUrl: string }> {
  
  console.log(`[步骤 A] 开始上传到微博...`);

  // 1. 确定 MIME 类型 (简单实现，可参考 channel.ts 扩展)
  // 微博似乎不严格校验，但我们最好提供一个
  // 暂时硬编码为 jpeg，因为 .png 上传后也会变 .jpg
  const mimeType = "image/jpeg"; // 简化处理

  // 2. 构建 URL (逻辑参考 `channel.ts`)
  const params = new URLSearchParams({
    ...WEIBO_PARAMS,
    mime: mimeType,
  });
  const url = `${UPLOAD_URL}?${params.toString()}`;

  // 3. 构建请求
  // 我们使用 Tauri 的 HTTP Client 来绕过 CORS
  const client = await getClient();

  try {
    const response = await client.post(url, Body.bytes(fileBytes), {
      responseType: ResponseType.Text,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cookie': cookie,
        // (关键) 伪造请求头，逻辑参考 `weibo-referer.ts`
        'Referer': 'https://photo.weibo.com/',
        'Origin': 'https://photo.weibo.com',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP 状态码: ${response.status}`);
    }

    // 4. 解析 XML 响应 (逻辑参考 `upload.ts`)
    const xmlText = response.data as string;
    const pidMatch = xmlText.match(/<pid>(.*?)<\/pid>/);
    
    if (!pidMatch || !pidMatch[1]) {
      console.error("XML 解析失败:", xmlText);
      // 检查是否是 Cookie 问题
      if (xmlText.includes("<data>100006</data>")) {
         throw new Error("微博上传失败！请立即检查并更新 Cookie！");
      }
      throw new Error("微博上传失败，无法解析响应。");
    }

    const pid = pidMatch[1];
    const hashName = `${pid}.jpg`;
    
    // 5. 构建链接 (逻辑参考 `utils.ts` 的 genExternalUrl)
    // 我们硬编码使用 tvax（目前最稳定）和 large
    const largeUrl = `https://tvax1.sinaimg.cn/large/${hashName}`;

    console.log("[步骤 A] 微博上传成功:", hashName);
    return { hashName, largeUrl };

  } catch (error: any) {
    console.error("[步骤 A] 微博上传捕获到错误:", error);
    if (error.message && error.message.includes("Cookie")) {
      throw error;
    }
    // 检查是否是网络错误（Tauri http 客户端在网络失败时会 reject）
    if (error.toString().includes('Network Error') || error.toString().includes('Failed to fetch')) {
      throw new Error("微博上传失败！网络错误或无法连接 API。");
    }
    throw new Error(`微博上传失败: ${error.message || '未知错误'}`);
  }
}

