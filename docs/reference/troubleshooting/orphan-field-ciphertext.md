# 孤儿密文：设备份密码让已保存的 WebDAV 密码静默作废

> 2026-08-15 真机复现、同日修复。修法与回归判据都在下面，**改动密钥切换链路前先读这篇**。

## 症状

设置 / 修改 / 停用备份密码之后，之前存好的 WebDAV 密码打不开了。日志里三行正好是一条完整因果链：

```
[SecureStorage] 解密失败:
[WebDAV] 密码解密失败 {"message":"数据损坏或密钥不匹配"}
[WebDAVBackupConfig] WebDAV 备份密码解密失败，无法查看
```

真机日志里 `07:23:21 [useConfig] WebDAV ✓ 测试成功` → `07:24:07 ✓ 备份密码已设置`
→ `07:24:22 解密失败`，**61 秒内密码没被碰过**。因果是对照出来的，不是推的。

三个让它更难被发现的特征：

- **界面在撒谎**。密码框照样显示圆点 + 绿色「✓ 已保存」，服务选择器照常把它列成可用——
  这两处判定都只看 `passwordEncrypted` 非空，不看解不解得开。用户直到上传失败才知道
- **不用重启就复现**。`applyKey` 当场换掉内存里的钥匙，下一次点眼睛就解不开了
- **爆炸半径是所有字段级密文**，不止备份密码。`config.webdav_profiles` 里每个图床
  profile 的密码一起变孤儿

`2547d3b` 补显式报错之前，`decryptPassword` 吞掉错误返回空串，
「解不开」和「存的就是空密码」在界面上完全一样，**连日志都不会响**。

## 根因

