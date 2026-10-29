# 敏感字段：密文常驻、明文按需

> 凭证、密码在界面上怎么显示、怎么改、怎么存。界面有两处：图床页的凭证框（`src/views/hosts/HostSecretField.vue`，设计稿 P09 / P10），设置页的云同步密码（`src/views/settings/SyncTargetDialog.vue`）。

## 规则一句话

**存起来之后，界面只显示「有没有」，不显示「是什么」。想看内容主动点「查看」，临时取明文、到时自动收回。看一眼绝不等于改一次。**

## 图床页的凭证框（HostSecretField）

| 状态 | 框里显示 | 能做什么 |
|------|---------|---------|
| 没存过 | 占位文案 | 直接输入 |
| 存过了 | 固定个数的圆点（Cookie 前面露出第一项的名字，如「SUB=••••」，名字不是秘密） | 「查看」「修改…」 |
| 点了「查看」 | 明文，只读 | 30 秒后自动收回；查看失败通知「无法查看X / 请重新填写后再试」 |
| 点了「修改…」 | 清空，等待粘贴（旧值不回显） | 离开即保存，父组件保存后自动测试；「取消」恢复原值 |

**不变量**（改这个组件时别破）：

- **看一眼不等于改一次**：明文只在「查看」时临时取来显示，从不写进输入框的值；看完离开不触发保存。
- **圆点个数固定**：6 位密码和 64 位 token 在界面上一模一样，不泄露长度。别给圆点加 `letter-spacing`。
- **清空要确认**：进了编辑态、输入过又删空再离开 = 清空，先确认「清空 X？ / 清空后需重新填写，否则无法上传到这个图床。」（红色「清空」）；没输入就离开 = 取消，不动已存的值。ESC / 关掉确认框一律当不删——判断不出来时宁可留着一把用户想删的钥匙（很多服务商的 SecretKey 只在生成时显示一次）。
- **加密类字段清空时直接写空串**，不能 `encrypt('')`：那会存进一段非空密文，界面就成了「删了但还显示已保存」。

这几条由 `tests/unit/views/hosts/hostSecretField.spec.ts`（查看、圆点、清空确认、Esc）与 `useHosts.spec.ts`「清空 WebDAV 密码存成空串」钉着，每条都在改坏的组件上红过。

## 设置页的云同步密码

设置页只剩这一处秘密：「同步方式」对话框里的普通密码框（带「显示密码」眼睛，显示的是正在输入的内容）。已存过密码时框留空 = 不改，不提供「查看」。保存时 `WebDAVClient.encryptPassword` 加密成 `passwordEncrypted`，测试连接与同步时 `WebDAVClient.decryptPassword` 临时解开。

## 底下存的是明文还是密文？

**界面规则跟存储形态无关。**

| 字段 | 存储形态 | 取明文 |
|------|---------|--------|
| SM.MS / GitHub / Imgur token | 明文 | 直接读回 |
| 六个 Cookie | 明文 | 直接读回 |
| 内置 S3 / 自定义 S3 密钥 | 明文 | 直接读回 |
| WebDAV 图床密码 | `passwordEncrypted` 密文 | `secureStorage.decrypt` |
| 云同步（WebDAV 备份）密码 | `passwordEncrypted` 密文 | `WebDAVClient.decryptPassword` |

### 为什么明文那些没有顺带加密

整份 `.settings.dat` 已由 [EncryptedStore](../../../src/store/EncryptedStore.ts) 用 `secureStorage.encrypt` 做 AES-GCM 加密。字段级加密走的是**同一个单例、同一个 `this.key`**（[crypto.ts](../../../src/security/crypto.ts) 的 `encrypt`）。**能开外层的钥匙原样能开内层**——对「配置文件被拷走」这个威胁，字段级加密的增量收益是零。真正的明文风险在 `cli-config.json`，那条线记在 `docs/TODO.md`。

> 📌 **换钥匙时内层密文会自动搬运，新增字段级密文不需要登记。**
> 设置 / 修改 / 关闭备份密码会换掉 `secureStorage` 的密钥，[`rekeyFieldSecrets`](../../../src/security/fieldSecrets.ts) 在换之前按加密魔数前缀（`PNXENC:` / `PNXPWD:`）深度遍历配置、把内层密文一并搬到新钥匙上（入口 `changeBackupPassword`，`backupPassword.spec.ts` 钉着）。只要你的密文走 `secureStorage.encrypt` 生成，就自动被覆盖——**不建登记表正是因为登记表迟早会漏一个，而漏了是静默的**。
> 只重写外层信封、内层密文全变孤儿的缺陷，症状与修法见 [orphan-field-ciphertext.md](../troubleshooting/orphan-field-ciphertext.md)。

## 加了密文字段记得脱敏

[`validators.ts`](../../../src/config/validators.ts) 的诊断脱敏是按字段名逐个列的，不会自动覆盖。新增 `*Encrypted` 字段要同步加一行 `sanitizeString`，否则密文原样进日志。

## 相关文件

| 文件 | 职责 |
|------|------|
| [HostSecretField.vue](../../../src/views/hosts/HostSecretField.vue) | 图床凭证框：查看 30 秒、修改…、清空确认 |
| [SyncTargetDialog.vue](../../../src/views/settings/SyncTargetDialog.vue) | 云同步连接与密码 |
| [webdav.ts](../../../src/utils/webdav.ts) | `WebDAVClient.encryptPassword` / `decryptPassword` |
| [fieldSecrets.ts](../../../src/security/fieldSecrets.ts) | 换钥匙时搬运内层密文 |
