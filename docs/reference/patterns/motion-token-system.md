# 动效 Token 统一管理模式

## 适用场景

- 项目动效分散在各组件 scoped style 中，出现重复定义
- 硬编码的 transition 时长和缓动函数难以全局调整
- 新增组件时不知道该用什么时长/缓动

## 模式说明

将所有动效参数集中到一个 CSS 变量文件（`motion.css`）中管理，包括：

1. **Duration Token** — 标准化时长档位（micro/fast/normal/medium/slow/slower + 循环动画周期）
2. **Easing Token** — 标准化缓动函数（standard/decelerate/accelerate/overshoot/spring）
3. **共享 @keyframes** — 高频动画提取为全局 keyframes，`k-` 前缀命名
4. **Vue Transition class** — 可复用的 `<Transition>` class，`t-` 前缀命名

### 核心原则

- **单文件管理**：250 行以内用分节注释，不拆目录（KISS）
- **命名约定**：`k-` = keyframes，`t-` = transition class，`--duration-*` / `--ease-*` = token
- **参数化**：不同组件需要微调时，直接引用 keyframes + 不同的 duration token，不搞 CSS 私有变量参数化
- **无障碍内置**：`prefers-reduced-motion` 自动归零所有 duration，组件层无需额外处理
- **只提取高频**：只有被 2+ 处复用的 keyframes 才提取到全局；高度定制的保留组件内

### 什么不做

- 不引入第三方动效库（项目动效全是基础 transform/opacity，不需要）
- 不搞 Tailwind 式全量 utility class（只有 5 个高频模式，不值得）
- 不搞 CSS 私有变量参数化（认知负担重，直接多定义几个具体 keyframes 更直白）

## 代码示例

```css
/* motion.css Token 定义 */
:root {
  --duration-micro: 100ms;
  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --duration-medium: 300ms;
  --duration-slow: 350ms;
  --duration-slower: 500ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}

/* 共享 keyframes */
@keyframes k-fade-slide-up {
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 组件中使用 */
.settings-section {
  animation: k-fade-slide-up var(--duration-medium) var(--ease-decelerate) both;
}

.button {
  transition: all var(--duration-fast) ease;
}
```

## 注意事项

- 新增 @keyframes 前先检查 motion.css 是否已有可复用的
- 0.1s 用 `--duration-micro`，0.15s 用 `--duration-fast`，0.2s 用 `--duration-normal`，0.3s 用 `--duration-medium`
- `ease`/`ease-out`/`ease-in-out` 保持原样（CSS 原生关键字，不需要变量化）
- 只替换 `cubic-bezier(...)` 为 `var(--ease-*)`
- TransitionGroup 的精调动画（如 FavoritesView 的 0.45s/0.55s/0.33s）允许保留非标准值

## 相关文件

- `src/styles/motion.css` — Token + Keyframes + Transition class 定义
- `docs/style-design.md` — 完整的动效变量速查表
