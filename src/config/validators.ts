// 验证、清洗和迁移函数

import type { UserConfig } from './configInterface';
import type { HistoryItem } from './historyTypes';

/**
 * 清洗配置对象中的敏感信息（用于日志输出）
 * 将敏感字段替换为 ******，防止日志泄露
 *
 * @param config 用户配置对象
 * @returns 清洗后的配置对象（深拷贝）
 */
export function sanitizeConfig(config: UserConfig): UserConfig {
  const sanitized: UserConfig = {
    ...config,
    services: {
      weibo: config.services.weibo ? {
        ...config.services.weibo,
        cookie: sanitizeString(config.services.weibo.cookie, 8, 4)
      } : undefined,
      r2: config.services.r2 ? {
        ...config.services.r2,
        accessKeyId: sanitizeString(config.services.r2.accessKeyId, 4, 4),
        secretAccessKey: sanitizeString(config.services.r2.secretAccessKey, 0, 0)
      } : undefined,
      jd: config.services.jd,  // JD 无需清洗，没有敏感信息

      nowcoder: config.services.nowcoder ? {
        ...config.services.nowcoder,
        cookie: sanitizeString(config.services.nowcoder.cookie, 8, 4)
      } : undefined,
      // 七鱼图床 Token 由后端自动获取，无需脱敏处理
      qiyu: config.services.qiyu,
      zhihu: config.services.zhihu ? {
        ...config.services.zhihu,
        cookie: sanitizeString(config.services.zhihu.cookie, 8, 4)
      } : undefined,
      nami: config.services.nami ? {
        ...config.services.nami,
        cookie: sanitizeString(config.services.nami.cookie, 8, 4),
        authToken: sanitizeString(config.services.nami.authToken, 10, 4)
      } : undefined,
      bilibili: config.services.bilibili ? {
        ...config.services.bilibili,
        cookie: sanitizeString(config.services.bilibili.cookie, 8, 4)
      } : undefined,
      chaoxing: config.services.chaoxing ? {
        ...config.services.chaoxing,
        cookie: sanitizeString(config.services.chaoxing.cookie, 8, 4)
      } : undefined,
      smms: config.services.smms ? {
        ...config.services.smms,
        token: sanitizeString(config.services.smms.token, 4, 4)
      } : undefined,
      github: config.services.github ? {
        ...config.services.github,
        token: sanitizeString(config.services.github.token, 4, 4)
      } : undefined,
      imgur: config.services.imgur ? {
        ...config.services.imgur,
        clientId: sanitizeString(config.services.imgur.clientId, 4, 4),
        clientSecret: sanitizeString(config.services.imgur.clientSecret, 4, 4)
      } : undefined,
      tencent: config.services.tencent ? {
        ...config.services.tencent,
        secretId: sanitizeString(config.services.tencent.secretId, 4, 4),
        secretKey: sanitizeString(config.services.tencent.secretKey, 0, 0)
      } : undefined,
      aliyun: config.services.aliyun ? {
        ...config.services.aliyun,
        accessKeyId: sanitizeString(config.services.aliyun.accessKeyId, 4, 4),
        accessKeySecret: sanitizeString(config.services.aliyun.accessKeySecret, 0, 0)
      } : undefined,
      qiniu: config.services.qiniu ? {
        ...config.services.qiniu,
        accessKey: sanitizeString(config.services.qiniu.accessKey, 4, 4),
        secretKey: sanitizeString(config.services.qiniu.secretKey, 0, 0)
      } : undefined,
      upyun: config.services.upyun ? {
        ...config.services.upyun,
        password: sanitizeString(config.services.upyun.password, 0, 0),
        // 又拍云有两套凭证，S3 那对同样是密钥，漏脱敏会随日志/诊断导出泄露
        s3AccessKey: sanitizeString(config.services.upyun.s3AccessKey, 4, 4),
        s3SecretKey: sanitizeString(config.services.upyun.s3SecretKey, 0, 0)
      } : undefined
    },
    custom_s3_profiles: config.custom_s3_profiles?.map(profile => ({
      ...profile,
      accessKeyId: sanitizeString(profile.accessKeyId, 4, 4),
      secretAccessKey: sanitizeString(profile.secretAccessKey, 0, 0)
    })),
    webdav_profiles: config.webdav_profiles?.map(profile => ({
      ...profile,
      passwordEncrypted: sanitizeString(profile.passwordEncrypted, 0, 0)
    })),
    webdav: config.webdav ? {
      profiles: config.webdav.profiles.map(profile => ({
        ...profile,
        // 备份密码现在常驻密文，两个字段都要脱敏：只留 password 会让密文原样进日志
        password: sanitizeString(profile.password, 0, 0),
        passwordEncrypted: sanitizeString(profile.passwordEncrypted, 0, 0)
      })),
      activeId: config.webdav.activeId
    } : undefined,
    editorServer: config.editorServer ? {
      ...config.editorServer,
      authToken: sanitizeString(config.editorServer.authToken, 4, 4)
    } : config.editorServer
  };

  return sanitized;
}

/**
 * 清洗字符串，保留前后部分字符，中间用 ****** 替代
 *
 * @param str 要清洗的字符串
 * @param prefixLen 保留前缀长度
 * @param suffixLen 保留后缀长度
 * @returns 清洗后的字符串
 */
