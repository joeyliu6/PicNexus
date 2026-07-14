# Obsidian 插件安装与配置

PicNexus Obsidian 插件需要与 PicNexus 桌面端配合使用。插件已经提交到 [Obsidian Community](https://community.obsidian.md/plugins/picnexus)；应用内是否可搜索，以官方客户端插件清单的同步状态为准。

## 官方目录安装（首选）

1. 打开 Obsidian 的 **设置 → 第三方插件**，关闭 **受限模式**。
2. 点击 **浏览**，搜索 `PicNexus`。
3. 安装并启用插件。

也可以在浏览器中打开 `obsidian://show-plugin?id=picnexus`，直接跳转到 Obsidian 的插件详情页。

## 网页可见但应用内搜不到

Obsidian Community 网页和 Obsidian 客户端使用的插件清单不是同一个搜索入口。网页详情页已经存在，只说明插件提交记录和自动扫描结果可用；客户端会读取 [`community-plugins.json`](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json)，只有该清单包含 `"id": "picnexus"` 后，插件才会出现在应用内搜索中。

遇到这种情况时按以下顺序检查：

1. 插件维护者登录 Obsidian Community，确认自动审核通过后已经点击 **Publish**。不要重复提交，也不要修改插件 ID。
2. 在 `community-plugins.json` 中搜索 `picnexus`。没有结果表示官方目录仍未同步，请暂时使用 BRAT 或手动安装。
3. 清单已有 `picnexus` 后，完全退出并重新打开 Obsidian，再打开第三方插件浏览器搜索。
4. 仍然无法搜索时，先升级 Obsidian 到最新稳定版，再重新打开插件浏览器。

网页上的 **Work in progress** 是 Scorecards 功能仍在完善的提示，不表示 PicNexus 插件处于草稿或审核失败状态。

## 通过 BRAT 安装（测试或备用）

1. 打开 Obsidian 的 **设置 → 第三方插件**，关闭 **受限模式**。
2. 点击 **浏览**，搜索并安装 `BRAT`，然后启用它。
3. 回到 **第三方插件**，打开 BRAT 设置，选择 **Add beta plugin**。
4. 填入 `joeyliu6/picnexus-obsidian`，确认安装。
5. 回到 **第三方插件**列表，启用 `PicNexus`。

## 手动安装

1. 从 [PicNexus Release](https://github.com/joeyliu6/PicNexus/releases) 下载 `picnexus-obsidian-<version>.zip`。
2. 将压缩包中的 `main.js`、`manifest.json` 和 `styles.css` 解压到当前 Obsidian 仓库的 `<vault>/.obsidian/plugins/picnexus/`。
3. 重启 Obsidian，在 **设置 → 第三方插件** 中启用 `PicNexus`。

如果曾测试过插件 ID 为 `obsidian-picnexus` 的旧版本，请先删除 `<vault>/.obsidian/plugins/obsidian-picnexus/`，避免同时加载两个插件实例。

## 连接 PicNexus

1. 启动 PicNexus 桌面端。
2. 在 PicNexus 的 **设置 → 外部编辑器 → Obsidian** 中开启服务并选择图床。
3. 打开 Obsidian 的 PicNexus 插件设置，确保端口与桌面端一致，默认端口为 `36799`。
4. 点击插件设置中的 **测试连接**，确认桌面端和当前图床均可用。

连接成功后，粘贴或拖入 Obsidian 的图片会交给本机 PicNexus 桌面端上传，并在当前笔记中写入 Markdown 图片链接。
