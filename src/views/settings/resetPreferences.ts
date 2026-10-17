// 恢复默认设置（S06：「偏好恢复默认值；保留图床账号与记录」）：只把偏好换回出厂值。
// 留着的：图床（凭证、已添加 / 启用、多份图床、微博前缀）、云同步连接、文档文件夹、是否看过引导与风险说明；
// 上传记录在数据库里，本来就不在配置里。编辑器服务的 authToken 也留着，免得已配好的 Obsidian 插件连不上。
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

export function resetPreferences(config: UserConfig): UserConfig {
  const d = structuredClone(DEFAULT_CONFIG);
  return {
    ...config,
    theme: d.theme,
    analytics: d.analytics,
    appBehavior: d.appBehavior,
    globalShortcut: d.globalShortcut,
    autoUpdate: d.autoUpdate,
    linkOutput: d.linkOutput,
    imageCompression: d.imageCompression,
    galleryViewPreferences: d.galleryViewPreferences,
    editorServer: { ...d.editorServer!, authToken: config.editorServer?.authToken },
    linkHealth: { ...d.linkHealth!, docFolders: config.linkHealth?.docFolders ?? [] },
  };
}