function sanitizeString(str: string | undefined, prefixLen: number = 0, suffixLen: number = 0): string {
  if (!str || str.trim().length === 0) {
    return '';
  }

  const trimmed = str.trim();

  // 如果字符串太短，直接返回 ******
  if (trimmed.length <= prefixLen + suffixLen) {
    return '******';
  }

  // 保留前后部分
  const prefix = prefixLen > 0 ? trimmed.substring(0, prefixLen) : '';
  const suffix = suffixLen > 0 ? trimmed.substring(trimmed.length - suffixLen) : '';

  return `${prefix}******${suffix}`;
}

/**
 * 验证对象是否为有效的 UserConfig 格式
 * 用于防止导入错误格式的数据（如历史记录数据）覆盖配置
 *
 * @param obj 要验证的对象
 * @returns 是否为有效的 UserConfig 格式
 */
export function isValidUserConfig(obj: unknown): obj is UserConfig {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const config = obj as Record<string, unknown>;

  // 1. 不应该是数字索引对象（历史记录数据的特征：{"0": {...}, "1": {...}}）
  const keys = Object.keys(config);
  if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
    return false;
  }

  // 2. 不应该包含历史记录特有的字段
  if ('localFileName' in config || 'results' in config || 'generatedLink' in config) {
    return false;
  }

  // 3. 必须包含 UserConfig 的必要字段（enabledServices 必须是数组）
  if (!Array.isArray(config.enabledServices)) {
    return false;
  }

  // 4. services 如果存在必须是对象
  if (config.services !== undefined && (typeof config.services !== 'object' || config.services === null)) {
    return false;
  }

  return true;
}

/**
 * 验证单个上传结果对象的结构
 */
function isValidUploadResultEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }

  const e = entry as Record<string, unknown>;

  // 必需字段
  if (typeof e.serviceId !== 'string') return false;
  if (e.status !== 'success' && e.status !== 'failed') return false;

  // 可选字段类型检查
  if (e.error !== undefined && typeof e.error !== 'string') return false;

  return true;
}

/**
 * 判断一条记录能否被导入历史库
 *
 * 这是导入链路的**唯一真相源**：本地文件导入（`useBackupLocal.importHistoryLocal`）与
 * 云端下载（`ImportExportService.importHistoryFromJson`）都走它。此前两条路径各有一套谓词，
 * 互有松紧——底层要求 `timestamp > 0`、`localFileName`/`primaryService` 非空却不查 `id`，
 * 而 `isValidHistoryItem` 要求 `id` 非空却放行 `timestamp <= 0` 和空文件名——同一份文件
 * 走两条路会得到不同结论。
 *
 * ⚠️ **刻意不要求 `id`**：`ImportExportService` 明确支持缺 id 的记录并会自动补一个
 * （见该文件「预处理：确保所有记录都有 ID」）。把 id 列为必需会让那段兼容逻辑变成死代码，
 * 手写或第三方导出的历史文件会被整份拒绝。
 *
 * ⚠️ **刻意不做 `results` 逐项深检**：导出侧（`exportHistoryToJson`）不做任何校验，
 * 一旦这里比导出侧严，PicNexus 自己导出的文件就可能导不回来（无损往返被打破）；
 * 更糟的是 replace 模式下被判无效的记录会连带删掉本地同 id 的行。深检留给
 * {@link isValidHistoryItem}——那是「完整 HistoryItem 形状」的判据，用途不同。
 */
export function isImportableHistoryItem(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

  const item = obj as Record<string, unknown>;

  if (typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp) || item.timestamp <= 0) return false;
  if (typeof item.localFileName !== 'string' || !item.localFileName) return false;
  if (typeof item.primaryService !== 'string' || !item.primaryService) return false;
  if (typeof item.generatedLink !== 'string') return false;
  if (!Array.isArray(item.results)) return false;
  // results 条目必须是非空对象：`[null]`/`[5]` 这类脏数据会在 DataTransformer 派生存量列时
  // 被 isUsableMirror(null) 访问 r.status 触发 TypeError——导入无事务包裹，超过一个批
  // （500 条）就会先写几批再崩，留下部分导入的残局。
  // ⚠️ 只拒非对象；不做 `{serviceId,status}` 的完整形状深检（那会打破导出/导入的无损往返）。
  for (const entry of item.results) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  }

  return true;
}

/**
 * 验证对象是否为**完整**的 HistoryItem（含 id 与 results 逐项深检）
 *
 * 与 {@link isImportableHistoryItem} 的分工：这里判的是「形状完整、可以当 HistoryItem 用」，
 * 那里判的是「可以往历史库里写」。导入链路请用后者，不要用本函数——见其 doc 里的两条 ⚠️。
 */
export function isValidHistoryItem(obj: unknown): obj is HistoryItem {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const item = obj as Record<string, unknown>;

  // 必需字段检查
  if (typeof item.id !== 'string' || item.id.trim().length === 0) return false;
  if (typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp)) return false;
  if (typeof item.localFileName !== 'string') return false;
  if (typeof item.primaryService !== 'string') return false;
  if (typeof item.generatedLink !== 'string') return false;

  // results 数组深度验证
  if (!Array.isArray(item.results)) return false;
  if (!item.results.every(isValidUploadResultEntry)) return false;

  // 可选字段类型检查
  if (item.filePath !== undefined && typeof item.filePath !== 'string') return false;
  if (item.isFavorited !== undefined && typeof item.isFavorited !== 'boolean') return false;
  if (
    item.favoriteUpdatedAt !== undefined
    && (typeof item.favoriteUpdatedAt !== 'number' || !Number.isFinite(item.favoriteUpdatedAt))
  ) {
    return false;
  }
  if (item.favoriteUpdatedBy !== undefined && typeof item.favoriteUpdatedBy !== 'string') return false;

  return true;
}
