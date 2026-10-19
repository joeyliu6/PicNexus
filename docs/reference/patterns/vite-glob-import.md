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

### 命中不到时的兜底与使用方式

glob 的 key 就是文件名，所以**只有内置服务能命中**。多实例私有存储用的是 `custom_s3:<profileId>` / `webdav:<profileId>` 复合 ID，每个 profile 不可能各自带 logo，查不到时直接 `v-html` 会渲染成一个空占位方块。

所以页面里不直接用 `getServiceIcon`，一律用 [src/components/biz/HostIcon.vue](../../../src/components/biz/HostIcon.vue)：自定义 S3 画对象存储（桶）图标、WebDAV 画服务器图标（配置删掉后残留的复合 ID 也按前缀认类型），其余认不出的退回名字的前两个字。尺寸按设计档位传 `size`（16 / 20 / 24 / 32 / 44），颜色跟随文字颜色。

```vue
<HostIcon :host="serviceId" :size="16" :name="serviceName" />
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
- [src/components/biz/HostIcon.vue](../../../src/components/biz/HostIcon.vue) - 统一渲染入口（含兜底）
- [src/assets/icons/services/](../../../src/assets/icons/services/) - SVG 图标目录
