# 弹窗与通知规范

> 全项目通知通道、文案、决策树的统一规范。任何新增/修改"弹一下提醒"的代码前，都先读这份文档对一下号。

---

## 1. 通道与语义

| 通道 | API | 语义 | 是否打断 | 典型场景 |
|------|-----|------|---------|----------|
| `toast.success` | `useToast().success(summary, detail?)` | 操作成功的回执 | 否 / 自动消失 | 上传完成、批量复制完成、同步成功 |
| `toast.error` | `useToast().error(summary, detail?)` | 操作失败需用户感知 | 否 / 自动消失（5s） | 网络失败、上传失败、解码失败 |
| `toast.warn` | `useToast().warn(summary, detail?)` | 半阻塞警示：操作受限或前置条件未满足 | 否 / 自动消失（4s） | 「检测进行中」「扫描进行中」「同步任务进行中」 |
| `toast.info` | `useToast().info(summary, detail?)` | 中性信息（**慎用**） | 否 / 自动消失（3s） | 仅当结果客观无好坏时用，如「无可检测的链接」 |
| `confirm` (`useConfirm`) | `confirm(message, options)` Promise | 必须用户决策才能继续 | 是 / 阻塞 | 删除/覆盖/清空等不可逆操作 |
| `Dialog` | `<Dialog v-model:visible>` | 信息密度高、需多步交互 | 是 / 阻塞 | 设置面板二级配置、密码恢复、URL 下载 |
| `silent` | `useToast().silent('log'\|'error', summary, detail?)` | 仅写控制台日志，不弹通知 | 否 / 不可见 | 单条复制反馈、内部状态记录 |
| `inline banner` | 组件级 `<ReloadBanner>` 等 | 常驻于页面顶部，用户主动消费 | 否 / 不会自动消失 | 「请刷新页面」「需重启」「试用版即将到期」 |

**核心区别**：
- **toast**：飘起来 → 看到 → 消失。适合「我做完了」的回执，不能承载用户必须执行的下一步。
- **inline banner**：钉在 UI 上 → 用户主动消化（点 Reload 或关闭）。适合「需要你做点什么才能继续」。
- **confirm/Dialog**：**阻塞流程**。其他都不阻塞。

---

## 2. 决策树

```
要不要弹？
│
├─ 用户主动触发的 + 结果有歧义？
│  ├─ 是 → 用 toast.success/error/warn 给回执
│  └─ 否（结果显而易见，如复制单条到剪贴板）→ silent
│
├─ 用户必须先决策才能继续？
│  ├─ 是（删除/覆盖/清空）→ confirm
│  └─ 否 → 不要 confirm
│
├─ 失败信息需要用户「下一步该做什么」？
│  ├─ 是 → toast.error，detail 末尾加指引
│  └─ 否 → toast.error，只放 errorCode
│
├─ 信息需要用户主动消费、不能被自动消失盖掉？
│  ├─ 是（请刷新页面、需重启）→ inline banner，常驻
│  └─ 否 → toast
│
└─ 防御性兜底（按钮已经 disabled / v-if 但还想多保险）？
   └─ ❌ 不弹，直接 return。代码层防御别落到用户眼前。
```

---

## 3. 文案模板

### 3.1 删除/清空确认（confirm）

```ts
showConfirm({
  header: '确认清空',
  message: '确定要清空上传队列吗？此操作不可撤销。',
  icon: 'pi pi-exclamation-triangle',
  acceptLabel: '清空',
  rejectLabel: '取消',
  acceptClass: 'p-button-danger',
  accept: () => { /* ... */ }
});
```

模板要点：
- header 短动词 + 名词（"确认清空"、"覆盖本地配置"）
- message 包含「会发生什么 + 是否可逆」
- 不可逆操作的 acceptClass 一定带 `p-button-danger`

### 3.2 失败提示（toast.error）

```ts
toast.error('上传失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
toast.error('网络请求失败', `${count} 个文件请求超时或中断\n建议：检查图床配置 / 切换图床`);
```

模板要点：
- summary 短句、说清「什么动作」失败
- detail = 错误原因 + `\n` + 该怎么办
- 不要只丢一串 errorCode 给用户

### 3.3 复制反馈

