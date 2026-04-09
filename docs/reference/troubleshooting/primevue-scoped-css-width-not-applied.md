# PrimeVue 组件上的 scoped CSS 宽度/样式不生效

## 现象

给 PrimeVue 组件（如 `InputNumber`、`Select`）通过 `class` 设置宽度，样式不生效，元素按内容撑开，导致溢出父容器。

```vue
<!-- 期望 100px 宽，实际 214px -->
<InputNumber class="narrow-input" ... />
```

```css
/* scoped */
.narrow-input {
  width: 100px;
  flex-shrink: 0;
}
```

## 陷阱原因

Vue scoped CSS 的工作原理是给选择器加 `data-v-xxx` 属性：

```css
/* 编译后 */
.narrow-input[data-v-abc123] {
  width: 100px;
}
```

PrimeVue 组件可能使用了 `inheritAttrs: false`，导致父组件的 `data-v-xxx` 属性**不会自动传递**到组件根元素。选择器无法匹配，样式静默失效。

另一个相关问题：在 scoped CSS 中写 `.narrow-input :deep(.p-inputnumber)` 时，如果 `.narrow-input` 就是 `.p-inputnumber` 本身（同一元素），`:deep()` 找的是**子元素**中的 `.p-inputnumber`，永远匹配不到自身——这也是死代码。

## 正确做法

用原生 HTML 元素（`<div>`）包裹 PrimeVue 组件，在包裹层设置尺寸约束，再用 `:deep()` 穿透到内部元素：

## 错误示例

```vue
<template>
  <!-- class 直接放在 PrimeVue 组件上 -->
  <InputNumber class="narrow-input" :modelValue="value" />
</template>

<style scoped>
.narrow-input {
  width: 100px; /* 不生效！ */
}

/* 死代码：.narrow-input 就是 .p-inputnumber，不存在子级 .p-inputnumber */
.narrow-input :deep(.p-inputnumber) {
  width: 100%;
}
</style>
```

## 正确示例

```vue
<template>
  <!-- 原生 div 包裹，scoped 属性一定会正确应用 -->
  <div class="narrow-input">
    <InputNumber :modelValue="value" />
  </div>
</template>

<style scoped>
.narrow-input {
  width: 100px;
  flex-shrink: 0;
}

/* :deep() 正确穿透到 PrimeVue 内部 */
.narrow-input :deep(.p-inputnumber) {
  width: 100%;
  display: flex;
}

.narrow-input :deep(.p-inputnumber-input) {
  width: 100%;
  min-width: 0;
}
</style>
```

## 适用范围

所有需要在 scoped CSS 中控制 PrimeVue 组件尺寸/布局的场景，包括但不限于：
- `InputNumber`、`InputText`、`Select`、`Dropdown`
- 任何使用 `inheritAttrs: false` 的第三方组件