`secureStorage` 是单例、**只有一把钥匙**。整份 `.settings.dat` 的外层加密，
和 config 里 `passwordEncrypted` 这类内层字段密文，用的是同一个 `this.key`
（见 [sensitive-field-contract.md](../patterns/sensitive-field-contract.md#底下存的是明文还是密文)）。

而设置备份密码会换掉这把钥匙：

1. [`setBackupPassword`](../../../src/security/crypto.ts) 用 `invoke('set_secure_key')`
   覆盖钥匙串里的旧钥匙，**无备份**
2. `swapKeyAndReencrypt` 换完只用新钥匙重写**外层信封**
   （`readRawAll` → 换钥匙 → `setDirect`），不会钻进 JSON 重新加密内层密文
3. → 内层密文成了孤儿：能解开它的钥匙已经不存在了

真机日志佐证：换钥匙全程**只有两次写盘**（`.settings.dat` 和 `.sync-status.dat` 各一次），
没有任何字段级重新加密。

## 修法

[`src/security/fieldSecrets.ts`](../../../src/security/fieldSecrets.ts) 把顺序收进一个函数：

```ts
await rekeyFieldSecrets(snapshots, swapFn);   // 解开 → 换钥匙 → 用新钥匙锁上
```

三条设计要点，改这个模块前先看懂：

- **`swap` 由 `rekeyFieldSecrets` 内部调用**，不在外面先换好再进来。
  内层密文只能用旧钥匙解开，把换钥匙这一步收进来，顺序就从结构上不可能写反
- **不建"需要搬运的字段"登记表**，改成按加密魔数前缀（`PNXENC:` / `PNXPWD:`）深度遍历。
  登记表迟早会漏登记一个新字段，而漏了是静默的。因此**新增字段级密文不需要来这里登记**
- **旧钥匙也解不开的原样保留**，只记进 `report.orphans`。清掉只会让用户连
  "这里配过东西"都看不出来

存量孤儿（代码修好之前就已经产生的）由
[`purgeOrphanFieldSecrets`](../../../src/security/fieldSecrets.ts) 在启动时清空，
名字经 `startupFlags.orphanSecretLabels` 传给 App.vue 弹一条不自动消失的提示。

### 半个修复不够：内存里那份密文也要换

搬运只更新了**磁盘和 store 缓存**。设置页的 `formData` 里还有一份 `loadSettings`
时拷贝的**旧密文**（[useSettingsForm.ts](../../../src/composables/settings/useSettingsForm.ts)
读配置那两段），不同步的话有两处后果，第二处更严重：

1. 点眼睛拿 formData 里的旧密文去解，用新钥匙解不开 →「解密失败」
2. **下一次保存把 formData 原样写回磁盘，刚搬好的新密文被旧的覆盖** → 前功尽弃

所以 `BackupPasswordSection` 换完钥匙要 `emit('secrets-rekeyed')`，经 `BackupSyncPanel`
转到 `SettingsView` 调 `reloadFieldSecrets()`——只补密文那两个字段，
不走整份 `loadSettings()`（那会把用户没保存的编辑一起冲掉）。

> 📌 **这一步是 2026-08-15 第一次真机验收挂掉的地方。** 日志显示
> `[FieldSecrets] ✓ 字段级密文搬运完成` 之后 7 秒，点眼睛仍然
> `[WebDAVBackupConfig] WebDAV 备份密码解密失败`——搬运本身是对的，
> 错在只搬了磁盘、没搬内存。任何持有密文副本的地方都要一起想到。

### 探测存量的前提

> ⚠️ 探测**必须跑在配置读取成功之后**（`main.ts` 里 `ensureConfigSync()` 之后）。
> 外层信封开得了才说明钥匙是对的，此时内层还解不开才能判定为孤儿。
> 顺序反了会把整份配置的密文误判成孤儿全部清空。

**为什么清空而不是打标记**：清空之后 `passwordEncrypted` 变空串，密码框的「已保存」芯片、
设置页可用判定、服务选择器可用判定全都自动回到「未配置」，一处判定逻辑都不用改。
孤儿密文本身已经是块砖头（那把随机钥匙被覆盖且无备份），留着也开不了。

## 回归护栏

| 测试 | 钉住什么 |
|------|---------|
| `fieldSecrets.spec.ts` 的「decrypts every inner ciphertext before the key swap」 | 顺序。把 `await swap()` 挪到解密循环之前，这条立刻红 |
| `fieldSecrets.spec.ts` 的「keeps ciphertext that the old key cannot open」 | 不制造二次伤害 |
| `fieldSecrets.spec.ts` 的「leaves no half-rekeyed snapshot」 | 加密失败时快照不留半新半旧 |
| `backupPasswordSection.spec.ts` 的「内层密文搬运」四条 | set / disable 两种模式都搬运；解不开的保留；失败回滚不写盘 |
| `backupPasswordSection.spec.ts` 的「tells the parent to refresh」 | 换完钥匙必须通知父级重读；验证失败 / 回滚时不通知 |
| `useSettingsForm.spec.ts` 的「refreshes the ciphertext copies」 | `reloadFieldSecrets` 真的把 formData 里的旧密文换掉了 |

**做过变异测试**：把 `await swap()` 挪到解密循环之前，两个文件合计 9 条变红；
删掉 `emit('secrets-rekeyed')`，通知那条变红。

## 真机验收（2026-08-15）

| 判据 | 结果 |
|------|------|
| 启动清空存量孤儿并点名要重填哪几个 | ✅ 三个图床 profile 全部点名 |
| 换密码后**不重启**点眼睛看到明文 | ✅ |
| 换密码后**不重启**触发一次保存，再点眼睛仍是明文 | ✅ 旧密文没被写回 |
| 「关闭加密」分支同样搬运成功 | ✅ `已切回随机密钥模式` + `共发现 2 处，2 条已换新钥匙` |
| 重启后配置正常、不再弹失效提示 | ✅ |
| 上传链路解得开搬运后的密文 | ✅ 报的是「无法连接」而非「密码解密失败」——解密先于连接 |
| 真实上传到可达的 WebDAV 服务器 | ⬜ 本地 OpenList 没起，见 TODO 待验收 |

> 📌 「不重启触发保存」那条是**唯一**能验证事件从 `BackupPasswordSection` 经
> `BackupSyncPanel` 传到 `SettingsView` 的手段——两头都有单测，中间那段传递没有。
> 重启之后再测等于白测：`loadSettings` 已经把旧密文副本换掉了。

## 这条修不掉的两件事

1. **已经死掉的密码救不回来**，只能重填。旧钥匙是随机生成、存在钥匙串里、被覆盖且无备份
2. **还原老的 `.settings.dat` 备份文件仍然打不开**。同样是"钥匙串旧密钥被覆盖"导致的，
   见 [backup-password-regression.md](../guides/backup-password-regression.md) 收尾那条警告
