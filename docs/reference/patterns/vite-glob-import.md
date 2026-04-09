# Vite 批量导入静态资源模式

## 适用场景

- 需要批量加载同类型静态资源（SVG 图标、JSON 配置等）
- 资源数量较多，手动逐个导入繁琐
- 需要根据名称动态获取资源内容

## 模式说明

使用 Vite 的 `import.meta.glob` API 批量导入文件，构建运行时映射表。

**核心优势**：
1. **自动发现** - 新增文件无需修改代码
2. **类型安全** - 可与 TypeScript 类型系统集成
3. **构建优化** - Vite 自动处理资源打包

## 代码示例

### 目录结构

```
src/
├── assets/
│   └── icons/
│       └── services/
│           ├── github.svg
│           ├── bilibili.svg
│           └── ...
└── utils/
    └── serviceIcons.ts
```

### 实现代码

```typescript
// src/utils/serviceIcons.ts
import type { ServiceType } from '../config/types';

/**
 * 使用 Vite 的 import.meta.glob 导入所有服务图标 SVG
 * eager: true 表示同步加载，query: '?raw' 获取原始字符串内容
 */
const iconModules = import.meta.glob<string>(
  '../assets/icons/services/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);

// 构建映射表
const serviceIconMap: Partial<Record<ServiceType, string>> = {};

for (const [path, content] of Object.entries(iconModules)) {
  // 从路径中提取文件名（不含扩展名）
  const match = path.match(/\/([^/]+)\.svg$/);
  if (match) {
    const name = match[1] as ServiceType;
    serviceIconMap[name] = content;
  }
}

// 导出查询函数
export function getServiceIcon(service: ServiceType): string | undefined {
  return serviceIconMap[service];
}

export function hasServiceIcon(service: ServiceType): boolean {
  return service in serviceIconMap;
}
```

### 使用方式

```vue
<template>
  <div class="icon" v-if="getServiceIcon(service)" v-html="getServiceIcon(service)"></div>
  <div class="icon fallback" v-else>{{ serviceName[0] }}</div>
</template>

<script setup lang="ts">
import { getServiceIcon } from '../utils/serviceIcons';
</script>
```

## 参数说明

| 参数 | 说明 |
|------|------|
| `eager: true` | 同步加载，构建时打包进 bundle |
| `eager: false` | 懒加载，返回 `() => Promise<Module>` |
| `query: '?raw'` | 获取文件原始内容（用于 SVG/文本） |
| `query: '?url'` | 获取资源 URL（用于图片） |
| `import: 'default'` | 直接获取默认导出值 |

## 注意事项

1. **路径必须是字面量** - glob 模式不能使用变量
2. **SVG 颜色控制** - 使用 `fill="currentColor"` 让 CSS 控制颜色
3. **XSS 风险** - `v-html` 仅适用于可信的静态资源，不要用于用户输入
4. **正则提取** - 路径分隔符在不同系统可能不同，使用 `/` 匹配

## 相关文件

- [src/utils/serviceIcons.ts](../../src/utils/serviceIcons.ts) - 实际实现
- [src/assets/icons/services/](../../src/assets/icons/services/) - SVG 图标目录
