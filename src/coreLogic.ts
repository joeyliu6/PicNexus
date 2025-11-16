// src/coreLogic.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { writeText as writeToClipboard } from "@tauri-apps/api/clipboard";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/api/notification";
import { readBinaryFile } from '@tauri-apps/api/fs';
import { uploadToWeibo } from './weiboUploader';
import { UserConfig, R2Config, HistoryItem } from './config';
import { Store } from './store';
import { basename } from '@tauri-apps/api/path';

/**
 * 步骤 B: 备份 R2 (并行, 非阻塞性)
 * @returns {Promise<string | null>} 成功返回 r2Key，失败或未配置返回 null
 * @throws {Error} 非阻塞性错误 "R2 备份失败"
 */
async function backupToR2(
  fileBytes: Uint8Array, // 接受字节流
  hashName: string, 
  config: R2Config
): Promise<string | null> {
  console.log(`[步骤 B] 开始异步备份 ${hashName} 到 R2...`);
  const { accountId, accessKeyId, secretAccessKey, bucketName, path = '' } = config;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    console.log("[步骤 B] R2 未配置或配置不全，跳过备份。");
    return null; // 如果未配置，返回 null
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const r2Client = new S3Client({
    region: 'auto',
    endpoint: endpoint,
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    }
  });

  const key = (path.endsWith('/') || path === '' ? path : path + '/') + hashName;

  try {
    await r2Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBytes, // 使用字节流
    }));
    console.log(`[步骤 B] R2 备份成功: ${key}`);
    return key; // 返回 R2 Key
  } catch (error) {
    console.error("[步骤 B] R2 备份失败:", error);
    throw new Error("警告：R2 备份失败，请检查配置。");
  }
}

/**
 * 步骤 C: 生成链接 (并行)
 */
function generateLink(
  weiboLargeUrl: string, 
  hashName: string, 
  config: UserConfig
): string {
  console.log("[步骤 C] 生成最终链接...");
  switch (config.outputFormat) {
    case 'weibo':
      return weiboLargeUrl;
    case 'r2':
      // PRD 3.4: 动态使用 R2 公开域名
      const publicDomain = config.r2.publicDomain;
      if (!publicDomain) {
        console.warn("警告：R2 公开访问域名未配置，将使用占位符。");
      }
      const domain = publicDomain || 'https://<YOUR_R2_PUBLIC_DOMAIN>';
      const path = config.r2.path || '';
      const key = (path.endsWith('/') || path === '' ? path : path + '/') + hashName;
      return `${domain}/${key}`; 
    case 'baidu':
    default:
      return `${config.baiduPrefix}${weiboLargeUrl}`;
  }
}

/**
 * 弹出系统通知
 */
async function showNotification(title: string, body?: string) {
  if (!(await isPermissionGranted())) {
    await requestPermission();
  }
  sendNotification({ title, body });
}

/**
 * * * (核心工作流) 处理用户拖拽的文件
 * * */
export async function handleFileUpload(filePath: string, config: UserConfig) {
  
  let fileBytes: Uint8Array;
  try {
    // 新增步骤：从Tauri提供的路径读取文件为字节流
    fileBytes = await readBinaryFile(filePath);
  } catch (readError) {
    console.error("文件读取失败:", readError);
    await showNotification("上传失败", "无法读取文件。");
    return { status: 'error', message: '文件读取失败' };
  }

  try {
    // --- [步骤 A - 上传微博] (串行) ---
    // 使用新的、真实的上传器
    const { hashName, largeUrl } = await uploadToWeibo(
      fileBytes, 
      config.weiboCookie
    );

    // --- 步骤 A 成功后 ---

    // [步骤 C - 生成链接] (并行)
    const finalLink = generateLink(largeUrl, hashName, config);

    // --- [输出] ---
    await writeToClipboard(finalLink);
    await showNotification("上传成功！", "链接已复制到剪贴板。");
    
    // ===============================================
    //           ( ( ( 新增：保存历史记录 ) ) )
    // ===============================================
    try {
      const historyStore = new Store('.history.dat');
      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      
      // 获取本地文件名
      const name = await basename(filePath);
      
      // 从 hashName 提取 PID (例如: 006G4xsfgy1h8pbgtnqirj.jpg -> 006G4xsfgy1h8pbgtnqirj)
      const weiboPid = hashName.replace(/\.jpg$/, '');
      
      // [步骤 B - 备份R2] (并行 - 异步，但等待结果以保存 r2Key)
      let finalR2Key: string | null = null;
      try {
        finalR2Key = await backupToR2(fileBytes, hashName, config.r2);
      } catch (r2Error: any) {
        // [非阻塞性错误通知]
        showNotification(r2Error.message);
        finalR2Key = null; // 失败时保持为 null
      }
      
      const newItem: HistoryItem = { 
        id: Date.now().toString(), // 使用时间戳作为唯一 ID
        timestamp: Date.now(), 
        localFileName: name,
        weiboPid: weiboPid,
        generatedLink: finalLink,
        r2Key: finalR2Key
      };

      // 添加新记录到最前面，永久保存（不再限制 20 条）
      const newItems = [newItem, ...items];
      
      await historyStore.set('uploads', newItems);
      await historyStore.save();
      console.log("[历史记录] 已保存成功。");

    } catch (historyError) {
      console.error("[历史记录] 保存失败:", historyError);
      // 这是一个非阻塞性错误，只在控制台记录
    }
    // ===============================================
    //           ( ( ( 历史记录结束 ) ) )
    // ===============================================

    return { status: 'success', link: finalLink };

  } catch (error: any) {
    // --- [阻塞性错误处理] ---
    // 捕获 [步骤 A] 的失败
    console.error("核心流程失败:", error);
    await showNotification("上传失败", error.message);
    
    return { status: 'error', message: error.message };
  }
}

