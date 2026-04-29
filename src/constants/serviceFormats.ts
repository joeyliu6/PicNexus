// 各图床支持的图片格式（白名单）
// 数据来源：src-tauri/src/commands/ 中各图床的格式校验代码
// 不在表中的图床 = 无格式限制（如 R2、腾讯云、阿里云、七牛、又拍、GitHub、微博、纳米）

import type { ServiceType } from '../config/types';

const SERVICE_SUPPORTED_FORMATS: Partial<Record<ServiceType, string[]>> = {
  jd:       ['jpg', 'jpeg', 'png', 'gif'],
  nowcoder: ['jpg', 'jpeg', 'png', 'gif'],
  bilibili: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  zhihu:    ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  chaoxing: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
  smms:     ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'],
  imgur:    ['jpg', 'jpeg', 'png', 'gif', 'apng', 'tiff', 'bmp', 'webp'],
  qiyu:     ['jpg', 'jpeg', 'png', 'gif', 'webp'],
};

export function getFileExtension(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * 判断指定图床是否不支持给定的文件格式
 * 不在注册表中的图床视为无限制（返回 false）
 */
export function needsFormatConversion(serviceId: string, ext: string): boolean {
  const formats = SERVICE_SUPPORTED_FORMATS[serviceId as ServiceType];
  if (!formats) return false;
  return !formats.includes(ext.toLowerCase());
}

export function getUnsupportedServicesForFormat(serviceIds: string[], ext: string): string[] {
  if (!ext) return [];
  return serviceIds.filter(serviceId => needsFormatConversion(serviceId, ext));
}

export function getSupportedServicesForFormat(serviceIds: string[], ext: string): string[] {
  if (!ext) return [...serviceIds];
  return serviceIds.filter(serviceId => !needsFormatConversion(serviceId, ext));
}
