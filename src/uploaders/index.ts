// src/uploaders/index.ts
// 上传器统一导出和初始化

import { UploaderFactory } from './base/UploaderFactory';
import { WeiboUploader } from './weibo/WeiboUploader';
import { R2Uploader } from './r2/R2Uploader';
import { TCLUploader } from './tcl/TCLUploader';

/**
 * 初始化所有上传器
 * 在应用启动时调用一次
 */
export function initializeUploaders(): void {
  console.log('[Uploaders] 开始注册上传器...');

  // 注册微博上传器
  UploaderFactory.register('weibo', () => new WeiboUploader());

  // 注册 R2 上传器
  UploaderFactory.register('r2', () => new R2Uploader());

  // 注册 TCL 上传器
  UploaderFactory.register('tcl', () => new TCLUploader());

  // 未来添加其他上传器：
  // UploaderFactory.register('nami', () => new NamiUploader());
  // UploaderFactory.register('jd', () => new JDUploader());
  // UploaderFactory.register('nowcoder', () => new NowcoderUploader());

  const registered = UploaderFactory.getAvailableServices();
  console.log('[Uploaders] 已注册的上传器:', registered);
}

// 导出所有上传器
export { WeiboUploader } from './weibo';
export { R2Uploader } from './r2';
export { TCLUploader } from './tcl';
export { UploaderFactory } from './base/UploaderFactory';
