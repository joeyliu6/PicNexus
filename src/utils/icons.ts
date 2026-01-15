import type { ServiceType } from '../config/types';

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

// 分类图标
const categoryModules = import.meta.glob<string>(
  '../assets/icons/categories/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);
const categoryIconMap = createIconLoader(categoryModules);

export function getCategoryIcon(category: string): string | undefined {
  return categoryIconMap.get(category);
}

// 插画图标
const illustrationModules = import.meta.glob<string>(
  '../assets/icons/illustrations/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);
const illustrationMap = createIconLoader(illustrationModules);

export function getIllustration(name: string): string | undefined {
  return illustrationMap.get(name);
}

// 服务图标
const serviceModules = import.meta.glob<string>(
  '../assets/icons/services/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);
const serviceIconMap = createIconLoader<ServiceType>(serviceModules);

export function getServiceIcon(service: ServiceType): string | undefined {
  return serviceIconMap.get(service);
}

export function getAllServiceIcons(): ReadonlyMap<ServiceType, string> {
  return serviceIconMap;
}

export function hasServiceIcon(service: ServiceType): boolean {
  return serviceIconMap.has(service);
}
