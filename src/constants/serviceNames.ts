/**
 * 图床服务显示名称映射
 */

export const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  weibo: '微博',
  r2: 'R2',
  jd: '京东',
  nowcoder: '牛客',
  qiyu: '七鱼',
  zhihu: '知乎',
  nami: '纳米',
  bilibili: 'B站',
  chaoxing: '超星',
  smms: 'SM.MS',
  github: 'GitHub',
  imgur: 'Imgur',
  tencent: '腾讯云',
  aliyun: '阿里云',
  qiniu: '七牛云',
  upyun: '又拍云',
} as const;

/**
 * 获取服务显示名称
 */
export function getServiceDisplayName(serviceId: string): string {
  return SERVICE_DISPLAY_NAMES[serviceId] || serviceId;
}
