# Obsidian 插件发布指南

> 用于维护 `plugins/picnexus/`、桌面端随附 ZIP、独立插件仓库、BRAT 测试和 Obsidian 官方目录。

## 仓库职责

- PicNexus 主仓库是插件源码的唯一来源。
- `plugins/picnexus/` 通过 `git subtree split` 同步到独立公开仓库根目录。
- 独立仓库只服务 GitHub Release、BRAT 和 Obsidian 官方目录，不直接编辑。
- 插件版本由 `plugins/picnexus/manifest.json` 决定，不强制等于桌面端版本。

## 首次配置

1. 创建空的公开仓库 `joeyliu6/picnexus-obsidian`，不要初始化 README、LICENSE 或 `.gitignore`。
2. 在 GitHub 创建 fine-grained personal access token，只授权该仓库的 `Contents: Read and write`。
3. 在 PicNexus 仓库的 Actions secret 中添加 `OBSIDIAN_PLUGIN_RELEASE_TOKEN`。
4. 如使用其他目标仓库，在 Repository variable 中设置 `OBSIDIAN_PLUGIN_REPOSITORY=owner/repo`；未设置时默认使用 `joeyliu6/picnexus-obsidian`。
5. 目标仓库默认分支使用 `main`，不要直接提交修改。

## 本地验证

```bash
npm --prefix plugins/picnexus ci
npm run ci:obsidian
```

`ci:obsidian` 会执行插件类型检查、构建、发布结构校验和发布脚本测试。构建后必须确认 `plugins/picnexus/main.js` 已提交。

每次修改插件运行代码时同步更新：

- `manifest.json.version`
- `package.json.version`
- `package-lock.json` 顶层及根包版本
- `versions.json` 中版本到 `minAppVersion` 的映射

CI 会拒绝同一版本下发生变化的 `main.js`、`manifest.json` 或 `styles.css`。

## 自动发布

推送桌面端 `vX.Y.Z` 标签后：

1. 桌面端 matrix 构建完成并生成 Draft Release。
2. `release-obsidian-plugin.yml` 检查目标仓库和 Token 权限。
3. 插件完成 typecheck、build 和清单校验。
4. 工作流比较独立仓库中同版本资产：一致则复用，缺失则补传，不同则要求提升版本。
5. 插件 subtree 快进同步到独立仓库；目标已包含更新版本时不回退，真正分叉时停止。
6. 新版本使用不带 `v` 的标签，并直接上传 `main.js`、`manifest.json`、`styles.css`。
7. 同一批运行文件打包为 `picnexus-obsidian-<version>.zip`，上传到桌面端 Draft Release。
8. 最终任务生成包含插件 ZIP 的 `SHA256SUMS.txt` 并附加手动回归清单。

插件任务失败时桌面端 Release 保持 Draft。修复原因后重新运行失败任务即可，工作流按远端实际状态恢复。

## 测试安装

BRAT：安装 BRAT 后添加 `https://github.com/joeyliu6/picnexus-obsidian`，再启用 PicNexus。

手动安装：将桌面端 Release 中的插件 ZIP 解压到 `<vault>/.obsidian/plugins/picnexus/`。旧测试目录 `.obsidian/plugins/obsidian-picnexus/` 必须删除，避免同时加载两个插件实例。

至少验证测试连接、粘贴上传、拖拽上传、禁用/启用和 Obsidian 重启加载。

## 提交 Obsidian 官方目录

首次提交前确认：

- 独立仓库根目录包含 `README.md`、`LICENSE` 和合规的 `manifest.json`。
- README 已披露 `127.0.0.1` 网络访问、PicNexus 桌面端依赖和图片上传去向。
- 插件 ID 为 `picnexus`，不包含 `obsidian`。
- GitHub Release 标签严格等于 `manifest.json.version`，且有三个独立运行资产。
- BRAT 已完成真实仓库测试。

然后登录 [Obsidian Community](https://community.obsidian.md)，关联 GitHub，进入 **Plugins -> New plugin**，填写独立仓库 URL，接受开发者政策并提交。自动审核通过后人工点击发布。

首次上架后不再重复提交。后续只需更新默认分支的 `manifest.json` 并创建匹配版本的 GitHub Release。

官方参考：

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [Developer policies](https://docs.obsidian.md/Developer+policies)
