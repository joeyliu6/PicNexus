# Obsidian 插件安装与配置

PicNexus Obsidian 插件需要与 PicNexus 桌面端配合使用。目前插件尚未进入 Obsidian 官方社区插件目录，请先通过 BRAT 安装。

## 通过 BRAT 安装

1. 打开 Obsidian 的 **设置 → 第三方插件**，关闭 **受限模式**。
2. 点击 **浏览**，搜索并安装 `BRAT`，然后启用它。
3. 回到 **第三方插件**，打开 BRAT 设置，选择 **Add beta plugin**。
4. 填入 `joeyliu6/picnexus-obsidian`，确认安装。
5. 回到 **第三方插件**列表，启用 `PicNexus`。

## 官方目录安装

插件上架后，在 Obsidian 的 **设置 → 第三方插件 → 浏览** 中搜索 `PicNexus`，安装并启用即可，不再需要 BRAT。

## 手动安装

1. 从 [PicNexus Release](https://github.com/joeyliu6/PicNexus/releases) 下载 `picnexus-obsidian-<version>.zip`。
2. 将压缩包中的 `main.js`、`manifest.json` 和 `styles.css` 解压到当前 Obsidian 仓库的 `<vault>/.obsidian/plugins/picnexus/`。
3. 重启 Obsidian，在 **设置 → 第三方插件**中启用 `PicNexus`。

如果曾测试过插件 ID 为 `obsidian-picnexus` 的旧版本，请先删除 `<vault>/.obsidian/plugins/obsidian-picnexus/`，避免同时加载两个插件实例。

## 连接 PicNexus

1. 启动 PicNexus 桌面端。
2. 在 PicNexus 的 **设置 → 外部编辑器 → Obsidian** 中开启服务并选择图床。
3. 打开 Obsidian 的 PicNexus 插件设置，确保端口与桌面端一致，默认端口为 `36799`。
4. 点击插件设置中的 **测试连接**，确认桌面端和当前图床均可用。

连接成功后，粘贴或拖入 Obsidian 的图片会交给本机 PicNexus 桌面端上传，并在当前笔记中写入 Markdown 图片链接。
