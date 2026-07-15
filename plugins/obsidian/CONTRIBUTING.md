# 贡献 PicNexus Obsidian 插件

感谢参与 PicNexus Obsidian 插件的改进。

插件源码由 [PicNexus 主仓库](https://github.com/joeyliu6/PicNexus) 中的 `plugins/obsidian/` 统一维护，并在发布时自动同步到独立插件仓库。请不要直接修改同步生成的 `picnexus-obsidian` 仓库。

## 提交步骤

1. 在 PicNexus 主仓库创建 issue，说明问题或改动目标。
2. Fork 主仓库并创建独立分支。
3. 在仓库根目录运行 `npm --prefix plugins/obsidian ci` 安装插件依赖。
4. 修改后运行 `npm run ci:obsidian`。
5. 向 PicNexus 主仓库提交 Pull Request，并附上测试结果。

插件版本由维护者统一更新。已经发布的版本不会覆盖，运行文件发生变化时必须提升插件版本。