| 场景 | 应该用 |
|------|--------|
| 单条链接复制（用户点了一下就懂） | `toast.silent('log', '已复制', detail)` |
| 批量复制（用户需要数量回执） | `toast.success('已复制 N 张', detail)` |
| 部分跳过 | `toast.warn('已复制 X 张（跳过 Y 张）', detail)` |
| 复制失败 | `toast.error('复制失败', errorMsg)` |

### 3.4 同步/下载完成（动词态统一为「已 + 动词」）

```ts
// ✅ 推荐
toast.success('已下载', `共 ${n} 条记录（覆盖本地）`);
toast.success('已同步', `共 ${n} 条记录`);
toast.success('已检测', `共 ${total} 条：有效 ${valid} / 失效 ${invalid}`);
toast.success('已合并上传', `共 ${n} 条记录，新增 ${k} 条到云端`);

// ❌ 别再写
toast.success(`下载完成：共 ${n} 条记录`);
toast.success('检测完成', '...');
```

**原因**：「XX 完成」与「已 XX」在产品里并存会让用户读半秒才识别状态。统一动词态降噪。

### 3.5 拦截警示（toast.warn）

```ts
toast.warn('检测进行中', '请等待当前检测完成');
toast.warn('扫描进行中', '请等待当前扫描完成或取消后再开始新的扫描');
```

模板要点：
- summary 描述「当前正在做的事」
- detail 告诉用户「等什么」或「替代方案」
- ❌ 不要用 toast.info（视觉权重不足，用户会忽略）

---

## 4. 反模式清单（**这些情况绝对不要写新 toast**）

下面 9 处是 v1 清理掉的反例，警示后人。

| 反模式 | 为什么是错的 |
|--------|--------------|
| `toast.info('无需重试', '没有失败的上传项')` | 按钮已经 v-if 隐藏了，永远不会触达；删除按钮才是正解 |
| `toast.success('已清空', '上传队列已清空')` | 列表本身就空了，再弹一句是噪音 |
| `toast.success('已清空', '已完成的上传项已清理')` | 同上，UI 状态本身就是反馈 |
| `toast.info('开始检测')` | 进度条已经在动，没有信息量 |
| `toast.info('迁移数据已自动释放', '面板闲置 3 分钟后已清空…')` | 用户没主动操作，弹窗反而像 bug |
| `toast.warn('未选择项目', '请先选择要复制的项目')` | FAB 按钮 visible 已经 gate 了 hasSelection；防御性 toast 永远触达不到 |
| `toast.warn('未选择项目', '请先选择要删除的项目')` | 同上 |
| `setTimeout(() => toast.info('请刷新页面以使配置生效'), 1000)` | 一闪而过的提示用户必然错过；要刷新就用 inline banner |
| `toast.success('已复制', '某某链接已复制到剪贴板')` | 单条复制是高频低风险动作，silent 即可 |

**通用原则**：
1. **UI 状态本身能传达的，不要再弹 toast**（清空后列表就空了）
2. **按钮已经 v-if/disabled gate 的，不要再写防御性 toast**（永远走不到）
3. **用户必须执行的下一步，不要用 toast**（用 banner / confirm）
4. **成功后立刻看得见结果的高频动作，silent 不弹**（单条复制）

---

## 5. 命名约定速查

| 类别 | 用词 | 例子 |
|------|------|------|
| 完成态 summary | 「已 + 动词」 | 已下载 / 已同步 / 已检测 / 已撤销 |
| 资源缺失 summary | 「无 + 名词」 | 无可用链接 / 无可检测的链接 |
| 操作受限 summary | 「XX 进行中」 | 检测进行中 / 扫描进行中 / 同步任务进行中 |
| 失败 summary | 「XX 失败」 | 上传失败 / 下载失败 / 复制失败 |
| 失败 detail | `${errorCode}\n请...` | `${err}\n请检查网络或 WebDAV 配置后重试` |

---

## 6. 实现位置参考

- `useToast()`：[src/composables/useToast.ts](../../src/composables/useToast.ts)（含 `silent`、`addRaw`、`removeGroup`）
- `ReloadBanner`：[src/components/common/ReloadBanner.vue](../../src/components/common/ReloadBanner.vue)
- `useConfirm`：[src/composables/useConfirm.ts](../../src/composables/useConfirm.ts)
- 全局静默开关：`suppressToasts(true)` 用于批量操作期间临时屏蔽所有 toast，调用方负责复位
