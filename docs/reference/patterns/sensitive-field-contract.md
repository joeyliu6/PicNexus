# 敏感字段：密文常驻、明文按需

> 所有密码 / Token / Cookie / 密钥输入框统一遵守的契约。新增敏感字段时照抄这套，别自己发明。

## 规则一句话

**存起来之后，界面只显示「有没有」，不显示「是什么」。想看内容主动点眼睛，点开临时取明文、15 秒自动收回。**

用户看到的：

| 状态 | 输入框 | label 旁 | 眼睛按钮 |
|------|--------|---------|---------|
| 没存过 | 空，显示原始占位文案 | 无 | 禁用 |
| 存过了、没聚焦 | **12 个圆点**（多行 256 个，自然折行铺满） | 「✓ 已保存」芯片 | 可用 |
| 存过了、**聚焦** | **真值被取出来填进去**（仍遮蔽），可就地改 | 「✓ 已保存」芯片 | 可用 |
| 失焦、一个字符没动 | 退回圆点，**不写盘** | 「✓ 已保存」芯片 | 可用 |
| 失焦、改过了 | 退回圆点 | 「✓ **已更新**」约 2 秒 | 可用 |
| 点了眼睛 | 明文，**只读** | 芯片 | 可用（再点收回） |

**聚焦即取值**是这套设计的关键：输入框在你点进去的那一刻就变回一个普通密码框，
想改一个字符就改一个字符，不用整串重打。明文只在编辑期间存在，失焦即清。

## 为什么显示圆点

来源是 2026-08-14 WebDAV 验收时的用户反馈：「已保存的密码再打开是空的，体验和别处不一样」。
当时的决定是**把全项目统一到「密文常驻、明文按需」**，而不是让 WebDAV 退回旧行为。

> ⚠️ **这里曾经有过一次反复，记下来免得下一个人再绕一遍。**
>
> 第一版实现是「**空框** + 芯片」，理由写的是「输入框是空的这个视觉信号，分量远大于
> 框内一行灰字」。真机一用就发现不对：**空框传达的是「里面没东西」，不是「有东西但不给你看」**。
> 芯片在 label 旁边，视线不在那儿。
>
> 现在改成圆点。**不要再改回空框。**

圆点 + 芯片两个都要，分工不同：

- **圆点**说的是「里面有东西」——回答的是"我配过没有"
- **芯片**说的是「刚才那下存盘成功了」——绿色确认信号，出现在你失焦的那一刻。
  `a322dba` 修的正是"保存后密码被静默清空"，「存着呢」和「丢了」必须一眼可分。

「留空则不修改」不再常驻。它只在你**把光标放进去**、真的可能要改的那一刻才出现。

### 圆点必须是假的、固定个数的

迁移前那 8 处绑的是真值 + `type="password"`，浏览器原生遮蔽——**圆点个数就等于密码长度**，
等于把长度泄露在界面上。6 位密码和 64 位 token 在界面上必须长得一模一样。

`sensitive-field.spec.ts` 有一条反向判据钉着这点（短值和长值的圆点必须相等）。

> 曾经考虑过改成「多少位显示多少个圆点」，权衡后放弃，理由记在这儿免得再绕一遍：
> 除了长度泄露，**WebDAV 那 2 个密码只有密文、不解密拿不到明文长度**，规则一开始就得写"除了这两个"；
> 而且长度要从三个分组穿到组件里，哪个分组忘了接就静默退回固定值，界面上看不出来。

### 多行为什么不写死换行

多行用 256 个圆点、**不带换行**，交给浏览器自然折行。曾经拼的是「3 行 × 32 个」，
三行一样长，一看就是生成的。自然折行后宽度跟着框走、末行参差，观感自然得多。

placeholder 不是内容、不驱动滚动条，超出可视区的部分直接裁掉，不会冒出滚动条。

## 不变量：看一眼不等于改一次

父组件在 blur 时提交。「只是想确认一下」绝不能变成「重新加密写回」——
那正是 `a322dba` 那类事故的形状。

这条不变量由**两个机制**共同保证，删任何一个都会破：

### 1. 看（眼睛按钮）走只读展示态 —— 结构性保证

展示态是**独立的只读控件**，绑 `:modelValue` 而非 `v-model`，**且不挂 `@blur`**。
明文只进 DOM，不进数据流。单行走 `InputText`、多行走 `Textarea`，两条分支都是这个待遇。

> ⚠️ 任何「统一给所有分支加 blur 处理」的重构都会重新引入这个缺陷。

### 2. 改（聚焦取值）走原值比较 —— 比较式保证

为了能就地改一个字符，聚焦时明文**会**进入 `modelValue`。这时结构性保证不再适用，
改由 `useSensitiveDraft` 记下取出来时的原值，`commitDraft` 只在 `draft !== 原值` 时才写盘。

两条兜底同样不能删：

