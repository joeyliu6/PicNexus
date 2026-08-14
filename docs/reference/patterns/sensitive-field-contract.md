# 敏感字段：密文常驻、明文按需

> 所有密码 / Token / Cookie / 密钥输入框统一遵守的契约。新增敏感字段时照抄这套，别自己发明。

## 规则一句话

**存起来之后，界面只显示「有没有」，不显示「是什么」。想看内容主动点眼睛，点开临时取明文、15 秒自动收回。**

用户看到的：

| 状态 | 输入框 | label 旁 | 眼睛按钮 |
|------|--------|---------|---------|
| 没存过 | 空，显示原始占位文案 | 无 | 禁用 |
| 存过了 | **空**，占位变「留空则不修改」 | 「✓ 已保存」芯片 | 可用 |
| 点了眼睛 | 明文，**只读** | 「✓ 已保存」芯片 | 可用（再点收回） |
| 正在输入 | 用户输入的内容（默认遮蔽） | 视原有值而定 | 可用 |

## 为什么输入框是空的

来源是 2026-08-14 WebDAV 验收时的用户反馈：「已保存的密码再打开是空的，体验和别处不一样」。
当时的决定是**把全项目统一到这个新行为**，而不是让 WebDAV 退回旧行为——同时补上眼睛按钮，
让「空」不至于变成「查不到」。

空输入框 + 芯片这个组合是刻意的：

- **不用灰 placeholder 传达「已保存」**：输入框是空的这个视觉信号，分量远大于框内一行灰字。
- **「存着呢」和「丢了」必须一眼可分**：`a322dba` 修的正是"保存后密码被静默清空"。
  这两种状态长得一模一样的话，用户没法判断自己是不是踩了坑。

## 不变量：揭示出的明文绝不能进 modelValue

这是整套设计里唯一一条不能破的。

父组件在 blur 时提交。明文一旦流进 `modelValue`，「看一眼密码」就变成「重新加密写回」——
用户只是想确认一下，结果触发了一次真实的写入。这正是 `a322dba` 那类事故的形状。

**靠结构挡住，不靠自觉**（[SensitiveField.vue](../../../src/components/common/SensitiveField.vue)）：

展示态是**独立的只读控件**，绑 `:modelValue` 而非 `v-model`，**且不挂 `@blur`**。
明文只进 DOM，不进数据流。单行走 `InputText`、多行走 `Textarea`，两条分支都是这个待遇。

> ⚠️ 任何「统一给所有分支加 blur 处理」的重构都会重新引入这个缺陷。
> `tests/unit/components/sensitiveField.spec.ts` 有对应用例钉着，做过变异测试确认能抓到回归。

## 怎么接一个新字段

用 [`useSensitiveDraft`](../../../src/composables/settings/useSensitiveDraft.ts)，三个回调描述差异：

```ts
const secrets = useSensitiveDraft({
  hasStored: key => !!读取(key),           // 决定芯片和眼睛按钮
  reveal: key => 取明文(key),               // 明文字段直接返回，密文字段在这里解密
  commit: (key, draft) => { 写入(key, draft); emit('save'); },  // 只在草稿非空时被调用
});
```

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
