# PicNexus 文案治理清单

> 运行 `node scripts/audit-copy.mjs > docs/audits/copy-inventory.md` 可重新生成完整审计表。本文保留治理字段模板，实际评审时按优先级补充 issue 与 proposedCopy。

## 当前基线

- 扫描范围：生产源码与入口 HTML，排除测试、快照、构建产物和注释。
- 首轮人工目标：先处理 P1/P2，也就是 Toast、Confirm、Dialog、主导航、设置导航、空状态和校验错误。
- 中心化入口：`src/constants/uiCopy.ts` 与 `src/constants/toastMessages.ts`。

## Inventory Template

| copyId | surface | module | file | currentCopy | issue | proposedCopy | priority | status |
|---|---|---|---|---|---|---|---|---|
| copy.upload.confirm.clearQueue | confirm | upload | `src/components/views/UploadView.vue` | 确定要清空上传队列吗？此操作不可撤销。 | 已集中到 `UI_COPY.confirm.upload.clearQueue` | 保持 | P1 | done |
| copy.dialog.urlDownload.title | dialog | upload | `src/components/dialogs/UrlDownloadDialog.vue` | 从 URL 下载图片 | 已集中到 `UI_COPY.dialogs.urlDownload` | 保持 | P2 | done |
| copy.dialog.backupPassword.validation | dialog | backup-sync | `src/components/dialogs/BackupPasswordDialog.vue` | 请输入密码 / 密码不正确 / 两次输入的密码不一致 | 已集中到 `UI_COPY.dialogs.backupPassword.error` | 保持 | P1 | done |
| copy.navigation.main | visible-ui | layout | `src/components/layout/Sidebar.vue` | 上传 / 浏览 / 维护 / 设置 | 已集中到 `UI_COPY.navigation.main` | 保持 | P2 | done |

## Review Fields

- `copyId`：稳定 ID，建议按 `copy.<module>.<surface>.<name>` 命名。
- `surface`：`visible-ui`、`toast`、`confirm`、`dialog`、`placeholder`、`tooltip`、`aria`、`error`、`logic`。
- `issue`：记录问题类型，例如「过长」「重复反馈」「技术化」「缺少下一步」「危险操作不明确」。
- `proposedCopy`：建议替换文案；若当前文案合适但已集中管理，可写「保持」。
- `priority`：`P1` 阻塞/危险/错误，`P2` 高频可见，`P3` 低频或内部状态。
- `status`：`todo`、`approved`、`done`、`deferred`。
