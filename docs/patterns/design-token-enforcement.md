# Design Token 变量化强制执行模式

> 日期：2026-04-07
> 问题：AI 缺乏全局记忆，导致样式不一致、魔法数字泛滥
> 解法：定义变量 → 写进 CLAUDE.md 禁令 → 清理存量 → 自动化拦截

## 背景

项目在 `style.css` 中定义了完整的 Design Token 变量体系（间距、圆角、字号、颜色、动效、z-index），但实际引用率很低——239 处硬编码 px 值散落在 CSS 文件中。

根因是 **CLAUDE.md 只禁止了颜色和动效硬编码**，没有覆盖间距/圆角/字号。AI 每次对话只看到当前规则，所以颜色引用率 95%，间距引用率却只有 40%。

## 核心原则

**规则写到哪里，AI 就遵守到哪里。没写的 = 不存在。**

## 执行步骤

### 1. 补齐变量档位（填补间隔）

原来的间距只有 6 档（4/8/12/16/24/32），实际代码中大量使用 6px/10px/20px 等中间值。必须先补齐变量，让每个常用值都有对应的 token：

```css
/* 扩展前：6 档 */
--space-xs: 4px; --space-sm: 8px; --space-md: 12px;
--space-lg: 16px; --space-xl: 24px; --space-2xl: 32px;

/* 扩展后：14 档，覆盖所有常用值 */
--space-2xs: 2px; --space-xs: 4px; --space-xs-sm: 6px;
--space-sm: 8px; --space-sm-md: 10px; --space-md: 12px;
--space-md-lg: 14px; --space-lg: 16px; --space-lg-xl: 20px;
--space-xl: 24px; --space-2xl: 32px; --space-3xl: 40px;
--space-4xl: 48px; --space-5xl: 60px;
```

### 2. 写进 CLAUDE.md 永久规范表

在永久规范表中，每个维度都要有明确的禁令 + 可用变量清单：

```markdown
| CSS 间距变量 | ❌ 禁止硬编码间距，使用 `var(--space-*)` | `src/style.css` |
| CSS 圆角变量 | ❌ 禁止硬编码圆角，使用 `var(--radius-*)` | `src/style.css` |
| CSS 字号变量 | ❌ 禁止硬编码字号，使用 `var(--text-*)` | `src/style.css` |
```

### 3. 批量清理存量硬编码

按文件优先级清理：
1. `style.css` — 全局影响最大
2. `settings-shared.css` — 设置页面公共样式
3. Vue 组件 scoped style — 逐个替换

替换时的注意事项：
- 短手属性逐个值替换：`padding: 8px 12px` → `padding: var(--space-sm) var(--space-md)`
- `width/height/min-height` 等尺寸属性不替换
- `box-shadow/transform` 中的 px 值不替换
- `border: 1px` 保留
- `clamp()` 内的值保留

### 4.（可选）自动化拦截

配置 Stylelint 规则自动检测硬编码值，在 pre-commit hook 中拦截。

## 效果数据

| 指标 | 改善前 | 改善后 |
|------|--------|--------|
| 硬编码总数 | 239 处 | 6 处（减少 97%） |
| 间距变量引用率 | ~40% | ~98% |
| 圆角变量引用率 | ~15% | ~97% |
| 字号变量引用率 | ~30% | ~95% |

## 经验教训

1. **变量定义完整 ≠ 变量被使用**。如果 CLAUDE.md 不写禁令，AI 不会主动用变量
2. **中间档位必须存在**。如果只有 8px 和 12px，AI 遇到 10px 只能硬编码
3. **命名用 t-shirt 扩展**：`xs-sm`、`sm-md`、`lg-xl` 清晰表达"两档之间"的位置
4. **公共 UI 模式要提取组件**。empty state 重复 7 次，提取为 `EmptyState.vue` 后只需 1 处维护
