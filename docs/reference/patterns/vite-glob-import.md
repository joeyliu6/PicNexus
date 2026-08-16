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
    └── icons.ts
```

### 实现代码

```typescript
// src/utils/icons.ts
/**
 * 使用 Vite 的 import.meta.glob 导入所有服务图标 SVG
 * eager: true 表示同步加载，query: '?raw' 获取原始字符串内容
 */
const serviceModules = import.meta.glob<string>(
  '../assets/icons/services/*.svg',
  { eager: true, query: '?raw', import: 'default' }
);

// 构建映射表：key = 文件名（不含扩展名）
const serviceIconMap = createIconLoader(serviceModules);

export function getServiceIcon(service: string): string | undefined {
  return serviceIconMap.get(service);
}
```

### 命中不到时的兜底

glob 的 key 就是文件名，所以**只有内置服务能命中**。多实例私有存储用的是 `custom_s3:<profileId>` / `webdav:<profileId>` 复合 ID，每个 profile 不可能各自带 logo，因此按类型退到 PrimeIcons 字体图标：

```typescript
export type ServiceLogoSource =
  | { kind: 'svg'; svg: string }
  | { kind: 'icon'; className: string };

export function resolveServiceLogo(serviceId: string): ServiceLogoSource {
  const svg = serviceIconMap.get(serviceId);
  if (svg) return { kind: 'svg', svg };
  if (isCustomS3Id(serviceId)) return { kind: 'icon', className: 'pi pi-database' };
  if (isWebDAVId(serviceId)) return { kind: 'icon', className: 'pi pi-server' };
  return { kind: 'icon', className: 'pi pi-cloud' };
}
```

日后若补了 `custom_s3.svg` / `webdav.svg`，SVG 分支会自动优先命中，消费方不用改。

### 使用方式

不要在页面里直接 `v-html="getServiceIcon(x)"` —— 查不到时会渲染成一个空占位方块。统一走共享组件 [src/components/common/ServiceLogo.vue](../../../src/components/common/ServiceLogo.vue)，尺寸与颜色交给父级 class（单根组件，class 会 fallthrough 到根元素）：

```vue
<template>
  <ServiceLogo :service-id="serviceId" class="badge-icon" />
</template>

<style scoped>
/* 字体图标靠 font-size 撑，SVG 靠 width/height，两者都写上才能对齐 */
.badge-icon { width: 14px; height: 14px; font-size: var(--text-xs); color: var(--text-muted); }
</style>
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

- [src/utils/icons.ts](../../../src/utils/icons.ts) - 实际实现
- [src/components/common/ServiceLogo.vue](../../../src/components/common/ServiceLogo.vue) - 统一渲染入口（含兜底）
- [src/assets/icons/services/](../../../src/assets/icons/services/) - SVG 图标目录
- [docs/design/tokens.md](../../design/tokens.md#service-name-truncation) - 图床名截断宽度约定
