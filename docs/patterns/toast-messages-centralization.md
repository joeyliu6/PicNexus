# Toast 消息集中化管理

## 适用场景

当项目中有大量 Toast 通知散落在各个组件和 Composable 中时，使用此模式：

- Toast 消息内容分散在各处，难以维护和修改
- 需要支持国际化（i18n）
- 需要统一消息风格和措辞
- 需要复用相同类型的消息（如"保存成功"、"删除失败"）

## 模式说明

**核心思想**：将所有 Toast 消息配置集中到一个常量文件中，通过类型安全的 API 调用。

**结构**：
```
src/constants/
├── index.ts           # 统一导出
└── toastMessages.ts   # Toast 消息配置
```

**消息类型**：
1. **静态消息** - 固定内容，直接作为对象
2. **动态消息** - 需要参数，定义为函数

## 代码示例

### 1. 消息配置文件

```typescript
// src/constants/toastMessages.ts

export interface ToastMessageConfig {
  summary: string;
  detail?: string;
  life?: number;
}

type StaticMessage = ToastMessageConfig;

export const TOAST_MESSAGES = {
  // 通用操作
  common: {
    // 静态消息 - 固定内容
    noSelection: {
      summary: '未选择',
      detail: '请先选择要操作的项目'
    } as StaticMessage,

    // 动态消息 - 需要参数
    copySuccess: (count?: number): ToastMessageConfig => ({
      summary: '已复制',
      detail: count ? `${count} 个链接` : '链接已复制到剪贴板',
      life: 1500
    }),

    deleteSuccess: (count: number): ToastMessageConfig => ({
      summary: '已删除',
      detail: `${count} 条记录`
    }),

    deleteFailed: (error: string): ToastMessageConfig => ({
      summary: '删除失败',
      detail: error
    })
  },

  // 按模块分组
  upload: {
    success: (count: number): ToastMessageConfig => ({
      summary: '上传完成',
      detail: `成功上传 ${count} 个文件`
    }),
    noService: {
      summary: '未选择图床',
      detail: '请选择至少一个图床服务'
    } as StaticMessage
  },

  config: {
    saveSuccess: {
      summary: '已保存'
    } as StaticMessage,
    saveFailed: (error: string): ToastMessageConfig => ({
      summary: '保存失败',
      detail: error
    })
  }
} as const;
```

### 2. useToast 增强

```typescript
// src/composables/useToast.ts

import type { ToastMessageConfig } from '../constants/toastMessages';

const DEFAULT_LIFE: Record<string, number> = {
  error: 5000,
  warn: 4000
};

export function useToast() {
  const toast = usePrimeToast();

  // 新增：使用预定义配置显示通知
  const showConfig = (
    severity: 'success' | 'info' | 'warn' | 'error',
    config: ToastMessageConfig
  ) => {
    const { summary, detail, life } = config;
    const defaultLife = DEFAULT_LIFE[severity] ?? 3000;

    toast.add({
      severity,
      summary,
      detail,
      life: life || defaultLife
    });
  };

  return {
    success,
    error,
    warn,
    info,
    showConfig  // 新增方法
  };
}
```

### 3. 使用方式

```typescript
// 之前：硬编码消息
toast.success('已删除', `${count} 条记录`);
toast.error('删除失败', errorMsg);

// 之后：使用集中配置
import { TOAST_MESSAGES } from '../constants';

toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(count));
toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(errorMsg));
```

## 注意事项

1. **类型标注**：静态消息需要 `as StaticMessage` 类型断言，否则 TypeScript 会推断为字面量类型

2. **分组原则**：按业务模块分组（common、upload、config、auth 等），而非按 severity

3. **life 设置**：
   - 错误消息默认 5000ms
   - 警告消息默认 4000ms
   - 成功/信息消息默认 3000ms
   - 特殊情况可在配置中覆盖

4. **国际化预留**：此结构便于后续接入 i18n，只需修改 toastMessages.ts

5. **渐进式迁移**：可逐步迁移，新代码使用 `showConfig()`，旧代码保持 `success()`/`error()` 兼容

## 相关文件

- `src/constants/toastMessages.ts` - 消息配置
- `src/constants/index.ts` - 统一导出
- `src/composables/useToast.ts` - Toast Composable
- `src/composables/useHistory.ts` - 使用示例
- `src/composables/useUpload.ts` - 使用示例
- `src/composables/useConfig.ts` - 使用示例
