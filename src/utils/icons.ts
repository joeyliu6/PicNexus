
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

