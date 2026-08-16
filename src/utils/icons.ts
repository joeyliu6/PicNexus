import { isCustomS3Id, isWebDAVId } from '../config/types';

// 通用图标加载器工厂
function createIconLoader<T extends string = string>(
  modules: Record<string, string>
): Map<T, string> {
  const map = new Map<T, string>();
  for (const [path, content] of Object.entries(modules)) {
    const match = path.match(/\/([^/]+)\.svg$/);
    if (match) {
      map.set(match[1] as T, content);
    }
  }
  return map;
}

// 服务图标
const serviceModules = import.meta.glob<string>(
  '../assets/icons/services/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);
const serviceIconMap = createIconLoader(serviceModules);

export function getServiceIcon(service: string): string | undefined {
  return serviceIconMap.get(service);
}

/**
 * 服务 logo 的来源：本地 SVG 资源，或 PrimeIcons 字体图标类名
 */
export type ServiceLogoSource =
  | { kind: 'svg'; svg: string }
  | { kind: 'icon'; className: string };

/**
 * 解析服务 logo
 *
 * Why 需要这层：`serviceIconMap` 的 key 是 SVG 文件名，而多实例图床用的是复合 ID
 * （`custom_s3:<profileId>` / `webdav:<profileId>`），永远匹配不到任何文件。
 * 这类私有存储也没有品牌 logo 可用——用户的 MinIO 和 NAS 长什么样只有他自己知道，
 * 所以按「类型」退到通用图标：对象存储用桶，WebDAV 用服务器。
 *
 * 后续若补了 `custom_s3.svg` / `webdav.svg`，SVG 分支会自动优先命中，消费方无需改动。
 */
export function resolveServiceLogo(serviceId: string): ServiceLogoSource {
  const svg = serviceIconMap.get(serviceId);
  if (svg) return { kind: 'svg', svg };
  if (isCustomS3Id(serviceId)) return { kind: 'icon', className: 'pi pi-database' };
  if (isWebDAVId(serviceId)) return { kind: 'icon', className: 'pi pi-server' };
  return { kind: 'icon', className: 'pi pi-cloud' };
}