- **空草稿不提交**——取值失败（比如解密不出来）会留下空框，这条保证已存的值不会因此被清掉。
  **这才是真正会丢数据的那条路径。**
- 取值失败时不进入编辑态

> ⚠️ 这两条都有单测钉着，**并且做过变异测试**：注释掉原值比较，
> 「取出来一个字符没动就失焦」和「没改动不冒充已更新」两条会红。
>
> 写这类测试时注意别让它假通过——第一版就踩了：`hasStored` 硬编码成 `true` 但 `stored` 是空的，
> 于是 `reveal` 返回空串，`commitDraft` 走的是「空草稿」分支而不是比较分支，
> 把比较逻辑整个删掉测试都不会红。**测试里必须放一个真实的非空值。**

## 怎么接一个新字段

用 [`useSensitiveDraft`](../../../src/composables/settings/useSensitiveDraft.ts)，三个回调描述差异：

```ts
const secrets = useSensitiveDraft({
  hasStored: key => !!读取(key),   // 决定芯片和眼睛按钮
  reveal: key => 取明文(key),       // 聚焦取值和点眼睛都走它；明文字段直接返回，密文字段解密
  commit: (key, draft) => { 写入(key, draft); emit('save'); },  // 只在真的改过时被调用
});
```

`reveal` 现在有两个调用方——点眼睛（看）和聚焦（改）。**它必须是幂等的纯读取**，
不要在里面做任何写操作。

模板一行接完：

```vue
<label>
  API Token
  <span v-if="secrets.hasStored('smms.token')" class="saved-chip">
    <i class="pi pi-check" aria-hidden="true"></i>已保存
  </span>
</label>
<SensitiveField v-bind="secrets.bindingsFor('smms.token', '从 SM.MS 官网获取 API Token')" />
```

`.saved-chip` 在 [settings-shared.css](../../../src/styles/settings-shared.css)，各设置分组都已 import。
多行字段额外加 `multiline :rows="4"`。

几个已经踩过的坑，`useSensitiveDraft` 里已经处理，别再自己写一遍：

- **revealer 必须按 key 记忆化**。在模板里现建闭包会让 `revealStored` prop 每帧都"变化"。
- **提交失败不清草稿**。抹掉用户刚输入的内容是二次伤害。
- **揭示失败要继续抛**。`SensitiveField` 靠它决定「不进入展示态」，否则解不开会显示成空密码。

## 底下存的是明文还是密文？

**这条契约管的是界面，跟存储形态无关。** 两者都接同一套接口，只是 `reveal` / `commit` 不同。

| 字段 | 存储形态 | reveal |
|------|---------|--------|
| SM.MS / GitHub / Imgur token | 明文 | 直接读回 |
| 六个 Cookie | 明文 | 直接读回 |
| 内置 S3 / 自定义 S3 密钥 | 明文 | 直接读回 |
| WebDAV 图床密码 | `passwordEncrypted` 密文 | `secureStorage.decrypt` |
| WebDAV 备份密码 | `passwordEncrypted` 密文 | `WebDAVClient.decryptPassword` |

### 为什么明文那些没有顺带加密

整份 `.settings.dat` 已由 [EncryptedStore](../../../src/store/EncryptedStore.ts) 用
`secureStorage.encrypt` 做 AES-GCM 加密。字段级加密走的是**同一个单例、同一个 `this.key`**
（[crypto.ts](../../../src/security/crypto.ts) 的 `encrypt`）。

**能开外层的钥匙原样能开内层**——对「配置文件被拷走」这个威胁，字段级加密的增量收益是零，
不是小，是零。真正的明文风险在 `cli-config.json`（`save_cli_config` 直接 `fs::write`，无任何加密），
那条线记在 `docs/TODO.md`。

> ⚠️ 已有字段级密文的地方要注意：设置备份密码会换掉 `secureStorage` 的密钥，而
> `swapKeyAndReencrypt` 只重写外层信封、不会钻进 JSON 重新加密内层密文。
> 详见 TODO 的「设置备份密码会静默作废已保存的 WebDAV 密码」条目。
> **新增字段级密文之前先确认这条修没修。**

## 加了密文字段记得脱敏

[`validators.ts`](../../../src/config/validators.ts) 的诊断脱敏是按字段名逐个列的，不会自动覆盖。
新增 `*Encrypted` 字段要同步加一行 `sanitizeString`，否则密文原样进日志。

## 相关文件

| 文件 | 职责 |
|------|------|
| [SensitiveField.vue](../../../src/components/common/SensitiveField.vue) | 三态输入控件 + 15 秒定时收回 |
| [useSensitiveDraft.ts](../../../src/composables/settings/useSensitiveDraft.ts) | 草稿表 / 失焦提交 / 按需揭示 |
| [settings-shared.css](../../../src/styles/settings-shared.css) | `.saved-chip` 样式 |
| [webdavBackupSecrets.ts](../../../src/composables/settings/webdavBackupSecrets.ts) | 备份密码保存时加密 |
